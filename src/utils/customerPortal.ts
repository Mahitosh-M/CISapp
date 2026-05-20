import type { Customer, Invoice, Payment, UserProfile } from '../types';
import { getCurrentMonthRange } from './dateUtils';
import { getInvoicePaymentEffect } from './paymentUtils';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    outstandingAmount: invoiceAmount - paidAmount
  };
};

export const getDueUrgencyColor = (dueProgressPercentage: number, isOverdue: boolean, isPaid: boolean) => {
  // Donut urgency moves from yellow to red as due date approaches; paid invoices stay green.
  if (isPaid) return '#166534';
  if (isOverdue) return '#7F1D1D';
  if (dueProgressPercentage <= 50) return '#FACC15';
  if (dueProgressPercentage <= 75) return '#F97316';
  return '#F87171';
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

export const calculateDueStatus = (invoice: Invoice, payments: Payment[], todayString = new Date().toISOString().slice(0, 10)): CustomerInvoiceView => {
  const { invoiceAmount, paidAmount, outstandingAmount } = calculateInvoiceOutstanding(invoice, payments);
  const invoiceDate = parseDate(invoice.date);
  const dueDate = parseDate(invoice.dueDate);
  const today = parseDate(todayString) ?? new Date();
  const isPaid = outstandingAmount <= 0;

  if (!invoiceDate || !dueDate) {
    const percentages = calculatePaidPendingPercentages(invoiceAmount, paidAmount, outstandingAmount);
    return {
      invoice,
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
      status: isPaid ? 'Paid' : 'Due date not set'
    };
  }

  const totalCreditDays = Math.max(1, daysBetween(invoiceDate, dueDate));
  const daysUsed = Math.max(0, daysBetween(invoiceDate, today));
  const daysRemaining = daysBetween(today, dueDate);
  const isOverdue = outstandingAmount > 0 && daysRemaining < 0;
  const dueProgressPercentage = Math.min(100, Math.max(0, (daysUsed / totalCreditDays) * 100));
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
    invoice,
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
    status: status === 'Pending' && daysRemaining > 3 ? 'Due Later' : status
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
  const previousOutstanding = customer?.previousOutstandingAmount ?? 0;
  const invoiceOutstanding = invoiceViews.reduce((sum, row) => sum + Math.max(0, row.outstandingAmount), 0);

  // Total outstanding includes old opening balance plus invoice outstanding from all time.
  return previousOutstanding + invoiceOutstanding;
};
