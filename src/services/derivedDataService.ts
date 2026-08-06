import {
  collection,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  orderBy,
  QueryDocumentSnapshot,
  query,
  startAfter,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import type { CustomerIntelligenceSummary } from '../types';
import { calculateCustomerCredit, type CreditDocumentData } from '../utils/creditCalculation';
import { buildSingleCustomerScore } from '../utils/customerAnalytics';
import { isValidBonusInvoice } from '../utils/bonusPc';
import { getPaymentTermsLabel } from '../utils/settings';
import {
  getAppSettings,
  getCustomerById,
  getInvoicesByCustomerId,
  getPaymentsByCustomerId,
  patchCachedCustomer
} from './firestoreService';

const INTELLIGENCE_SUMMARIES = 'customerIntelligenceSummaries';
const CREDIT_PROFILES = 'customerCreditProfiles';
const CREDIT_SUMMARIES = 'customerCreditSummaries';
const PC_BALANCES = 'pcBalances';
const CUSTOMERS = 'customers';
const CUSTOMER_MONTHLY_SNAPSHOTS = 'customerMonthlySnapshots';
const PAGE_SIZE = 50;

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefinedDeep(item)])
  );
};

const mapIntelligenceSummary = (
  snapshot: QueryDocumentSnapshot<DocumentData> | Awaited<ReturnType<typeof getDoc>>
) => ({
  id: snapshot.id,
  ...(snapshot.data() as Omit<CustomerIntelligenceSummary, 'id'>)
}) as CustomerIntelligenceSummary;

export type IntelligencePageCursor = QueryDocumentSnapshot<DocumentData>;

export const getIntelligenceSummariesPage = async (cursor?: IntelligencePageCursor) => {
  const summaryQuery = cursor
    ? query(
        collection(db, INTELLIGENCE_SUMMARIES),
        orderBy('intelligenceScore', 'desc'),
        startAfter(cursor),
        limit(PAGE_SIZE)
      )
    : query(collection(db, INTELLIGENCE_SUMMARIES), orderBy('intelligenceScore', 'desc'), limit(PAGE_SIZE));
  const snapshot = await getDocs(summaryQuery);
  return {
    rows: snapshot.docs.map(mapIntelligenceSummary),
    cursor: snapshot.docs[snapshot.docs.length - 1],
    hasMore: snapshot.size === PAGE_SIZE
  };
};

export const getCustomerIntelligenceSummary = async (customerId: string) => {
  if (!customerId) return undefined;
  const snapshot = await getDoc(doc(db, INTELLIGENCE_SUMMARIES, customerId));
  return snapshot.exists() ? mapIntelligenceSummary(snapshot) : undefined;
};

const rebuildCustomerMonthlySnapshots = async (
  customerId: string,
  invoices: Awaited<ReturnType<typeof getInvoicesByCustomerId>>,
  payments: Awaited<ReturnType<typeof getPaymentsByCustomerId>>
) => {
  const totalsByMonth = new Map<string, { totalSales: number; totalProfit: number; invoiceCount: number; paymentsReceived: number }>();
  const getMonthTotals = (month: string) => {
    const existing = totalsByMonth.get(month);
    if (existing) return existing;
    const created = { totalSales: 0, totalProfit: 0, invoiceCount: 0, paymentsReceived: 0 };
    totalsByMonth.set(month, created);
    return created;
  };

  invoices.filter(isValidBonusInvoice).forEach((invoice) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.date)) return;
    const totals = getMonthTotals(invoice.date.slice(0, 7));
    totals.totalSales += Math.max(0, Number(invoice.totalSales) || 0);
    totals.totalProfit += Number(invoice.totalProfit) || 0;
    totals.invoiceCount += 1;
  });
  payments.forEach((payment) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) return;
    getMonthTotals(payment.date.slice(0, 7)).paymentsReceived += Math.max(0, Number(payment.amount) || 0);
  });

  const existingSnapshot = await getDocs(query(
    collection(db, CUSTOMER_MONTHLY_SNAPSHOTS),
    where('customerId', '==', customerId)
  ));
  const months = new Set([
    ...totalsByMonth.keys(),
    ...existingSnapshot.docs
      .map((snapshot) => String(snapshot.data().month || ''))
      .filter((month) => /^\d{4}-\d{2}$/.test(month))
  ]);
  const timestamp = new Date().toISOString();
  const rows = [...months].sort().map((month) => ({
    month,
    ...(totalsByMonth.get(month) ?? { totalSales: 0, totalProfit: 0, invoiceCount: 0, paymentsReceived: 0 })
  }));

  for (let index = 0; index < rows.length; index += 400) {
    const batch = writeBatch(db);
    rows.slice(index, index + 400).forEach((row) => {
      batch.set(doc(db, CUSTOMER_MONTHLY_SNAPSHOTS, `${customerId}_${row.month}`), {
        customerId,
        ...row,
        needsBackfill: false,
        updatedAt: timestamp
      });
    });
    await batch.commit();
  }
};

