import type { DocumentData } from 'firebase-admin/firestore';

export type CreditStatus = 'starter' | 'active' | 'hold' | 'disabled';
export type ApprovalStatus = 'pending_starter' | 'pending_calculated' | 'approved' | 'rejected';

export interface CreditCalculationInput {
  customerId: string;
  customer: DocumentData;
  invoices: Array<{ id: string; data: DocumentData }>;
  payments: Array<{ id: string; data: DocumentData }>;
  settings: DocumentData;
  existingProfile?: DocumentData;
  reviewReason: string;
  now?: Date;
}

export interface CreditCalculationResult {
  profile: DocumentData;
  summary: DocumentData;
}

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number) => Math.round((Math.max(0, value) + Number.EPSILON) * 100) / 100;
const roundPercent = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;

const addDays = (dateString: string, days: number) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isExcludedInvoice = (invoice: DocumentData) => {
  const type = String(invoice.invoiceType || '').trim().toLowerCase();
  return [
    'sales return',
    'sale return',
    'return',
    'credit note',
    'credit_note',
    'cogs',
    'inventory',
    'inter-shop',
    'inter shop',
    'inter_shop'
  ].includes(type);
};

const isOpeningBalance = (invoice: DocumentData) => {
  const type = String(invoice.invoiceType || '').trim().toLowerCase();
  return invoice.isOpeningBalance === true || type === 'opening_balance' || type === 'opening balance';
};

const paymentEffect = (payment: DocumentData) => {
  const amount = payment.amountAppliedToInvoice === undefined
    ? numberOrZero(payment.amount ?? payment.amountReceived)
    : numberOrZero(payment.amountAppliedToInvoice);
  return Math.max(0, amount) + Math.max(0, numberOrZero(payment.cashDiscount));
};

const getPaymentFactor = (percentage: number) => {
  if (percentage >= 95) return 1.1;
  if (percentage >= 85) return 1;
  if (percentage >= 75) return 0.8;
  if (percentage >= 60) return 0.6;
  return 0.3;
};

const getHistoryFactor = (count: number) => {
  if (count >= 12) return 1;
  if (count >= 6) return 0.75;
  if (count >= 3) return 0.5;
  return 0;
};

