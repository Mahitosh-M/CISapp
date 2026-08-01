import {
  collection,
  count,
  doc,
  DocumentData,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  QueryDocumentSnapshot,
  query,
  startAfter,
  sum,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import type {
  CreditLimitApprovalStatus,
  CreditStatus,
  CustomerCreditProfile,
  CustomerCreditSummary,
  CustomerTier
} from '../types';

const PROFILE_COLLECTION = 'customerCreditProfiles';
const SUMMARY_COLLECTION = 'customerCreditSummaries';
const PAGE_SIZE = 50;

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const mapCreditStatus = (value: unknown): CreditStatus => {
  return value === 'active' || value === 'hold' || value === 'disabled' ? value : 'starter';
};

const mapApprovalStatus = (value: unknown): CreditLimitApprovalStatus => {
  if (value === 'pending_calculated' || value === 'approved' || value === 'rejected') return value;
  return 'pending_starter';
};

const mapProfile = (snapshot: QueryDocumentSnapshot<DocumentData> | Awaited<ReturnType<typeof getDoc>>): CustomerCreditProfile => {
  const data = snapshot.data() as DocumentData;
  return {
    id: snapshot.id,
    customerId: String(data.customerId || snapshot.id),
    customerName: String(data.customerName || ''),
    tier: (data.tier as CustomerTier) || 'Tier 4',
    creditDays: numberOrZero(data.creditDays),
    currentOutstanding: numberOrZero(data.currentOutstanding),
    confirmedUninvoicedCreditOrders: numberOrZero(data.confirmedUninvoicedCreditOrders),
    creditHistoryDays: Number(data.creditHistoryDays) === 60 ? 60 : 90,
    totalCreditInvoiceAmountInLookback: numberOrZero(data.totalCreditInvoiceAmountInLookback ?? data.totalCreditInvoiceAmountLast90Days),
    averageMonthlyCreditSales: numberOrZero(data.averageMonthlyCreditSales),
    baseCreditLimit: numberOrZero(data.baseCreditLimit),
    calculatedCreditLimit: numberOrZero(data.calculatedCreditLimit),
    approvedCreditLimit: numberOrZero(data.approvedCreditLimit),
    availableCredit: numberOrZero(data.availableCredit),
    paymentFactor: numberOrZero(data.paymentFactor),
    historyFactor: numberOrZero(data.historyFactor),
    onTimePaymentPercentage: numberOrZero(data.onTimePaymentPercentage),
    completedCreditInvoices: numberOrZero(data.completedCreditInvoices),
    overdueAmount: numberOrZero(data.overdueAmount),
    hasOverdueBeyondGrace: data.hasOverdueBeyondGrace === true,
    creditStatus: mapCreditStatus(data.creditStatus),
    creditLimitApprovalStatus: mapApprovalStatus(data.creditLimitApprovalStatus),
    nextInvoiceDueDate: data.nextInvoiceDueDate ? String(data.nextInvoiceDueDate) : undefined,
    nextInvoiceDueAmount: data.nextInvoiceDueAmount === null || data.nextInvoiceDueAmount === undefined ? undefined : numberOrZero(data.nextInvoiceDueAmount),
    lastCreditReviewAt: String(data.lastCreditReviewAt || ''),
    lastCreditReviewReason: data.lastCreditReviewReason ? String(data.lastCreditReviewReason) : undefined,
    creditOverride: data.creditOverride && typeof data.creditOverride === 'object'
      ? {
          amount: numberOrZero(data.creditOverride.amount),
          reason: String(data.creditOverride.reason || ''),
          expiresAt: String(data.creditOverride.expiresAt || ''),
          createdAt: String(data.creditOverride.createdAt || ''),
          createdBy: String(data.creditOverride.createdBy || '')
        }
      : undefined
  };
};

export type CreditPageCursor = QueryDocumentSnapshot<DocumentData>;

export const getCreditProfilesPage = async (cursor?: CreditPageCursor) => {
  const constraints = [orderBy('customerName', 'asc'), limit(PAGE_SIZE)];
  const profilesQuery = cursor
    ? query(collection(db, PROFILE_COLLECTION), orderBy('customerName', 'asc'), startAfter(cursor), limit(PAGE_SIZE))
    : query(collection(db, PROFILE_COLLECTION), ...constraints);
  const snapshot = await getDocs(profilesQuery);
  return {
    rows: snapshot.docs.map(mapProfile),
    cursor: snapshot.docs[snapshot.docs.length - 1],
    hasMore: snapshot.size === PAGE_SIZE
  };
};

export const getCreditDashboardMetrics = async () => {
  const profiles = collection(db, PROFILE_COLLECTION);
  const [totals, holds, starterPending, calculatedPending] = await Promise.all([
    getAggregateFromServer(query(profiles), {
      eligible: count(),
      outstanding: sum('currentOutstanding'),
      available: sum('availableCredit')
    }),
    getAggregateFromServer(query(profiles, where('creditStatus', '==', 'hold')), { value: count() }),
    getAggregateFromServer(query(profiles, where('creditLimitApprovalStatus', '==', 'pending_starter')), { value: count() }),
    getAggregateFromServer(query(profiles, where('creditLimitApprovalStatus', '==', 'pending_calculated')), { value: count() })
  ]);

  return {
    eligibleCustomers: numberOrZero(totals.data().eligible),
    totalOutstanding: numberOrZero(totals.data().outstanding),
    totalAvailableCredit: numberOrZero(totals.data().available),
    customersOnHold: numberOrZero(holds.data().value),
    pendingStarterApprovals: numberOrZero(starterPending.data().value),
    pendingCalculatedApprovals: numberOrZero(calculatedPending.data().value)
  };
};

export const getCustomerCreditSummary = async (customerId: string) => {
  if (!customerId) return undefined;
  const snapshot = await getDoc(doc(db, SUMMARY_COLLECTION, customerId));
  if (!snapshot.exists()) return undefined;
  const data = snapshot.data();
  return {
    id: snapshot.id,
    customerId: String(data.customerId || snapshot.id),
    availableCredit: numberOrZero(data.availableCredit),
    usedCredit: numberOrZero(data.usedCredit),
    creditDays: numberOrZero(data.creditDays),
    nextInvoiceDueDate: data.nextInvoiceDueDate ? String(data.nextInvoiceDueDate) : undefined,
    nextInvoiceDueAmount: data.nextInvoiceDueAmount === null || data.nextInvoiceDueAmount === undefined ? undefined : numberOrZero(data.nextInvoiceDueAmount),
    creditStatus: mapCreditStatus(data.creditStatus),
    updatedAt: String(data.updatedAt || '')
  } satisfies CustomerCreditSummary;
};

export interface ManageCreditInput {
  customerId: string;
  action: 'approve' | 'reject' | 'manual_starter' | 'hold' | 'remove_hold' | 'override' | 'remove_override' | 'recalculate';
  reason?: string;
  amount?: number;
  expiresAt?: string;
  lookbackDays?: 60 | 90;
}

export const manageCustomerCredit = async (input: ManageCreditInput) => {
  const callable = httpsCallable<ManageCreditInput, { ok: boolean }>(functions, 'manageCustomerCredit');
  return (await callable(input)).data;
};

export const saveCreditPolicy = async (starterLimitCap: number, overdueGraceDays: number, lookbackDays: 60 | 90) => {
  const callable = httpsCallable<{ starterLimitCap: number; overdueGraceDays: number; lookbackDays: 60 | 90 }, { ok: boolean }>(functions, 'updateCreditPolicy');
  return (await callable({ starterLimitCap, overdueGraceDays, lookbackDays })).data;
};

export const recalculateAllCustomerCredit = async (lookbackDays: 60 | 90) => {
  const callable = httpsCallable<{ lookbackDays: 60 | 90 }, { ok: boolean; count: number }>(functions, 'recalculateAllCustomerCredit');
  return (await callable({ lookbackDays })).data;
};
