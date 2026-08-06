import type { AppSettings, Customer, CustomerTier, Invoice, Payment, UserProfile } from '../types';
import { getCurrentMonthRange, getTodayDateString } from './dateUtils';
import { getPreviousOutstandingFallback } from './openingBalance';
import { getInvoicePaymentEffect, getPendingAmount } from './paymentUtils';
import {
  getGiftPercentageForTier,
  getInvoiceBufferDays,
  getInvoiceFinalPcCutoffDate,
  getInvoiceSavedDueDate
} from './settings';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAID_GREEN = '#166534';
const DUE_STAGE_YELLOW = '#FACC15';
const DUE_STAGE_ORANGE = '#F97316';
const DUE_STAGE_LIGHT_RED = '#F87171';
const OVERDUE_BLOOD_RED = '#7F1D1D';

export interface CustomerInvoiceView {
  invoice: Invoice;
  invoiceAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  totalCreditDays: number;
  daysUsed: number;
  daysRemaining: number;
  daysLabel: string;
  dueProgressPercentage: number;
  paidPercentage: number;
  pendingPercentage: number;
  urgencyColor: string;
  status: 'Overdue' | 'Partial' | 'Pending' | 'Paid' | 'Due Soon' | 'Due Later' | 'Due date not set';
  expectedApc: number;
  earnedApc: number;
  apcDeadline: string;
  apcStatus: 'Earned' | 'Available' | 'Expired' | 'Not available';
}

const parseDate = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? new Date(year, month - 1, day) : undefined;
};

