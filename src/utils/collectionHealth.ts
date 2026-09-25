import type { AppSettings, Invoice, Payment, ShopId } from '../types';
import { getBusinessInvoices } from './openingBalance';
import { getAmountAppliedToInvoice, getInvoicePaymentEffect, getPendingAmount } from './paymentUtils';
import { getEffectiveInvoiceDueDate } from './settings';
import { getShopName, isBranchAwareRecord, SHOP_OPTIONS, type AnalyticsShopScope } from './shops';

export interface CollectionHealthPeriod {
  openingOverdue: number;
  becameDue: number;
  totalDue: number;
  dueCollectedCash: number;
  dueSettledDiscount: number;
  uncollectedDue: number;
  closingOverdue: number;
  freshOverdue: number;
  oldOverdueRecovered: number;
  paymentDelays: number[];
}

export interface CollectionHealthCustomer {
  customerId: string;
  customerName: string;
  overdueAmount: number;
  oldestOverdueDays: number;
}

export interface CollectionHealthResult {
  period: CollectionHealthPeriod;
  byShop: Record<ShopId, CollectionHealthPeriod>;
  ageingByShop: Record<ShopId, Record<CollectionAgeBucket, number>>;
  topCustomers: CollectionHealthCustomer[];
}

export type CollectionAgeBucket = '1-7' | '8-15' | '16-30' | '31-60' | '60+';

type SettledPart = { date: string; cash: number; discount: number; effect: number };

const emptyPeriod = (): CollectionHealthPeriod => ({
  openingOverdue: 0,
  becameDue: 0,
  totalDue: 0,
  dueCollectedCash: 0,
  dueSettledDiscount: 0,
  uncollectedDue: 0,
  closingOverdue: 0,
  freshOverdue: 0,
  oldOverdueRecovered: 0,
  paymentDelays: []
});

const emptyAgeing = (): Record<CollectionAgeBucket, number> => ({ '1-7': 0, '8-15': 0, '16-30': 0, '31-60': 0, '60+': 0 });

const daysBetween = (from: string, to: string) => {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  if (!fromYear || !fromMonth || !fromDay || !toYear || !toMonth || !toDay) return 0;
  return Math.max(0, Math.floor((new Date(toYear, toMonth - 1, toDay).getTime() - new Date(fromYear, fromMonth - 1, fromDay).getTime()) / 86400000));
};

const signedDaysBetween = (from: string, to: string) => {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  if (!fromYear || !fromMonth || !fromDay || !toYear || !toMonth || !toDay) return 0;
  return Math.floor((new Date(toYear, toMonth - 1, toDay).getTime() - new Date(fromYear, fromMonth - 1, fromDay).getTime()) / 86400000);
};

const addPeriod = (target: CollectionHealthPeriod, source: CollectionHealthPeriod) => {
  target.openingOverdue += source.openingOverdue;
  target.becameDue += source.becameDue;
  target.totalDue += source.totalDue;
  target.dueCollectedCash += source.dueCollectedCash;
  target.dueSettledDiscount += source.dueSettledDiscount;
  target.uncollectedDue += source.uncollectedDue;
  target.closingOverdue += source.closingOverdue;
  target.freshOverdue += source.freshOverdue;
  target.oldOverdueRecovered += source.oldOverdueRecovered;
  target.paymentDelays.push(...source.paymentDelays);
};

const paymentsForInvoice = (invoice: Invoice, payments: Payment[], endDate: string): SettledPart[] => {
  let remaining = Math.max(0, invoice.totalSales);
  return payments
    .filter((payment) => payment.invoiceId === invoice.id && payment.date <= endDate)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .flatMap((payment) => {
      if (remaining <= 0) return [];
      const cash = Math.min(remaining, getAmountAppliedToInvoice(payment));
      remaining -= cash;
      const discount = Math.min(remaining, Math.max(0, payment.cashDiscount ?? 0));
      remaining -= discount;
      const effect = Math.min(cash + discount, getInvoicePaymentEffect(payment));
      return effect > 0 ? [{ date: payment.date, cash, discount, effect }] : [];
    });
};

const amountBefore = (invoice: Invoice, parts: SettledPart[], date: string) =>
  getPendingAmount(invoice.totalSales, parts.filter((part) => part.date < date).reduce((sum, part) => sum + part.effect, 0));

const amountAtEnd = (invoice: Invoice, parts: SettledPart[]) =>
  getPendingAmount(invoice.totalSales, parts.reduce((sum, part) => sum + part.effect, 0));

const ageBucket = (days: number): CollectionAgeBucket => {
  if (days <= 7) return '1-7';
  if (days <= 15) return '8-15';
  if (days <= 30) return '16-30';
  if (days <= 60) return '31-60';
  return '60+';
};