export const calculateCustomerCredit = (input: CreditCalculationInput): CreditCalculationResult => {
  const now = input.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const reviewedAt = now.toISOString();
  const tier = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'].includes(String(input.customer.tier))
    ? String(input.customer.tier)
    : 'Tier 4';
  const creditDays = Math.max(0, Math.round(numberOrZero(input.settings.creditDays?.[tier])));
  const starterCap = Math.max(0, numberOrZero(input.settings.creditPolicy?.starterLimitCap ?? 25000));
  const graceDays = Math.max(0, Math.round(numberOrZero(input.settings.creditPolicy?.overdueGraceDays ?? 3)));
  const paymentsByInvoice = new Map<string, DocumentData[]>();

  input.payments.forEach(({ data }) => {
    const invoiceId = String(data.invoiceId || '');
    if (!invoiceId) return;
    const rows = paymentsByInvoice.get(invoiceId) ?? [];
    rows.push(data);
    paymentsByInvoice.set(invoiceId, rows);
  });

  const receivableInvoices = input.invoices.filter(({ data }) => !isExcludedInvoice(data));
  const invoiceRows = receivableInvoices.map(({ id, data }) => {
    const total = Math.max(0, numberOrZero(data.totalSales ?? data.salesAmount));
    const payments = paymentsByInvoice.get(id) ?? [];
    const paid = payments.reduce((sum, payment) => sum + paymentEffect(payment), 0);
    const outstanding = roundMoney(Math.max(0, total - paid));
    const invoiceDate = String(data.date || data.invoiceDate || '');
    const dueDate = String(data.dueDate || '') || addDays(invoiceDate, creditDays);
    const paidOnTime = payments
      .filter((payment) => String(payment.date || payment.paymentDate || '') <= dueDate)
      .reduce((sum, payment) => sum + paymentEffect(payment), 0);

    return {
      id,
      data,
      total,
      outstanding,
      invoiceDate,
      dueDate,
      onTimeAmount: Math.min(total, Math.max(0, paidOnTime)),
      completed: total > 0 && outstanding <= 0.01,
      openingBalance: isOpeningBalance(data)
    };
  });

  const historyInvoices = invoiceRows.filter((invoice) => !invoice.openingBalance && invoice.completed && creditDays > 0);
  const completedCreditInvoices = historyInvoices.length;
  const onTimeDenominator = historyInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const onTimeNumerator = historyInvoices.reduce((sum, invoice) => sum + invoice.onTimeAmount, 0);
  const onTimePaymentPercentage = roundPercent(onTimeDenominator > 0 ? (onTimeNumerator / onTimeDenominator) * 100 : 0);
  const paymentFactor = getPaymentFactor(onTimePaymentPercentage);
  const historyFactor = getHistoryFactor(completedCreditInvoices);
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
  const ninetyDaysAgoString = ninetyDaysAgo.toISOString().slice(0, 10);
  const totalCreditInvoiceAmountLast90Days = roundMoney(historyInvoices
    .filter((invoice) => invoice.invoiceDate >= ninetyDaysAgoString && invoice.invoiceDate <= today)
    .reduce((sum, invoice) => sum + invoice.total, 0));
  const averageMonthlyCreditSales = roundMoney(totalCreditInvoiceAmountLast90Days / 3);
  const baseCreditLimit = roundMoney(averageMonthlyCreditSales * (creditDays / 30));
  const rawEstablishedLimit = roundMoney(baseCreditLimit * paymentFactor * historyFactor);
  const firstPaidInvoices = [...historyInvoices].sort((left, right) => left.invoiceDate.localeCompare(right.invoiceDate)).slice(0, 3);
  const firstPaidAverage = firstPaidInvoices.length > 0
    ? firstPaidInvoices.reduce((sum, invoice) => sum + invoice.total, 0) / firstPaidInvoices.length
    : 0;
  const derivedStarterLimit = roundMoney(Math.min(firstPaidAverage * 0.5, starterCap));
  const manualStarterLimit = Math.min(starterCap, Math.max(0, numberOrZero(input.existingProfile?.manualStarterLimit)));
  const starterLimit = manualStarterLimit > 0 ? roundMoney(manualStarterLimit) : derivedStarterLimit;
  const existingApproved = Math.max(0, numberOrZero(input.existingProfile?.approvedCreditLimit));
  const isStarter = completedCreditInvoices < 3;
  let calculatedCreditLimit = isStarter ? starterLimit : rawEstablishedLimit;

  if (!isStarter && existingApproved > 0 && calculatedCreditLimit > existingApproved) {
    calculatedCreditLimit = roundMoney(Math.min(calculatedCreditLimit, existingApproved * 1.2));
  }

  const override = input.existingProfile?.creditOverride;
  const overrideExpiresAt = String(override?.expiresAt || '');
  const hasActiveOverride = Boolean(override && overrideExpiresAt >= today && numberOrZero(override.amount) >= 0);
  let approvedCreditLimit = existingApproved;
  let approvalStatus: ApprovalStatus = isStarter ? 'pending_starter' : 'pending_calculated';

  if (creditDays <= 0) {
    calculatedCreditLimit = 0;
    approvedCreditLimit = 0;
    approvalStatus = 'approved';
  } else if (hasActiveOverride) {
    approvedCreditLimit = roundMoney(numberOrZero(override.amount));
    approvalStatus = 'approved';
  } else if (existingApproved > 0 && calculatedCreditLimit < existingApproved) {
    approvedCreditLimit = calculatedCreditLimit;
    approvalStatus = 'approved';
  } else if (existingApproved > 0 && Math.abs(calculatedCreditLimit - existingApproved) <= 0.01) {
    approvalStatus = 'approved';
  } else if (input.existingProfile?.creditLimitApprovalStatus === 'rejected') {
    approvalStatus = 'rejected';
  }

  const currentOutstanding = roundMoney(invoiceRows.reduce((sum, invoice) => sum + invoice.outstanding, 0));
  const confirmedUninvoicedCreditOrders = Math.max(0, numberOrZero(input.existingProfile?.confirmedUninvoicedCreditOrders));
  const overdueRows = invoiceRows.filter((invoice) => invoice.outstanding > 0 && invoice.dueDate && today > addDays(invoice.dueDate, graceDays));
  const overdueAmount = roundMoney(overdueRows.reduce((sum, invoice) => sum + invoice.outstanding, 0));
  const hasOverdueBeyondGrace = overdueRows.length > 0;
  const manualHold = input.existingProfile?.manualHold === true;
  let creditStatus: CreditStatus = creditDays <= 0 ? 'disabled' : isStarter ? 'starter' : 'active';
  if (manualHold || hasOverdueBeyondGrace) creditStatus = 'hold';

  const availableCredit = creditStatus === 'hold' || creditStatus === 'disabled'
    ? 0
    : roundMoney(Math.max(0, approvedCreditLimit - currentOutstanding - confirmedUninvoicedCreditOrders));
  const nextDue = invoiceRows
    .filter((invoice) => invoice.outstanding > 0 && invoice.dueDate)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
  const customerName = String(input.customer.name || input.customer.customerName || '');
  const profile: DocumentData = {
    customerId: input.customerId,
    customerName,
    tier,
    creditDays,
    currentOutstanding,
    confirmedUninvoicedCreditOrders,
    totalCreditInvoiceAmountLast90Days,
    averageMonthlyCreditSales,
    baseCreditLimit,
    calculatedCreditLimit,
    approvedCreditLimit,
    availableCredit,
    paymentFactor,
    historyFactor,
    onTimePaymentPercentage,
    completedCreditInvoices,
    overdueAmount,
    hasOverdueBeyondGrace,
    creditStatus,
    creditLimitApprovalStatus: approvalStatus,
    nextInvoiceDueDate: nextDue?.dueDate || null,
    nextInvoiceDueAmount: nextDue ? nextDue.outstanding : null,
    lastCreditReviewAt: reviewedAt,
    lastCreditReviewReason: input.reviewReason,
    manualHold,
    updatedAt: reviewedAt
  };

  if (isStarter && manualStarterLimit > 0) profile.manualStarterLimit = manualStarterLimit;

  if (hasActiveOverride) profile.creditOverride = override;

  return {
    profile,
    summary: {
      customerId: input.customerId,
      availableCredit,
      usedCredit: roundMoney(currentOutstanding + confirmedUninvoicedCreditOrders),
      creditDays,
      nextInvoiceDueDate: nextDue?.dueDate || null,
      nextInvoiceDueAmount: nextDue ? nextDue.outstanding : null,
      creditStatus,
      updatedAt: reviewedAt
    }
  };
};