const daysBetween = (fromDate: Date, toDate: Date) => Math.floor((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);

export const isCurrentMonth = (dateString: string) => {
  const range = getCurrentMonthRange();
  return dateString >= range.fromDate && dateString <= range.toDate;
};

export const filterCustomerRecords = <T extends { customerId?: string; customerName?: string }>(
  rows: T[],
  profile: Pick<UserProfile, 'customerId' | 'customerName'>
) => {
  // Privacy rule: customerId is the primary link, customerName is a legacy fallback for older records.
  return rows.filter((row) => {
    if (profile.customerId && row.customerId === profile.customerId) return true;
    return Boolean(profile.customerName && row.customerName === profile.customerName);
  });
};

export const calculateInvoiceOutstanding = (invoice: Invoice, payments: Payment[]) => {
  const paidAmount = payments
    .filter((payment) => payment.invoiceId === invoice.id)
    .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
  const invoiceAmount = invoice.totalSales || invoice.salesAmount;

  // Customer portal never exposes cost/profit; it only needs purchase, paid, and pending values.
  return {
    invoiceAmount,
    paidAmount,
    outstandingAmount: getPendingAmount(invoiceAmount, paidAmount)
  };
};

export const getInvoiceApcDeadline = (invoice: Invoice, tier?: CustomerTier, settings?: AppSettings) => {
  if (!tier) return invoice.dueDate;
  return getInvoiceFinalPcCutoffDate(invoice, invoice.tierAtInvoice ?? tier, settings);
};

export const getInvoiceFullPaymentDate = (invoice: Invoice, payments: Payment[]) => {
  const invoiceAmount = invoice.totalSales || invoice.salesAmount;
  let runningPaid = 0;
  const invoicePayments = payments
    .filter((payment) => payment.invoiceId === invoice.id)
    .sort((left, right) => left.date.localeCompare(right.date));

  for (const payment of invoicePayments) {
    runningPaid += getInvoicePaymentEffect(payment);
    if (getPendingAmount(invoiceAmount, runningPaid) <= 0) {
      return payment.date;
    }
  }

  return '';
};

export const calculateInvoiceApcInfo = (
  invoice: Invoice,
  payments: Payment[],
  tier?: CustomerTier,
  settings?: AppSettings,
  todayString = getTodayDateString()
) => {
  const invoiceTier = invoice.tierAtInvoice ?? tier;
  const deadline = invoiceTier ? getInvoiceApcDeadline(invoice, invoiceTier, settings) : invoice.finalPcCutoffDate || invoice.dueDate;
  const savedDueDate = invoiceTier ? getInvoiceSavedDueDate(invoice, invoiceTier, settings) : invoice.savedDueDate || invoice.dueDate;
  const bufferDays = invoiceTier ? getInvoiceBufferDays(invoice, invoiceTier, settings) : 0;
  const fullPaymentDate = getInvoiceFullPaymentDate(invoice, payments);
  const pcPercentage = invoice.pcPercentageAtInvoice
    ?? (invoiceTier ? getGiftPercentageForTier(invoiceTier, settings) : 0);
  const fullInvoicePc = Math.max(0, invoice.totalProfit) * (Math.max(0, pcPercentage) / 100);
  const expectedApc = Math.max(0, Math.round(fullInvoicePc));
  const isFullyPaid = Boolean(fullPaymentDate);
  const isDeadlineValid = Boolean(deadline);
  const invoicePayments = payments
    .filter((payment) => payment.invoiceId === invoice.id)
    .sort((left, right) => left.date.localeCompare(right.date));
  const approvedCashDiscount = invoicePayments.reduce((sum, payment) => sum + Math.max(0, payment.cashDiscount), 0);
  const netCollectibleAmount = Math.max(0, (invoice.totalSales || invoice.salesAmount) - approvedCashDiscount);
  let remainingCollectible = netCollectibleAmount;
  let weightedRetainedAmount = 0;

  invoicePayments.forEach((payment) => {
    if (remainingCollectible <= 0) return;
    const allocatedAmount = Math.min(remainingCollectible, Math.max(0, payment.amountAppliedToInvoice ?? payment.amount));
    if (allocatedAmount <= 0) return;
    const paymentDate = parseDate(payment.date);
    const dueDate = parseDate(savedDueDate);
    const daysLate = paymentDate && dueDate ? Math.max(0, daysBetween(dueDate, paymentDate)) : 0;
    const retentionFactor = daysLate <= 0 ? 1 : bufferDays > 0 ? Math.max(0, 1 - daysLate / bufferDays) : 0;
    weightedRetainedAmount += allocatedAmount * retentionFactor;
    remainingCollectible -= allocatedAmount;
  });

  const weightedRetention = netCollectibleAmount > 0
    ? Math.min(1, Math.max(0, weightedRetainedAmount / netCollectibleAmount))
    : 0;
  const proportionalPc = fullInvoicePc * 0.9 * weightedRetention;
  const settledByDueDate = isFullyPaid && Boolean(savedDueDate) && fullPaymentDate <= savedDueDate;
  const settlementPc = settledByDueDate ? fullInvoicePc * 0.1 : 0;
  const earnedApc = isFullyPaid ? Math.max(0, Math.round(proportionalPc + settlementPc)) : 0;
  const isExpired = isDeadlineValid && !isFullyPaid && todayString > deadline;

  return {
    expectedApc,
    earnedApc,
    apcDeadline: deadline || '',
    apcStatus: isFullyPaid ? 'Earned' as const : isExpired ? 'Expired' as const : isDeadlineValid ? 'Available' as const : 'Not available' as const
  };
};

export const getDueUrgencyColor = (dueProgressPercentage: number, isOverdue: boolean, isPaid: boolean) => {
  // Paid invoice portions stay dark green and are independent of due urgency.
  if (isPaid) return PAID_GREEN;

  // Due urgency stages: overdue blood red, then yellow/orange/light red as credit period is used.
  if (isOverdue) return OVERDUE_BLOOD_RED;
  if (dueProgressPercentage <= 50) return DUE_STAGE_YELLOW;
  if (dueProgressPercentage <= 75) return DUE_STAGE_ORANGE;
  return DUE_STAGE_LIGHT_RED;
};

export const calculatePaidPendingPercentages = (invoiceAmount: number, paidAmount: number, outstandingAmount: number) => {
  if (invoiceAmount <= 0) {
    return { paidPercentage: 0, pendingPercentage: 0 };
  }

  // Partial payment donut: paid part is green, pending part uses urgency color.
  const paidPercentage = Math.min(100, Math.max(0, (paidAmount / invoiceAmount) * 100));
  const pendingPercentage = Math.min(100, Math.max(0, (outstandingAmount / invoiceAmount) * 100));

  return { paidPercentage, pendingPercentage };
};

export const calculateDueStatus = (
  invoice: Invoice,
  payments: Payment[],
  todayString = getTodayDateString(),
  tier?: CustomerTier,
  settings?: AppSettings
): CustomerInvoiceView => {
  const { invoiceAmount, paidAmount, outstandingAmount } = calculateInvoiceOutstanding(invoice, payments);
  const invoiceDate = parseDate(invoice.date);
  const effectiveDueDate = tier ? getInvoiceSavedDueDate(invoice, invoice.tierAtInvoice ?? tier, settings) : invoice.savedDueDate || invoice.dueDate;
  const invoiceWithEffectiveDueDate = effectiveDueDate && effectiveDueDate !== invoice.dueDate ? { ...invoice, dueDate: effectiveDueDate } : invoice;
  const apcInfo = calculateInvoiceApcInfo(invoice, payments, tier, settings, todayString);
  const dueDate = parseDate(effectiveDueDate);
  const today = parseDate(todayString) ?? new Date();
  const isPaid = outstandingAmount <= 0;

  if (!invoiceDate || !dueDate) {
    const percentages = calculatePaidPendingPercentages(invoiceAmount, paidAmount, outstandingAmount);
    return {
      invoice: invoiceWithEffectiveDueDate,
      invoiceAmount,
      paidAmount,
      outstandingAmount,
      totalCreditDays: 0,
      daysUsed: 0,
      daysRemaining: 0,
      daysLabel: isPaid ? 'Paid' : 'Due date not set',
      dueProgressPercentage: isPaid ? 100 : 0,
      ...percentages,
      urgencyColor: getDueUrgencyColor(0, false, isPaid),
      status: isPaid ? 'Paid' : 'Due date not set',
      ...apcInfo
    };
  }

  // Guard against zero-day credit periods before calculating due progress.
  const totalCreditDays = Math.max(1, daysBetween(invoiceDate, dueDate));
  const daysUsed = Math.max(0, daysBetween(invoiceDate, today));
  const daysRemaining = daysBetween(today, dueDate);
  const isOverdue = outstandingAmount > 0 && daysRemaining < 0;
  const rawDueProgressPercentage = (daysUsed / totalCreditDays) * 100;
  // Non-overdue invoices are capped to 0-100 so orange is 51-75 and light red is 76-100.
  const dueProgressPercentage = Math.min(100, Math.max(0, rawDueProgressPercentage));
  const percentages = calculatePaidPendingPercentages(invoiceAmount, paidAmount, outstandingAmount);
  const status: CustomerInvoiceView['status'] = isPaid
    ? 'Paid'
    : isOverdue
      ? 'Overdue'
      : paidAmount > 0
        ? 'Partial'
        : daysRemaining <= 3
          ? 'Due Soon'
          : 'Pending';

  return {
    invoice: invoiceWithEffectiveDueDate,
    invoiceAmount,
    paidAmount,
    outstandingAmount,
    totalCreditDays,
    daysUsed,
    daysRemaining,
    daysLabel: isPaid ? 'Paid' : isOverdue ? `${Math.abs(daysRemaining)} Days Overdue` : `${daysRemaining} Days Left`,
    dueProgressPercentage,
    ...percentages,
    urgencyColor: getDueUrgencyColor(dueProgressPercentage, isOverdue, isPaid),
    status: status === 'Pending' && daysRemaining > 3 ? 'Due Later' : status,
    ...apcInfo
  };
};

export const sortInvoicesByUrgency = (invoiceViews: CustomerInvoiceView[]) => {
  // Due invoices sort by urgency: overdue first, then smallest remaining days.
  return [...invoiceViews].sort((left, right) => {
    const leftOverdue = left.outstandingAmount > 0 && left.daysRemaining < 0 ? 1 : 0;
    const rightOverdue = right.outstandingAmount > 0 && right.daysRemaining < 0 ? 1 : 0;

    if (leftOverdue !== rightOverdue) return rightOverdue - leftOverdue;
    return left.daysRemaining - right.daysRemaining;
  });
};

export const calculateCustomerTotalOutstanding = (customer: Customer | undefined, invoiceViews: CustomerInvoiceView[]) => {
  const previousOutstanding = getPreviousOutstandingFallback(customer, invoiceViews.map((row) => row.invoice));
  const invoiceOutstanding = invoiceViews.reduce((sum, row) => sum + Math.max(0, row.outstandingAmount), 0);

  // Opening balances are normal invoices after conversion; the field is only a legacy fallback.
  return previousOutstanding + invoiceOutstanding;
};
