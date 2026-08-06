export type CreditDocumentData = Record<string, any>;

export type CalculatedCreditStatus = 'starter' | 'active' | 'hold' | 'disabled';
export type CalculatedApprovalStatus = 'pending_starter' | 'pending_calculated' | 'approved' | 'rejected';

export interface CreditCalculationInput {
  customerId: string;
  customer: CreditDocumentData;
  invoices: Array<{ id: string; data: CreditDocumentData }>;
  payments: Array<{ id: string; data: CreditDocumentData }>;
  settings: CreditDocumentData;
  existingProfile?: CreditDocumentData;
  reviewReason: string;
  now?: Date;
  lookbackDays?: 60 | 90;
}

export interface CreditCalculationResult {
  profile: CreditDocumentData;
  summary: CreditDocumentData;
}

const DAY_MS = 86_400_000;
const SETTLEMENT_TOLERANCE = 1;
const PROVISIONAL_LIMIT_CAP = 10_000;
const CASH_STARTER_CAP = 5_000;
const ONE_CREDIT_CAP = 7_500;
const TWO_CREDIT_CAP = 10_000;

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundMoney = (value: number) => Math.round((Math.max(0, value) + Number.EPSILON) * 100) / 100;
const roundPercent = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const formatLocalDate = (date: Date) => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const addDays = (dateString: string, days: number) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const daysBetween = (fromDate: string, toDate: string) => {
  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / DAY_MS));
};

