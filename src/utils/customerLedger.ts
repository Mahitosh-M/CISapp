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
  payments?: Payment[];
};

interface CustomerLedgerOptions {
  endingBalance?: number;
}

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRecordDate = (date: string, createdAt: string) => date || createdAt.slice(0, 10);

const splitPaymentPattern = /\s*\|?\s*Split payment\s+(\d+)\/(\d+)/i;

const sortPayments = (left: Payment, right: Payment) => (
  getRecordDate(left.date, left.createdAt).localeCompare(getRecordDate(right.date, right.createdAt))
  || left.createdAt.localeCompare(right.createdAt)
  || left.id.localeCompare(right.id)
);

const getLegacySplitMeta = (payment: Payment) => {
  const noteMatch = payment.notes.match(splitPaymentPattern);
  const part = Math.round(numberOrZero(payment.splitPaymentPart || noteMatch?.[1]));
  const count = Math.round(numberOrZero(payment.splitPaymentCount || noteMatch?.[2]));
  if (part < 1 || count < 2 || part > count) return undefined;

  const baseNotes = payment.notes.replace(splitPaymentPattern, '').trim();
  return {
    part,
    count,
    key: [
      payment.customerId,
      getRecordDate(payment.date, payment.createdAt),
      payment.mode,
      payment.shopId || '',
      payment.splitPaymentTotalAmount || '',
      baseNotes,
      count
    ].join('|')
  };
};

export const groupPaymentTransactions = (payments: Payment[]) => {
  const groups: Array<{ id: string; payments: Payment[] }> = [];
  const explicitGroups = new Map<string, { id: string; payments: Payment[] }>();
  const openLegacyGroups = new Map<string, {
    id: string;
    payments: Payment[];
    parts: Set<number>;
    count: number;
  }>();
  const legacySequence = new Map<string, number>();

  [...payments].sort(sortPayments).forEach((payment) => {
    if (payment.splitPaymentGroupId) {
      const key = payment.splitPaymentGroupId;
      let group = explicitGroups.get(key);
      if (!group) {
        group = { id: `split:${key}`, payments: [] };
        explicitGroups.set(key, group);
        groups.push(group);
      }
      group.payments.push(payment);
      return;
    }

    const legacyMeta = getLegacySplitMeta(payment);
    if (!legacyMeta) {
      groups.push({ id: `payment:${payment.id}`, payments: [payment] });
      return;
    }

    let group = openLegacyGroups.get(legacyMeta.key);
    if (!group || legacyMeta.part === 1 || group.parts.has(legacyMeta.part) || group.count !== legacyMeta.count) {
      const sequence = (legacySequence.get(legacyMeta.key) ?? 0) + 1;
      legacySequence.set(legacyMeta.key, sequence);
      group = {
        id: `legacy-split:${legacyMeta.key}:${sequence}`,
        payments: [],
        parts: new Set<number>(),
        count: legacyMeta.count
      };
      openLegacyGroups.set(legacyMeta.key, group);
      groups.push(group);
    }

    group.payments.push(payment);
    group.parts.add(legacyMeta.part);
    if (group.parts.size >= group.count) openLegacyGroups.delete(legacyMeta.key);
  });

  return groups.map((group) => {
    const sortedParts = group.payments.sort((left, right) => (
      numberOrZero(left.splitPaymentPart) - numberOrZero(right.splitPaymentPart)
      || sortPayments(left, right)
    ));

    return {
      id: group.id,
      date: getRecordDate(sortedParts[0].date, sortedParts[0].createdAt),
      createdAt: sortedParts.reduce(
        (latest, payment) => payment.createdAt.localeCompare(latest) > 0 ? payment.createdAt : latest,
        sortedParts[0].createdAt
      ),
      payments: sortedParts
    };
  });
};

export const getLedgerPaymentParts = (entry: CustomerLedgerEntry) => (
  entry.payments?.length ? entry.payments : entry.payment ? [entry.payment] : []
);

export const getPaymentNoteWithoutSplitMarker = (payment: Payment) => (
  payment.notes.replace(splitPaymentPattern, '').trim()
);

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
    ...groupPaymentTransactions(payments).map((paymentGroup) => ({
      id: paymentGroup.id,
      kind: 'payment' as const,
      date: paymentGroup.date,
      createdAt: paymentGroup.createdAt,
      payment: paymentGroup.payments[0],
      payments: paymentGroup.payments
    }))
  ].sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.createdAt.localeCompare(right.createdAt)
    || (left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind === 'invoice' ? -1 : 1)
  ));
  const netChange = events.reduce((total, event) => {
    if (event.kind === 'invoice') return total + Math.max(0, numberOrZero(event.invoice.totalSales));
    return total - event.payments.reduce((paymentTotal, payment) => (
      paymentTotal + getInvoicePaymentEffect(payment) + Math.max(0, numberOrZero(payment.amountUsedForOldBalance))
    ), 0);
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

    const requestedReduction = event.payments.reduce((total, payment) => (
      total + getInvoicePaymentEffect(payment) + Math.max(0, numberOrZero(payment.amountUsedForOldBalance))
    ), 0);
    const paymentAmount = Math.min(runningBalance, requestedReduction);
    runningBalance = Math.max(0, runningBalance - paymentAmount);

    return {
      id: event.id,
      kind: event.kind,
      date: event.date,
      createdAt: event.createdAt,
      invoiceAmount: 0,
      paymentAmount,
      paymentReceived: event.payments.reduce(
        (total, payment) => total + Math.max(0, numberOrZero(payment.amount)),
        0
      ),
      runningBalance,
      payment: event.payment,
      payments: event.payments
    };
  });
};
