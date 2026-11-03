import type {Invoice,Payment} from '../types';
import {getInvoicePaymentEffect} from './paymentUtils';
import {isOpeningBalanceInvoice} from './openingBalance';
import {getShopName} from './shops';
interface OutstandingHistoryItem {
  id: string;
  type: 'invoice' | 'payment';
  date: string;
  transactionAmount: number;
  transactionCount: number;
  previousOutstanding: number;
  currentOutstanding: number;
  shopName?: string;
}

interface PaymentLedgerEvent {
  id: string;
  type: 'payment';
  date: string;
  createdAt?: string;
  order: number;
  amount: number;
  shopName: string;
}

const splitPaymentPattern = /Split payment\s+(\d+)\/(\d+)/i;

const getPaymentOutstandingEffect = (payment: Payment) => (
  getInvoicePaymentEffect(payment) + Math.max(0, payment.amountUsedForOldBalance ?? 0)
);

const getCustomerPaymentShopName = (payment: Payment) => {
  if (payment.shopId === 'SHOP_S') return 'SND';
  if (payment.shopId === 'SHOP_A') return 'MSK';
  return getShopName(payment.shopId);
};

const getPaymentGroupKey = (payment: Payment) => {
  if (payment.splitPaymentGroupId) return `split:${payment.splitPaymentGroupId}`;

  const splitMatch = payment.notes.match(splitPaymentPattern);
  if (!splitMatch) return `payment:${payment.id}`;

  const baseNotes = payment.notes.replace(/\s*\|?\s*Split payment\s+\d+\/\d+/i, '').trim();
  return `legacy-split:${payment.customerId}|${payment.date}|${payment.mode}|${baseNotes}|${splitMatch[2]}`;
};

const buildPaymentLedgerEvents = (payments: Payment[]) => {
  const groupedEvents = new Map<string, PaymentLedgerEvent>();

  payments.forEach((payment) => {
    const groupKey = getPaymentGroupKey(payment);
    const existingEvent = groupedEvents.get(groupKey);
    const paymentEffect = getPaymentOutstandingEffect(payment);

    if (existingEvent) {
      existingEvent.amount += paymentEffect;

      if ((payment.createdAt ?? '') > (existingEvent.createdAt ?? '')) {
        existingEvent.createdAt = payment.createdAt;
      }
      return;
    }

    groupedEvents.set(groupKey, {
      id: groupKey,
      type: 'payment',
      date: payment.date,
      createdAt: payment.createdAt,
      order: 1,
      amount: paymentEffect,
      shopName: getCustomerPaymentShopName(payment)
    });
  });

  return Array.from(groupedEvents.values());
};

const compareLedgerDates = (
  left: { date: string; createdAt?: string; id: string; order: number },
  right: { date: string; createdAt?: string; id: string; order: number }
) => (
  left.date.localeCompare(right.date)
  || (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
  || left.order - right.order
  || left.id.localeCompare(right.id)
);

const outstandingMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const formatOutstandingDate = (dateString: string) => {
  const [, month = '', day = ''] = dateString.match(/^\d{4}-(\d{2})-(\d{2})/) ?? [];
  const monthLabel = outstandingMonths[Number(month) - 1];
  return monthLabel && day ? `${Number(day)} ${monthLabel}` : dateString;
};

export const buildOutstandingHistory = (
  invoices: Invoice[],
  payments: Payment[],
  currentOutstanding: number
): OutstandingHistoryItem[] => {
  const events = [
    ...invoices.map((invoice) => ({
      id: invoice.id,
      type: isOpeningBalanceInvoice(invoice) ? 'opening_balance' as const : 'invoice' as const,
      date: invoice.date,
      createdAt: invoice.createdAt,
      order: 0,
      amount: Math.max(0, invoice.totalSales || invoice.salesAmount)
    })),
    ...buildPaymentLedgerEvents(payments).filter((payment) => payment.amount > 0)
  ].sort(compareLedgerDates).reverse();

  let runningOutstanding = Math.max(0, currentOutstanding);
  const newestHistory: OutstandingHistoryItem[] = [];
  let eventIndex = 0;
  let paymentCount = 0;

  while (eventIndex < events.length) {
    const event = events[eventIndex];

    if (event.type === 'opening_balance') {
      runningOutstanding = Math.max(0, runningOutstanding - event.amount);
      eventIndex += 1;
      continue;
    }

    if (event.type === 'payment') {
      if (paymentCount === 3) break;

      newestHistory.push({
        id: event.id,
        type: 'payment',
        date: event.date,
        transactionAmount: event.amount,
        transactionCount: 1,
        previousOutstanding: runningOutstanding + event.amount,
        currentOutstanding: runningOutstanding,
        shopName: event.shopName
      });
      runningOutstanding += event.amount;
      paymentCount += 1;
      eventIndex += 1;
      continue;
    }

    const currentAfterInvoices = runningOutstanding;
    const latestInvoiceDate = event.date;
    const invoiceIds: string[] = [];
    let invoiceAmount = 0;

    while (eventIndex < events.length && events[eventIndex].type === 'invoice') {
      invoiceIds.push(events[eventIndex].id);
      invoiceAmount += events[eventIndex].amount;
      eventIndex += 1;
    }

    const previousBeforeInvoices = Math.max(0, currentAfterInvoices - invoiceAmount);
    newestHistory.push({
      id: `invoices:${invoiceIds.join(':')}`,
      type: 'invoice',
      date: latestInvoiceDate,
      transactionAmount: invoiceAmount,
      transactionCount: invoiceIds.length,
      previousOutstanding: previousBeforeInvoices,
      currentOutstanding: currentAfterInvoices
    });
    runningOutstanding = previousBeforeInvoices;
  }

  return newestHistory;
};