const percentile = (values: number[], percentage: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentage;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const median = (values: number[]) => percentile(values, 0.5);
const p75 = (values: number[]) => percentile(values, 0.75);

const normalized = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');

const isExcludedInvoice = (invoice: CreditDocumentData) => {
  const type = normalized(invoice.invoiceType);
  const status = normalized(invoice.status);
  return [
    'sales return', 'sale return', 'return', 'credit note', 'cogs', 'inventory',
    'inter shop', 'quotation', 'quote', 'order', 'confirmed order'
  ].includes(type) || ['draft', 'cancelled', 'canceled', 'deleted', 'void'].includes(status);
};

const isOpeningBalance = (invoice: CreditDocumentData) => {
  const type = normalized(invoice.invoiceType);
  return invoice.isOpeningBalance === true || type === 'opening balance';
};

const paymentAmount = (payment: CreditDocumentData) => Math.max(0, numberOrZero(
  payment.amountAppliedToInvoice === undefined
    ? payment.amount ?? payment.amountReceived
    : payment.amountAppliedToInvoice
));

const paymentEffect = (payment: CreditDocumentData) => paymentAmount(payment) + Math.max(0, numberOrZero(payment.cashDiscount));

const getPaymentFactor = (score: number) => {
  if (score >= 95) return 1.1;
  if (score >= 85) return 1;
  if (score >= 75) return 0.8;
  if (score >= 60) return 0.6;
  return 0.3;
};

const getHistoryFactor = (count: number) => {
  if (count >= 36) return 1.15;
  if (count >= 24) return 1.1;
  if (count >= 12) return 1;
  if (count >= 6) return 0.75;
  if (count >= 3) return 0.5;
  return 0;
};

interface CreditInvoiceRow {
  id: string;
  invoiceNumber: string;
  total: number;
  netCollectible: number;
  outstanding: number;
  invoiceDate: string;
  dueDate: string;
  completedDate: string;
  settlementDays: number;
  onTimeAmount: number;
  lateAmountDays: number;
  paymentExposure: number;
  completed: boolean;
  creditInvoice: boolean;
  openingBalance: boolean;
}

const buildInvoiceRows = (input: CreditCalculationInput, today: string) => {
  const paymentsByInvoice = new Map<string, CreditDocumentData[]>();
  input.payments.forEach(({ data }) => {
    const invoiceId = String(data.invoiceId || '');
    if (!invoiceId) return;
    const rows = paymentsByInvoice.get(invoiceId) ?? [];
    rows.push(data);
    paymentsByInvoice.set(invoiceId, rows);
  });

  return input.invoices
    .filter(({ data }) => !isExcludedInvoice(data))
    .map(({ id, data }): CreditInvoiceRow => {
      const total = Math.max(0, numberOrZero(data.totalSales ?? data.salesAmount));
      const invoiceDate = String(data.date || data.invoiceDate || '');
      const storedCreditDays = Math.max(0, Math.round(numberOrZero(data.creditDaysAtInvoice)));
      const dueDate = String(data.savedDueDate || data.dueDate || '') || addDays(invoiceDate, storedCreditDays);
      const rows = [...(paymentsByInvoice.get(id) ?? [])]
        .filter((payment) => String(payment.date || payment.paymentDate || '') <= today)
        .sort((left, right) => String(left.date || left.paymentDate || '').localeCompare(String(right.date || right.paymentDate || '')));
      const approvedDiscount = rows.reduce((sum, payment) => sum + Math.max(0, numberOrZero(payment.cashDiscount)), 0);
      const netCollectible = Math.max(0, total - approvedDiscount);
      let remainingCollectible = netCollectible;
      let runningEffect = 0;
      let completedDate = '';
      let onTimeAmount = 0;
      let lateAmountDays = 0;
      let paymentExposure = 0;

      rows.forEach((payment) => {
        const date = String(payment.date || payment.paymentDate || '');
        const allocated = Math.min(remainingCollectible, paymentAmount(payment));
        remainingCollectible -= allocated;
        runningEffect += paymentEffect(payment);
        if (!completedDate && runningEffect >= total - SETTLEMENT_TOLERANCE) completedDate = date;
        if (date <= dueDate) onTimeAmount += allocated;
        const lateDays = date > dueDate ? daysBetween(dueDate, date) : 0;
        paymentExposure += allocated;
        lateAmountDays += allocated * lateDays;
      });

      const outstanding = roundMoney(Math.max(0, total - runningEffect));
      if (outstanding > SETTLEMENT_TOLERANCE && dueDate && today > dueDate) {
        paymentExposure += outstanding;
        lateAmountDays += outstanding * daysBetween(dueDate, today);
      }
      const completed = total > 0 && outstanding <= SETTLEMENT_TOLERANCE;
      const creditInvoice = storedCreditDays > 0 || Boolean(dueDate && invoiceDate && dueDate > invoiceDate);

      return {
        id,
        invoiceNumber: String(data.invoiceNumber || id),
        total,
        netCollectible,
        outstanding,
        invoiceDate,
        dueDate,
        completedDate,
        settlementDays: completedDate ? daysBetween(invoiceDate, completedDate) : 0,
        onTimeAmount: Math.min(netCollectible, onTimeAmount),
        lateAmountDays,
        paymentExposure,
        completed,
        creditInvoice,
        openingBalance: isOpeningBalance(data)
      };
    });
};

const getPaymentMetrics = (rows: CreditInvoiceRow[]) => {
  const lateAmountDays = rows.reduce((sum, row) => sum + row.lateAmountDays, 0);
  const exposure = rows.reduce((sum, row) => sum + row.paymentExposure, 0);
  const onTime = rows.reduce((sum, row) => sum + row.onTimeAmount, 0);
  return {
    weightedLateDays: exposure > 0 ? lateAmountDays / exposure : 0,
    // Not-yet-due unpaid amounts are not payment-behaviour exposure yet.
    onTimeAmountPercentage: exposure > 0 ? (onTime / exposure) * 100 : 100
  };
};

export const calculateCustomerCredit = (input: CreditCalculationInput): CreditCalculationResult => {
  const now = input.now ?? new Date();
  const today = formatLocalDate(now);
  const reviewedAt = now.toISOString();
  const tier = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'].includes(String(input.customer.tier))
    ? String(input.customer.tier)
    : 'Tier 4';
  const creditDays = Math.max(0, Math.round(numberOrZero(input.settings.creditDays?.[tier])));
  const ninetyDaysAgo = addDays(today, -89);
  const invoiceRows = buildInvoiceRows(input, today);
  const historyRows = invoiceRows.filter((row) => !row.openingBalance && row.creditInvoice && row.invoiceDate <= today);
  const completedCreditRows = historyRows.filter((row) => row.completed);
  const recentCompletedCreditRows = completedCreditRows.filter((row) => row.invoiceDate >= ninetyDaysAgo);
  const completedCashRows = invoiceRows.filter((row) => !row.openingBalance && !row.creditInvoice && row.completed && row.invoiceDate >= ninetyDaysAgo);
  const firstHistoryDate = [...completedCreditRows].map((row) => row.invoiceDate).filter(Boolean).sort()[0];
  const historyAgeDays = firstHistoryDate ? daysBetween(firstHistoryDate, today) + 1 : 0;
  const observedMonths = historyAgeDays >= 90 ? 3 : Math.max(1, historyAgeDays / 30);
  const recentCompletedCreditSales = recentCompletedCreditRows.reduce((sum, row) => sum + row.total, 0);
  const recentMonthlyCompletedCreditSales = roundMoney(recentCompletedCreditSales / observedMonths);
  const recentCycleP75 = p75(recentCompletedCreditRows.map((row) => row.settlementDays));
  const lifetimeCycleP75 = p75(completedCreditRows.map((row) => row.settlementDays));
  const fallbackCycle = recentCycleP75 || lifetimeCycleP75 || 3;
  const effectiveCycleDays = roundMoney(clamp(
    0.7 * (recentCycleP75 || fallbackCycle) + 0.3 * (lifetimeCycleP75 || fallbackCycle),
    3,
    20
  ));
  const representativeInvoiceValue = roundMoney(median(
    (recentCompletedCreditRows.length > 0 ? recentCompletedCreditRows : completedCreditRows).map((row) => row.total)
  ));
  const cycleBasedLimit = roundMoney(recentMonthlyCompletedCreditSales * effectiveCycleDays / 30);
  const baseCreditLimit = roundMoney(Math.max(cycleBasedLimit, representativeInvoiceValue));

  const recentPaymentRows = historyRows.filter((row) => row.invoiceDate >= ninetyDaysAgo);
  const recentPaymentMetrics = getPaymentMetrics(recentPaymentRows);
  const lifetimePaymentMetrics = getPaymentMetrics(historyRows);
  const combinedWeightedLateDays = roundMoney(
    0.7 * recentPaymentMetrics.weightedLateDays + 0.3 * lifetimePaymentMetrics.weightedLateDays
  );
  const combinedOnTimeAmountPercentage = roundPercent(
    0.7 * recentPaymentMetrics.onTimeAmountPercentage + 0.3 * lifetimePaymentMetrics.onTimeAmountPercentage
  );
  const latenessScore = Math.max(0, 100 - combinedWeightedLateDays * 4);
  const creditPaymentScore = roundPercent(0.8 * latenessScore + 0.2 * combinedOnTimeAmountPercentage);
  const paymentFactor = getPaymentFactor(creditPaymentScore);
  const lifetimeHistoryFactor = getHistoryFactor(completedCreditRows.length);
  const historyFactor = recentCompletedCreditRows.length > 0 ? lifetimeHistoryFactor : Math.min(1, lifetimeHistoryFactor);
  const establishedLimit = roundMoney(baseCreditLimit * paymentFactor * historyFactor);

  const manualStarterLimit = Math.min(PROVISIONAL_LIMIT_CAP, Math.max(0, numberOrZero(input.existingProfile?.manualStarterLimit)));
  let limitSource = 'No history';
  let calculatedCreditLimit = 0;

  if (manualStarterLimit > 0 && completedCreditRows.length < 3) {
    calculatedCreditLimit = roundMoney(manualStarterLimit);
    limitSource = 'Admin provisional';
  } else if (completedCreditRows.length >= 3) {
    calculatedCreditLimit = establishedLimit;
    limitSource = 'Established formula';
  } else if (completedCreditRows.length === 2) {
    calculatedCreditLimit = roundMoney(Math.min(TWO_CREDIT_CAP, median(completedCreditRows.map((row) => row.total)) * 0.75));
    limitSource = 'Two completed credit invoices';
  } else if (completedCreditRows.length === 1) {
    calculatedCreditLimit = roundMoney(Math.min(ONE_CREDIT_CAP, completedCreditRows[0].total * 0.6));
    limitSource = 'One completed credit invoice';
  } else if (completedCashRows.length >= 3) {
    calculatedCreditLimit = roundMoney(Math.min(CASH_STARTER_CAP, median(completedCashRows.map((row) => row.total)) * 0.5));
    limitSource = 'Cash-history starter';
  }

  const completedTransactions = invoiceRows.filter((row) => !row.openingBalance && row.completed && row.completedDate);
  const completedDates = completedTransactions.map((row) => row.completedDate).sort();
  const lastCompletedDate = completedDates[completedDates.length - 1] || '';
  const inactiveDays = lastCompletedDate ? daysBetween(lastCompletedDate, today) : 0;
  if (manualStarterLimit <= 0) {
    if (inactiveDays > 365) calculatedCreditLimit = Math.min(calculatedCreditLimit * 0.25, CASH_STARTER_CAP);
    else if (inactiveDays > 180) calculatedCreditLimit = Math.min(calculatedCreditLimit * 0.5, CASH_STARTER_CAP);
    else if (inactiveDays > 90) calculatedCreditLimit *= 0.75;
    calculatedCreditLimit = roundMoney(calculatedCreditLimit);
  }

  const previousCalculatedLimit = Math.max(0, numberOrZero(
    input.existingProfile?.calculatedCreditLimit ?? input.existingProfile?.approvedCreditLimit
  ));
  if (previousCalculatedLimit > 0 && calculatedCreditLimit > previousCalculatedLimit) {
    calculatedCreditLimit = roundMoney(Math.min(calculatedCreditLimit, previousCalculatedLimit * 1.2));
  }

  const override = input.existingProfile?.creditOverride;
  const hasActiveOverride = Boolean(override && String(override.expiresAt || '') >= today && numberOrZero(override.amount) >= 0);
  const approvedCreditLimit = hasActiveOverride
    ? roundMoney(numberOrZero(override.amount))
    : calculatedCreditLimit;
  const currentOutstanding = roundMoney(invoiceRows.reduce((sum, row) => sum + row.outstanding, 0));
  const overdueRows = invoiceRows.filter((row) => row.outstanding > SETTLEMENT_TOLERANCE && row.dueDate && today > row.dueDate);
  const overdueAmount = roundMoney(overdueRows.reduce((sum, row) => sum + row.outstanding, 0));
  const oldestOverdue = [...overdueRows].sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
  const oldestOverdueDays = oldestOverdue ? daysBetween(oldestOverdue.dueDate, today) : 0;
  const overdueSalesRatio = recentMonthlyCompletedCreditSales > 0
    ? overdueAmount / recentMonthlyCompletedCreditSales
    : overdueAmount > 0 ? 1 : 0;
  const seriousRatio = Math.max(0, numberOrZero(input.settings.overduePolicy?.seriousSalesRatioPercent ?? 15)) / 100;
  const seriousInvoiceCount = Math.max(1, Math.round(numberOrZero(input.settings.overduePolicy?.seriousInvoiceCount ?? 2)));
  const seriousDays = Math.max(1, Math.round(numberOrZero(input.settings.overduePolicy?.seriousDays ?? 30)));
  const seriousOverdue = overdueAmount > 0
    && (overdueSalesRatio > seriousRatio || overdueRows.length >= seriousInvoiceCount || oldestOverdueDays > seriousDays);
  const manualHold = input.existingProfile?.manualHold === true;
  const isStarter = completedCreditRows.length < 3;
  let creditStatus: CalculatedCreditStatus = isStarter ? 'starter' : 'active';
  if (manualHold || seriousOverdue) creditStatus = 'hold';
  const availableCredit = creditStatus === 'hold'
    ? 0
    : roundMoney(Math.max(0, approvedCreditLimit - currentOutstanding));
  const nextDue = [...invoiceRows]
    .filter((row) => row.outstanding > SETTLEMENT_TOLERANCE && row.dueDate)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
  const overLimitAmount = roundMoney(Math.max(0, currentOutstanding - approvedCreditLimit));
  const customerName = String(input.customer.name || input.customer.customerName || '');
  const approvalStatus: CalculatedApprovalStatus = 'approved';
  const profile: CreditDocumentData = {
    customerId: input.customerId,
    customerName,
    tier,
    creditDays,
    currentOutstanding,
    creditHistoryDays: 90,
    totalCreditInvoiceAmountInLookback: roundMoney(recentCompletedCreditSales),
    totalCreditInvoiceAmountLast90Days: roundMoney(recentCompletedCreditSales),
    averageMonthlyCreditSales: recentMonthlyCompletedCreditSales,
    recentMonthlyCompletedCreditSales,
    representativeInvoiceValue,
    effectiveCycleDays,
    baseCreditLimit,
    calculatedCreditLimit,
    approvedCreditLimit,
    availableCredit,
    overLimitAmount,
    paymentFactor,
    historyFactor,
    creditPaymentScore,
    weightedLateDays: combinedWeightedLateDays,
    onTimePaymentPercentage: combinedOnTimeAmountPercentage,
    completedCreditInvoices: completedCreditRows.length,
    overdueAmount,
    oldestOverdueInvoice: oldestOverdue?.invoiceNumber || '',
    oldestOverdueDate: oldestOverdue?.dueDate || null,
    oldestOverdueDays,
    hasOverdueBeyondGrace: overdueAmount > 0,
    creditStatus,
    creditLimitApprovalStatus: approvalStatus,
    limitSource,
    nextInvoiceDueDate: nextDue?.dueDate || null,
    nextInvoiceDueAmount: nextDue ? nextDue.outstanding : null,
    lastCreditReviewAt: reviewedAt,
    lastCreditReviewReason: input.reviewReason,
    manualHold,
    updatedAt: reviewedAt
  };

  if (manualStarterLimit > 0 || Object.prototype.hasOwnProperty.call(input.existingProfile ?? {}, 'manualStarterLimit')) {
    profile.manualStarterLimit = manualStarterLimit;
  }
  if (override) profile.creditOverride = override;

  return {
    profile,
    summary: {
      customerId: input.customerId,
      suggestedCreditLimit: approvedCreditLimit,
      calculatedCreditLimit,
      approvedCreditLimit,
      availableCredit,
      usedCredit: currentOutstanding,
      overLimitAmount,
      creditDays,
      limitSource,
      oldestOverdueInvoice: oldestOverdue?.invoiceNumber || '',
      oldestOverdueDate: oldestOverdue?.dueDate || null,
      oldestOverdueDays,
      nextInvoiceDueDate: nextDue?.dueDate || null,
      nextInvoiceDueAmount: nextDue ? nextDue.outstanding : null,
      creditStatus,
      manualHold,
      updatedAt: reviewedAt
    }
  };
};