export const recalculateCustomerDerivedData = async (
  customerId: string,
  reviewReason = 'transaction_change',
  options?: { rebuildMonthlySnapshots?: boolean }
) => {
  if (!customerId) return undefined;
  const intelligenceRef = doc(db, INTELLIGENCE_SUMMARIES, customerId);
  const creditProfileRef = doc(db, CREDIT_PROFILES, customerId);
  const [customer, invoices, payments, settings, previousIntelligence, existingCredit, pcBalance] = await Promise.all([
    getCustomerById(customerId),
    getInvoicesByCustomerId(customerId),
    getPaymentsByCustomerId(customerId),
    getAppSettings(),
    getDoc(intelligenceRef),
    getDoc(creditProfileRef),
    getDoc(doc(db, PC_BALANCES, customerId))
  ]);
  if (!customer) return undefined;

  const previousScore = previousIntelligence.exists() ? mapIntelligenceSummary(previousIntelligence) : undefined;
  const score = buildSingleCustomerScore(customer, invoices, payments, new Date(), settings, previousScore);
  const scoreWithAvailablePc = score ? {
    ...score,
    giftBudget: Math.max(0, Number(pcBalance.data()?.availablePc) || 0)
  } : undefined;
  const scoredCustomer = scoreWithAvailablePc ? { ...customer, tier: scoreWithAvailablePc.tier } : customer;
  const credit = calculateCustomerCredit({
    customerId,
    customer: scoredCustomer as unknown as CreditDocumentData,
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      data: { ...invoice, status: invoice.recordStatus } as unknown as CreditDocumentData
    })),
    payments: payments.map((payment) => ({ id: payment.id, data: payment as unknown as CreditDocumentData })),
    settings: settings as unknown as CreditDocumentData,
    existingProfile: (existingCredit.data() ?? {}) as CreditDocumentData,
    reviewReason
  });
  const calculatedAt = new Date().toISOString();
  const batch = writeBatch(db);

  if (scoreWithAvailablePc) {
    batch.set(intelligenceRef, stripUndefinedDeep({ ...scoreWithAvailablePc, calculatedAt }) as DocumentData);
    if (scoreWithAvailablePc.tier !== customer.tier) {
      batch.update(doc(db, CUSTOMERS, customerId), {
        tier: scoreWithAvailablePc.tier,
        paymentTerms: getPaymentTermsLabel(scoreWithAvailablePc.tier, settings),
        updatedAt: calculatedAt
      });
    }
  }
  batch.set(creditProfileRef, stripUndefinedDeep(credit.profile) as DocumentData);
  batch.set(doc(db, CREDIT_SUMMARIES, customerId), stripUndefinedDeep(credit.summary) as DocumentData);
  await batch.commit();

  if (scoreWithAvailablePc && scoreWithAvailablePc.tier !== customer.tier) {
    patchCachedCustomer(customerId, {
      tier: scoreWithAvailablePc.tier,
      paymentTerms: getPaymentTermsLabel(scoreWithAvailablePc.tier, settings),
      updatedAt: calculatedAt
    });
  }

  if (options?.rebuildMonthlySnapshots) {
    await rebuildCustomerMonthlySnapshots(customerId, invoices, payments);
  }

  return { score: scoreWithAvailablePc, credit };
};
