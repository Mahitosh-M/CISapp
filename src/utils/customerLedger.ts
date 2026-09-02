import type { Invoice, Payment } from '../types';
import { getInvoicePaymentEffect } from './paymentUtils';

export type CustomerLedgerEntry = {
  id: string;
  kind: 'invoice' | 'payment';
  date: string;
  createdAt: string;
  invoiceAmount: number;
  paymentAmount: number;
  paymentReceived: number;
  runningBalance: number;
  invoice?: Invoice;
  payment?: Payment;
};

interface CustomerLedgerOptions {
  endingBalance?: number;
}

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRecordDate = (date: string, createdAt: string) => date || createdAt.slice(0, 10);

export const buildCustomerLedger = (
  invoices: Invoice[],
  payments: Payment[],
  options: CustomerLedgerOptions = {}
): CustomerLedgerEntry[] => {
  const events = [
    ...invoices.map((invoice) => ({
      id: invoice.id,
      kind: 'invoice' as const,
      date: getRecordDate(invoice.date, invoice.createdAt),
      createdAt: invoice.createdAt,
      invoice
    })),
    ...payments.map((payment) => ({
      id: payment.id,
      kind: 'payment' as const,
      date: getRecordDate(payment.date, payment.createdAt),
      createdAt: payment.createdAt,
      payment
    }))
  ].sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.createdAt.localeCompare(right.createdAt)
    || (left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind === 'invoice' ? -1 : 1)
  ));
  const netChange = events.reduce((total, event) => {
    if (event.kind === 'invoice') return total + Math.max(0, numberOrZero(event.invoice.totalSales));
    return total - getInvoicePaymentEffect(event.payment) - Math.max(0, numberOrZero(event.payment.amountUsedForOldBalance));
  }, 0);
  let runningBalance = options.endingBalance === undefined
    ? 0
    : Math.max(0, numberOrZero(options.endingBalance) - netChange);

  return events.map((event) => {
    if (event.kind === 'invoice') {
      const invoiceAmount = Math.max(0, numberOrZero(event.invoice.totalSales));
      runningBalance += invoiceAmount;

      return {
        id: `invoice:${event.id}`,
        kind: event.kind,
        date: event.date,
        createdAt: event.createdAt,
        invoiceAmount,
        paymentAmount: 0,
        paymentReceived: 0,
        runningBalance,
        invoice: event.invoice
      };
    }

    const requestedReduction = getInvoicePaymentEffect(event.payment)
      + Math.max(0, numberOrZero(event.payment.amountUsedForOldBalance));
    const paymentAmount = Math.min(runningBalance, requestedReduction);
    runningBalance = Math.max(0, runningBalance - paymentAmount);

    return {
      id: `payment:${event.id}`,
      kind: event.kind,
      date: event.date,
      createdAt: event.createdAt,
      invoiceAmount: 0,
      paymentAmount,
      paymentReceived: Math.max(0, numberOrZero(event.payment.amount)),
      runningBalance,
      payment: event.payment
    };
  });
};