const resolveDueDate = (invoice: Invoice, settings?: AppSettings) =>
  getEffectiveInvoiceDueDate(invoice.date, invoice.savedDueDate || invoice.dueDate, invoice.tierAtInvoice ?? 'Tier 4', settings);

export const getMedian = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const buildCollectionHealth = (
  invoices: Invoice[],
  payments: Payment[],
  fromDate: string,
  toDate: string,
  settings?: AppSettings,
  scope: AnalyticsShopScope = 'overall'
): CollectionHealthResult => {
  const byShop = Object.fromEntries(SHOP_OPTIONS.map(({ id }) => [id, emptyPeriod()])) as Record<ShopId, CollectionHealthPeriod>;
  const ageingByShop = Object.fromEntries(SHOP_OPTIONS.map(({ id }) => [id, emptyAgeing()])) as Record<ShopId, Record<CollectionAgeBucket, number>>;
  const overall = emptyPeriod();
  const customers = new Map<string, CollectionHealthCustomer>();

  getBusinessInvoices(invoices)
    .filter((invoice) => invoice.date <= toDate)
    .forEach((invoice) => {
      const branchAware = isBranchAwareRecord(invoice);
      if (scope !== 'overall' && (!branchAware || invoice.shopId !== scope)) return;
      const dueDate = resolveDueDate(invoice, settings);
      if (!dueDate || dueDate > toDate) return;
      const parts = paymentsForInvoice(invoice, payments, toDate);
      const opening = dueDate < fromDate ? amountBefore(invoice, parts, fromDate) : 0;
      const dueAtDueDate = dueDate >= fromDate && dueDate <= toDate ? amountBefore(invoice, parts, dueDate) : 0;
      const closing = dueDate < toDate ? amountAtEnd(invoice, parts) : 0;
      const target = branchAware ? byShop[invoice.shopId] : overall;
      const isOpening = opening > 0;
      const dueObligation = isOpening ? opening : dueAtDueDate;
      const dueParts = parts.filter((part) => part.date >= fromDate && part.date <= toDate && part.date >= dueDate);
      let dueRemaining = dueObligation;
      let cashRecovered = 0;
      let discountSettled = 0;
      dueParts.forEach((part) => {
        const cash = Math.min(dueRemaining, part.cash);
        dueRemaining -= cash;
        const discount = Math.min(dueRemaining, part.discount);
        dueRemaining -= discount;
        cashRecovered += cash;
        discountSettled += discount;
      });

      if (isOpening) target.openingOverdue += opening;
      else target.becameDue += dueAtDueDate;
      target.totalDue += dueObligation;
      target.dueCollectedCash += cashRecovered;
      target.dueSettledDiscount += discountSettled;
      target.uncollectedDue += dueRemaining;
      if (isOpening) target.oldOverdueRecovered += cashRecovered + discountSettled;
      else target.freshOverdue += dueRemaining;
      target.closingOverdue += closing;

      if (branchAware && closing > 0) {
        const age = daysBetween(dueDate, toDate);
        ageingByShop[invoice.shopId][ageBucket(age)] += closing;
        const current = customers.get(invoice.customerId) ?? { customerId: invoice.customerId, customerName: invoice.customerName, overdueAmount: 0, oldestOverdueDays: 0 };
        current.overdueAmount += closing;
        current.oldestOverdueDays = Math.max(current.oldestOverdueDays, age);
        customers.set(invoice.customerId, current);
      }

      const finalPart = parts.reduce<SettledPart | undefined>((latest, part) => (latest && latest.date >= part.date ? latest : part), undefined);
      if (finalPart && amountAtEnd(invoice, parts) === 0 && finalPart.date >= fromDate && finalPart.date <= toDate) {
        target.paymentDelays.push(signedDaysBetween(dueDate, finalPart.date));
      }
    });

  if (scope === 'overall') {
    SHOP_OPTIONS.forEach(({ id }) => addPeriod(overall, byShop[id]));
  } else {
    Object.assign(overall, byShop[scope]);
  }

  return {
    period: overall,
    byShop,
    ageingByShop,
    topCustomers: [...customers.values()].sort((left, right) => right.overdueAmount - left.overdueAmount).slice(0, 5)
  };
};

export const getCollectionInsight = (shopId: ShopId, period: CollectionHealthPeriod) => {
  const shop = getShopName(shopId);
  const netChange = period.closingOverdue - period.openingOverdue;
  if (netChange > 0) return `${shop} closing overdue increased by ₹${Math.round(netChange).toLocaleString('en-IN')} in this period.`;
  if (netChange < 0) return `${shop} closing overdue reduced by ₹${Math.round(Math.abs(netChange)).toLocaleString('en-IN')} in this period.`;
  return `${shop} closing overdue was unchanged in this period.`;
};
