import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  QueryConstraint,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import type { Transaction } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Customer,
  CustomerFormData,
  CustomerTier,
  DueCustomerRecord,
  DueCustomerRow,
  AppSettings,
  BonusPcRequest,
  BonusPcRequestStatus,
  BonusPcType,
  GiftItem,
  GiftItemFormData,
  GiftHistory,
  GiftHistoryFormData,
  Invoice,
  InvoiceFormData,
  Offer,
  OfferFormData,
  Payment,
  PaymentFormData,
  BusinessMonthlySnapshot,
  CustomerMonthlySnapshot,
  MonthlyCustomerStats,
  LoyaltyLedgerEntry,
  PcBalanceRecord,
  OverduePcRequest,
  OverduePcRequestStatus,
  RewardFormData,
  RewardItem,
  RedemptionRequest,
  RedemptionStatus,
  ShopId,
  UserProfile,
  UserRole
} from '../types';
import {
  DEFAULT_SETTINGS,
  buildInvoiceTimeTerms,
  calculateDynamicDueDate,
  getEffectiveInvoiceDueDate,
  getPaymentTermsLabel,
  mergeWithDefaultSettings,
  validateAppSettings
} from '../utils/settings';
import { isOfferCurrentlyActive, sortOffersByLatest } from '../utils/offers';
import { calculateInvoiceApcInfo, getInvoiceFullPaymentDate, getInvoiceFullPaymentEvent } from '../utils/customerPortal';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { buildMonthlyCustomerStats, canViewRewardAtLevel, getCurrentMonthKey, getMonthlyStatsId } from '../utils/loyalty';
import {
  getOpeningBalanceInvoiceId,
  getOpeningBalanceInvoiceNumber,
  isOpeningBalanceInvoice,
  OPENING_BALANCE_INVOICE_TYPE,
  prepareOpeningBalanceInvoiceEdit
} from '../utils/openingBalance';
import { getUnpaidInvoicesAfterPayment } from '../utils/paymentAllocation';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';
import {
  applyCustomerOutstandingDelta,
  buildInvoiceBalanceCheckpoints,
  combineCustomerOutstandingDeltas,
  type CustomerOutstandingDelta
} from '../utils/customerOutstanding';
import {
  CURRENT_PC_POLICY_VERSION,
  canPostInvoicePcForSettlement,
  decideImmutableInvoicePcAward
} from '../utils/pcAwardPolicy';
import {
  buildAutomaticBonusCandidates,
  FIXED_BONUS_PC,
  getBonusPcLedgerId,
  getNewCustomerBonusRequestIds,
  getReferralBonusId,
  isInvoiceFullyPaidThrough,
  isValidBonusInvoice
} from '../utils/bonusPc';
import {
  BRANCH_SYSTEM_VERSION,
  buildShopCashAdjustments,
  getNextCashSyncedAmount,
  isBranchAwareRecord,
  isShopId,
  resolveNewRecordShopId,
  type ShopCashAdjustment
} from '../utils/shops';

const CUSTOMERS = 'customers';
const INVOICES = 'invoices';
const PAYMENTS = 'payments';
const SETTINGS = 'settings';
const APP_SETTINGS_DOC_ID = 'appSettings';
const GIFT_HISTORY = 'giftHistory';
const GIFT_ITEMS = 'giftItems';
const USERS = 'users';
const OFFERS = 'offers';
const MONTHLY_CUSTOMER_STATS = 'monthlyCustomerStats';
const LOYALTY_LEDGER = 'loyaltyLedger';
const PC_BALANCES = 'pcBalances';
const REWARD_ITEMS = 'rewardItems';
const REDEMPTION_REQUESTS = 'redemptionRequests';
const OVERDUE_PC_REQUESTS = 'overduePcRequests';
const BONUS_PC_REQUESTS = 'bonusPcRequests';
const COUNTERS = 'counters';
const CUSTOMER_MONTHLY_SNAPSHOTS = 'customerMonthlySnapshots';
const BUSINESS_MONTHLY_SNAPSHOTS = 'businessMonthlySnapshots';
const DUE_CUSTOMERS = 'dueCustomers';
const SHOP_CASH = 'shopCash';
const DEFAULT_LIST_LIMIT = 50;
const ACTIVE_OFFER_LIMIT = 20;
const ACTIVE_REWARD_LIMIT = 50;
const READ_CACHE_TTL_MS = 5 * 60 * 1000;

export interface AuditUser {
  userId?: string;
  userEmail?: string;
  role?: UserRole;
  shopId?: ShopId;
}

export type InvoicePcAwardStatus =
  | 'credited'
  | 'finalized_zero'
  | 'already_finalized'
  | 'not_fully_paid'
  | 'not_eligible'
  | 'not_applicable';

export interface InvoicePcAwardResult {
  invoiceId: string;
  status: InvoicePcAwardStatus;
  points: number;
  availablePc?: number;
}

export interface TransactionPostProcessingWarning {
  area: 'monthly_snapshot' | 'financial_summary' | 'pc';
  message: string;
  referenceId?: string;
}

export interface PaymentSaveResult {
  paymentId: string;
  pcAwards: InvoicePcAwardResult[];
  warnings: TransactionPostProcessingWarning[];
}

export interface InvoicePcRetryFailure {
  invoiceId: string;
  permissionDenied: boolean;
}

interface DateRangeQueryOptions {
  fromDate?: string;
  toDate?: string;
  limitCount?: number;
  sortBy?: 'date' | 'invoiceNumber' | 'createdAt';
}

interface CustomerScopedQueryOptions extends DateRangeQueryOptions {
  customerId?: string;
  customerName?: string;
}

interface CustomerQueryOptions {
  limitCount?: number;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
}

const nowIso = () => new Date().toISOString();

const getTodayDateString = () => nowIso().slice(0, 10);

const mapLoyaltyLedgerEntry = (id: string, data: Record<string, unknown>): LoyaltyLedgerEntry => ({
  id,
  customerId: String(data.customerId || ''),
  type: data.type as LoyaltyLedgerEntry['type'],
  points: numberOrZero(data.points),
  reason: String(data.reason || ''),
  referenceId: String(data.referenceId || ''),
  month: String(data.month || ''),
  createdAt: String(data.createdAt || '')
});

const mapPcBalanceRecord = (id: string, data: Record<string, unknown>): PcBalanceRecord => ({
  id,
  customerId: String(data.customerId || id),
  availablePc: Math.max(0, Math.round(numberOrZero(data.availablePc))),
  incomingPc: Math.max(0, Math.round(numberOrZero(data.incomingPc))),
  redeemedPc: Math.max(0, Math.round(numberOrZero(data.redeemedPc))),
  protectedAt: String(data.protectedAt || ''),
  lastAwardReferenceId: data.lastAwardReferenceId ? String(data.lastAwardReferenceId) : undefined,
  lastMutationReferenceId: data.lastMutationReferenceId ? String(data.lastMutationReferenceId) : undefined,
  updatedAt: String(data.updatedAt || '')
});

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const readCache = new Map<string, CacheEntry<unknown>>();

const getCached = async <T,>(key: string, loader: () => Promise<T>, ttlMs = READ_CACHE_TTL_MS): Promise<T> => {
  const cached = readCache.get(key) as CacheEntry<T> | undefined;

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = await loader();
  readCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
};

export const clearFirestoreSessionCache = (prefix?: string) => {
  if (!prefix) {
    readCache.clear();
    appSettingsCache = undefined;
    return;
  }

  [...readCache.keys()].forEach((key) => {
    if (key.startsWith(prefix)) readCache.delete(key);
  });

  if (prefix === SETTINGS) appSettingsCache = undefined;
};

export const patchCachedCustomer = (customerId: string, updates: Partial<Customer>) => {
  [...readCache.entries()].forEach(([key, entry]) => {
    if (!key.startsWith(`${CUSTOMERS}:`) || !Array.isArray(entry.value)) return;
    entry.value = entry.value.map((item) => (
      item && typeof item === 'object' && 'id' in item && item.id === customerId
        ? { ...item, ...updates }
        : item
    ));
  });
};

const invalidateDateScopedCache = (collectionName: string, affectedDates: string[]) => {
  [...readCache.keys()].forEach((key) => {
    if (!key.startsWith(`${collectionName}:`)) return;
    try {
      const options = JSON.parse(key.slice(collectionName.length + 1)) as {
        fromDate?: string;
        toDate?: string;
        fromMonth?: string;
        toMonth?: string;
      };
      const affectsQuery = affectedDates.some((date) => {
        const month = date.slice(0, 7);
        if (options.fromDate || options.toDate) {
          return (!options.fromDate || date >= options.fromDate) && (!options.toDate || date <= options.toDate);
        }
        if (options.fromMonth || options.toMonth) {
          return (!options.fromMonth || month >= options.fromMonth) && (!options.toMonth || month <= options.toMonth);
        }
        return true;
      });
      if (affectsQuery) readCache.delete(key);
    } catch {
      readCache.delete(key);
    }
  });
};

const invalidateTransactionCaches = (customerIds: string[], affectedDates: string[]) => {
  invalidateDateScopedCache(INVOICES, affectedDates);
  invalidateDateScopedCache(PAYMENTS, affectedDates);
  invalidateDateScopedCache(BUSINESS_MONTHLY_SNAPSHOTS, affectedDates);
  customerIds.filter(Boolean).forEach((customerId) => {
    clearFirestoreSessionCache(`${CUSTOMER_MONTHLY_SNAPSHOTS}:${customerId}`);
    clearFirestoreSessionCache(`${PC_BALANCES}:${customerId}`);
  });
};

const cacheKey = (collectionName: string, options?: unknown) => `${collectionName}:${JSON.stringify(options ?? {})}`;

interface MonthlySnapshotDelta {
  customerId: string;
  date: string;
  totalSales?: number;
  totalProfit?: number;
  invoiceCount?: number;
  paymentsReceived?: number;
}

const getSnapshotMonth = (date: string) => /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : '';

const applyMonthlySnapshotDeltas = async (deltas: MonthlySnapshotDelta[]) => {
  const groupedByCustomer = new Map<string, Required<Omit<MonthlySnapshotDelta, 'date'>> & { month: string }>();
  const groupedBusiness = new Map<string, Omit<Required<MonthlySnapshotDelta>, 'customerId' | 'date'> & { month: string }>();

  deltas.forEach((delta) => {
    const month = getSnapshotMonth(delta.date);
    if (!delta.customerId || !month) return;
    const customerKey = `${delta.customerId}_${month}`;
    const customerRow = groupedByCustomer.get(customerKey) ?? {
      customerId: delta.customerId,
      month,
      totalSales: 0,
      totalProfit: 0,
      invoiceCount: 0,
      paymentsReceived: 0
    };
    customerRow.totalSales += numberOrZero(delta.totalSales);
    customerRow.totalProfit += numberOrZero(delta.totalProfit);
    customerRow.invoiceCount += numberOrZero(delta.invoiceCount);
    customerRow.paymentsReceived += numberOrZero(delta.paymentsReceived);
    groupedByCustomer.set(customerKey, customerRow);

    const businessRow = groupedBusiness.get(month) ?? {
      month,
      totalSales: 0,
      totalProfit: 0,
      invoiceCount: 0,
      paymentsReceived: 0
    };
    businessRow.totalSales += numberOrZero(delta.totalSales);
    businessRow.totalProfit += numberOrZero(delta.totalProfit);
    businessRow.invoiceCount += numberOrZero(delta.invoiceCount);
    businessRow.paymentsReceived += numberOrZero(delta.paymentsReceived);
    groupedBusiness.set(month, businessRow);
  });

  if (groupedByCustomer.size === 0) return;
  const timestamp = nowIso();
  await runTransaction(db, async (transaction) => {
    const customerRefs = [...groupedByCustomer.keys()].map((id) => doc(db, CUSTOMER_MONTHLY_SNAPSHOTS, id));
    const businessRefs = [...groupedBusiness.keys()].map((month) => doc(db, BUSINESS_MONTHLY_SNAPSHOTS, month));
    const [customerSnapshots, businessSnapshots] = await Promise.all([
      Promise.all(customerRefs.map((ref) => transaction.get(ref))),
      Promise.all(businessRefs.map((ref) => transaction.get(ref)))
    ]);

    customerSnapshots.forEach((snapshot, index) => {
      const delta = groupedByCustomer.get(snapshot.id);
      if (!delta) return;
      const existing = snapshot.data() ?? {};
      transaction.set(snapshot.ref, {
        customerId: delta.customerId,
        month: delta.month,
        totalSales: Math.max(0, numberOrZero(existing.totalSales) + delta.totalSales),
        totalProfit: numberOrZero(existing.totalProfit) + delta.totalProfit,
        invoiceCount: Math.max(0, Math.round(numberOrZero(existing.invoiceCount) + delta.invoiceCount)),
        paymentsReceived: Math.max(0, numberOrZero(existing.paymentsReceived) + delta.paymentsReceived),
        needsBackfill: snapshot.exists() ? existing.needsBackfill === true : true,
        updatedAt: timestamp
      });
    });

    businessSnapshots.forEach((snapshot) => {
      const delta = groupedBusiness.get(snapshot.id);
      if (!delta) return;
      const existing = snapshot.data() ?? {};
      transaction.set(snapshot.ref, {
        month: delta.month,
        totalSales: Math.max(0, numberOrZero(existing.totalSales) + delta.totalSales),
        totalProfit: numberOrZero(existing.totalProfit) + delta.totalProfit,
        invoiceCount: Math.max(0, Math.round(numberOrZero(existing.invoiceCount) + delta.invoiceCount)),
        paymentsReceived: Math.max(0, numberOrZero(existing.paymentsReceived) + delta.paymentsReceived),
        needsBackfill: snapshot.exists() ? existing.needsBackfill === true : true,
        updatedAt: timestamp
      });
    });
  });
};

const withoutUndefined = <T extends Record<string, unknown>>(payload: T) => {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<T>;
};

const omitInvoiceBranchFields = (invoice: InvoiceFormData) => {
  const { shopId: _shopId, branchSystemVersion: _branchSystemVersion, ...legacyFields } = invoice;
  return legacyFields;
};

const omitPaymentBranchFields = (payment: PaymentFormData) => {
  const {
    shopId: _shopId,
    branchSystemVersion: _branchSystemVersion,
    affectsShopCash: _affectsShopCash,
    cashSyncedAmount: _cashSyncedAmount,
    ...legacyFields
  } = payment;
  return legacyFields;
};

const getNewRecordShopId = (
  selectedShopId: ShopId | undefined,
  auditUser: AuditUser | undefined,
  recordLabel: 'invoice' | 'payment'
) => {
  const resolvedShopId = resolveNewRecordShopId(auditUser?.role, auditUser?.shopId, selectedShopId);

  if (auditUser?.role === 'Admin') {
    if (!resolvedShopId) {
      throw new Error(`Select a shop before saving this ${recordLabel}.`);
    }
  }

  return resolvedShopId;
};

const prepareNewInvoicePayload = (invoice: InvoiceFormData, auditUser?: AuditUser): InvoiceFormData => {
  const legacyFields = omitInvoiceBranchFields(invoice);
  const shopId = getNewRecordShopId(invoice.shopId, auditUser, 'invoice');

  return shopId
    ? { ...legacyFields, shopId, branchSystemVersion: BRANCH_SYSTEM_VERSION }
    : legacyFields;
};

const prepareExistingInvoicePayload = (
  existingInvoice: Invoice,
  invoice: InvoiceFormData,
  auditUser?: AuditUser
): InvoiceFormData => {
  const legacyFields = omitInvoiceBranchFields(invoice);
  if (!isBranchAwareRecord(existingInvoice)) return legacyFields;

  if (auditUser?.role === 'Staff' && isShopId(auditUser.shopId) && auditUser.shopId !== existingInvoice.shopId) {
    throw new Error('This invoice belongs to another shop and cannot be edited by this staff account.');
  }

  return {
    ...legacyFields,
    shopId: existingInvoice.shopId,
    branchSystemVersion: BRANCH_SYSTEM_VERSION
  };
};

const prepareNewPaymentPayload = (payment: PaymentFormData, auditUser?: AuditUser): PaymentFormData => {
  const legacyFields = omitPaymentBranchFields(payment);
  const shopId = getNewRecordShopId(payment.shopId, auditUser, 'payment');

  return shopId
    ? {
        ...legacyFields,
        shopId,
        branchSystemVersion: BRANCH_SYSTEM_VERSION,
        affectsShopCash: payment.affectsShopCash !== false
      }
    : legacyFields;
};

const prepareExistingPaymentPayload = (
  existingPayment: Payment,
  payment: PaymentFormData,
  auditUser?: AuditUser
): PaymentFormData => {
  const legacyFields = omitPaymentBranchFields(payment);
  if (!isBranchAwareRecord(existingPayment)) return legacyFields;

  let shopId = existingPayment.shopId;
  if (auditUser?.role === 'Admin') {
    if (!isShopId(payment.shopId)) throw new Error('Select a shop before updating this payment.');
    shopId = payment.shopId;
  } else if (auditUser?.role === 'Staff' && isShopId(auditUser.shopId)) {
    if (auditUser.shopId !== existingPayment.shopId) {
      throw new Error('This payment belongs to another shop and cannot be edited by this staff account.');
    }
    shopId = auditUser.shopId;
  }

  return {
    ...legacyFields,
    shopId,
    branchSystemVersion: BRANCH_SYSTEM_VERSION,
    affectsShopCash: payment.affectsShopCash ?? existingPayment.affectsShopCash ?? true
  };
};

const combineShopCashAdjustments = (adjustments: ShopCashAdjustment[]) => {
  const totals = adjustments.reduce((result, adjustment) => {
    result.set(adjustment.shopId, (result.get(adjustment.shopId) ?? 0) + adjustment.amount);
    return result;
  }, new Map<ShopId, number>());

  return [...totals.entries()]
    .map(([shopId, amount]) => ({ shopId, amount }))
    .filter((adjustment) => adjustment.amount !== 0);
};

type ShopCashCrmOperation = {
  id: string;
  type: 'payment' | 'invoice_delete';
};

const applyShopCashAdjustments = (
  transaction: Transaction,
  adjustments: ShopCashAdjustment[],
  timestamp: string,
  operation: ShopCashCrmOperation
) => {
  combineShopCashAdjustments(adjustments).forEach(({ shopId, amount }) => {
    transaction.set(doc(db, SHOP_CASH, shopId), {
      shopId,
      availableBalance: increment(amount),
      totalCollections: increment(amount),
      lastCashOperationId: operation.id,
      lastCashOperationType: operation.type,
      updatedAt: timestamp
    }, { merge: true });
  });
};

const buildOpeningBalanceInvoicePayload = (customerId: string, customer: CustomerFormData, amount: number, createdAt: string) => {
  const customerCreationDate = createdAt.slice(0, 10);

  return {
    invoiceNumber: getOpeningBalanceInvoiceNumber(customerId),
    customerId,
    customerName: customer.name,
    invoiceType: OPENING_BALANCE_INVOICE_TYPE,
    isOpeningBalance: true,
    date: customerCreationDate,
    dueDate: customerCreationDate,
    salesAmount: amount,
    costAmount: 0,
    transportAmount: 0,
    totalSales: amount,
    totalCost: 0,
    totalProfit: 0,
    customerBalanceBeforeInvoice: 0,
    customerBalanceAfterInvoice: amount,
    notes: 'Opening balance from previous outstanding',
    createdAt,
    updatedAt: createdAt
  };
};

export async function syncCustomerFinancialSummary(customerId: string) {
  if (!customerId) {
    return {
      totalOutstandingAmount: 0,
      invoiceOutstandingAmount: 0,
      openingBalanceOutstandingAmount: 0
    };
  }

  const [invoiceSnapshot, paymentSnapshot] = await Promise.all([
    getDocs(query(collection(db, INVOICES), where('customerId', '==', customerId))),
    getDocs(query(collection(db, PAYMENTS), where('customerId', '==', customerId)))
  ]);
  const invoices = invoiceSnapshot.docs.map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()));
  const payments = paymentSnapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
  const advanceBalance = Math.max(
    0,
    payments.reduce(
      (balance, payment) => balance + payment.advanceCreatedAmount - payment.advanceAppliedAmount,
      0
    )
  );
  const invoicePaymentEffectByInvoiceId = payments.reduce((paymentMap, payment) => {
    if (!payment.invoiceId) return paymentMap;
    paymentMap.set(payment.invoiceId, (paymentMap.get(payment.invoiceId) ?? 0) + getInvoicePaymentEffect(payment));
    return paymentMap;
  }, new Map<string, number>());
  const summary = invoices.reduce(
    (totals, invoice) => {
      const outstanding = getPendingAmount(invoice.totalSales, invoicePaymentEffectByInvoiceId.get(invoice.id) ?? 0);

      if (isOpeningBalanceInvoice(invoice)) {
        totals.openingBalanceOutstandingAmount += outstanding;
      } else {
        totals.invoiceOutstandingAmount += outstanding;
      }

      return totals;
    },
    {
      invoiceOutstandingAmount: 0,
      openingBalanceOutstandingAmount: 0
    }
  );
  const totalOutstandingAmount = summary.invoiceOutstandingAmount + summary.openingBalanceOutstandingAmount;
  const invoiceLedger = buildInvoiceBalanceCheckpoints(invoices, payments);
  if (invoiceLedger.latestInvoiceId) {
    invoiceLedger.balanceByInvoiceId[invoiceLedger.latestInvoiceId] = totalOutstandingAmount;
  }
  const payload = {
    totalOutstandingAmount,
    invoiceOutstandingAmount: summary.invoiceOutstandingAmount,
    openingBalanceOutstandingAmount: summary.openingBalanceOutstandingAmount,
    advanceBalance,
    latestOutstandingInvoiceId: invoiceLedger.latestInvoiceId,
    financialSummaryUpdatedAt: nowIso(),
    previousOutstandingAmount: 0
  };

  await updateDoc(doc(db, CUSTOMERS, customerId), payload);
  patchCachedCustomer(customerId, payload);

  return { ...payload, invoiceBalanceById: invoiceLedger.balanceByInvoiceId };
}

let appSettingsCache: AppSettings | undefined;

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getInvoiceOutstandingDelta = (invoice: Invoice | undefined, amount: number): CustomerOutstandingDelta => {
  if (!amount) return {};
  return isOpeningBalanceInvoice(invoice ?? { invoiceNumber: '' })
    ? { openingBalance: amount }
    : { invoice: amount };
};

const getPaymentOutstandingDelta = (
  payment: Payment,
  invoice: Invoice | undefined,
  direction: -1 | 1
): CustomerOutstandingDelta => combineCustomerOutstandingDeltas(
  getInvoiceOutstandingDelta(invoice, direction * getInvoicePaymentEffect(payment)),
  { legacy: direction * Math.max(0, payment.amountUsedForOldBalance ?? 0) }
);

const buildAtomicOutstandingUpdate = (
  customerData: Record<string, unknown>,
  delta: CustomerOutstandingDelta,
  timestamp: string
) => ({
  ...applyCustomerOutstandingDelta(customerData, delta),
  financialSummaryUpdatedAt: timestamp,
  updatedAt: timestamp
});

export const getPaymentTermsForTier = (tier: CustomerTier) => {
  return getPaymentTermsLabel(tier);
};

export const getCreditDaysForTier = (tier: CustomerTier) => {
  return DEFAULT_SETTINGS.creditDays[tier];
};

export const calculateDueDate = (invoiceDate: string, tier: CustomerTier, settings?: AppSettings) => {
  return calculateDynamicDueDate(invoiceDate, tier, settings);
};

const mapCustomerDoc = (id: string, data: Record<string, unknown>): Customer => {
  const tier = (data.tier as CustomerTier) || 'Tier 4';

  return {
    id,
    name: String(data.name || ''),
    mobile: String(data.mobile || ''),
    area: String(data.area || ''),
    branchId: data.branchId === 'MASKI' ? 'MASKI' : 'SINDHANUR',
    tier,
    // Old balance from before this ERP started. Missing legacy documents safely read as zero.
    previousOutstandingAmount: Math.max(0, numberOrZero(data.previousOutstandingAmount)),
    advanceBalance: Math.max(0, numberOrZero(data.advanceBalance)),
    totalOutstandingAmount: data.totalOutstandingAmount === undefined ? undefined : numberOrZero(data.totalOutstandingAmount),
    invoiceOutstandingAmount: data.invoiceOutstandingAmount === undefined ? undefined : numberOrZero(data.invoiceOutstandingAmount),
    openingBalanceOutstandingAmount: data.openingBalanceOutstandingAmount === undefined ? undefined : numberOrZero(data.openingBalanceOutstandingAmount),
    latestOutstandingInvoiceId: data.latestOutstandingInvoiceId ? String(data.latestOutstandingInvoiceId) : undefined,
    overdueAmount: data.overdueAmount === undefined ? undefined : numberOrZero(data.overdueAmount),
    financialSummaryUpdatedAt: data.financialSummaryUpdatedAt ? String(data.financialSummaryUpdatedAt) : undefined,
    paymentTerms: String(data.paymentTerms || getPaymentTermsLabel(tier)),
    notes: String(data.notes || ''),
    status: data.status ? String(data.status) : '',
    createdAt: String(data.createdAt || ''),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
  };
};

const mapInvoiceDoc = (id: string, data: Record<string, unknown>): Invoice => {
  const salesAmount = numberOrZero(data.salesAmount ?? data.totalSales);
  const costAmount = numberOrZero(data.costAmount);
  const transportAmount = numberOrZero(data.transportAmount);
  const totalCost = numberOrZero(data.totalCost ?? costAmount + transportAmount);
  const totalProfit = numberOrZero(data.totalProfit ?? salesAmount - totalCost);

  return {
    id,
    invoiceNumber: String(data.invoiceNumber || ''),
    customerId: String(data.customerId || ''),
    customerName: String(data.customerName || ''),
    invoiceType: data.invoiceType ? String(data.invoiceType) : undefined,
    recordStatus: data.status ? String(data.status) : undefined,
    isOpeningBalance: data.isOpeningBalance === true,
    date: String(data.date || data.invoiceDate || ''),
    dueDate: String(data.dueDate || ''),
    pcPolicyVersionAtInvoice: data.pcPolicyVersionAtInvoice === undefined
      ? undefined
      : Math.max(0, Math.round(numberOrZero(data.pcPolicyVersionAtInvoice))),
    tierAtInvoice: data.tierAtInvoice as CustomerTier | undefined,
    pcPercentageAtInvoice: data.pcPercentageAtInvoice === undefined ? undefined : numberOrZero(data.pcPercentageAtInvoice),
    creditDaysAtInvoice: data.creditDaysAtInvoice === undefined ? undefined : numberOrZero(data.creditDaysAtInvoice),
    bufferDaysAtInvoice: data.bufferDaysAtInvoice === undefined ? undefined : numberOrZero(data.bufferDaysAtInvoice),
    savedDueDate: data.savedDueDate ? String(data.savedDueDate) : undefined,
    finalPcCutoffDate: data.finalPcCutoffDate ? String(data.finalPcCutoffDate) : undefined,
    termsEstimated: data.termsEstimated === true,
    salesAmount,
    costAmount,
    transportAmount,
    totalSales: numberOrZero(data.totalSales ?? salesAmount),
    totalCost,
    totalProfit,
    customerBalanceBeforeInvoice: data.customerBalanceBeforeInvoice === undefined
      ? undefined
      : Math.max(0, numberOrZero(data.customerBalanceBeforeInvoice)),
    customerBalanceAfterInvoice: data.customerBalanceAfterInvoice === undefined
      ? undefined
      : Math.max(0, numberOrZero(data.customerBalanceAfterInvoice)),
    notes: String(data.notes || ''),
    createdAt: String(data.createdAt || ''),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    shopId: isShopId(data.shopId) ? data.shopId : undefined,
    branchSystemVersion: data.branchSystemVersion === undefined ? undefined : numberOrZero(data.branchSystemVersion)
  };
};

const mapPaymentDoc = (id: string, data: Record<string, unknown>): Payment => {
  const amount = numberOrZero(data.amount ?? data.amountReceived);
  const amountAppliedToInvoice = data.amountAppliedToInvoice === undefined ? amount : numberOrZero(data.amountAppliedToInvoice);
  const paymentKind = data.paymentKind === 'advance_application' ? 'advance_application' : 'receipt';

  return {
    id,
    invoiceId: String(data.invoiceId || ''),
    invoiceNumber: String(data.invoiceNumber || ''),
    customerId: String(data.customerId || ''),
    customerName: String(data.customerName || ''),
    date: String(data.date || data.paymentDate || ''),
    pcPolicyVersionAtPayment: data.pcPolicyVersionAtPayment === undefined
      ? undefined
      : Math.max(0, Math.round(numberOrZero(data.pcPolicyVersionAtPayment))),
    amount,
    amountAppliedToInvoice,
    advanceCreatedAmount: data.advanceCreatedAmount === undefined && paymentKind === 'receipt'
      ? Math.max(0, amount - amountAppliedToInvoice)
      : Math.max(0, numberOrZero(data.advanceCreatedAmount)),
    advanceAppliedAmount: Math.max(0, numberOrZero(data.advanceAppliedAmount)),
    paymentKind,
    amountUsedForOldBalance: numberOrZero(data.amountUsedForOldBalance),
    oldBalanceBeforePayment: numberOrZero(data.oldBalanceBeforePayment),
    oldBalanceAfterPayment: numberOrZero(data.oldBalanceAfterPayment),
    splitPaymentGroupId: data.splitPaymentGroupId ? String(data.splitPaymentGroupId) : undefined,
    splitPaymentTotalAmount: data.splitPaymentTotalAmount === undefined ? undefined : numberOrZero(data.splitPaymentTotalAmount),
    splitPaymentPart: data.splitPaymentPart === undefined ? undefined : numberOrZero(data.splitPaymentPart),
    splitPaymentCount: data.splitPaymentCount === undefined ? undefined : numberOrZero(data.splitPaymentCount),
    cashDiscount: numberOrZero(data.cashDiscount),
    mode: (data.mode as Payment['mode']) || 'Cash',
    notes: String(data.notes || ''),
    createdAt: String(data.createdAt || ''),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    shopId: isShopId(data.shopId) ? data.shopId : undefined,
    branchSystemVersion: data.branchSystemVersion === undefined ? undefined : numberOrZero(data.branchSystemVersion),
    affectsShopCash: data.affectsShopCash === undefined ? undefined : data.affectsShopCash === true,
    cashSyncedAmount: data.cashSyncedAmount === undefined ? undefined : Math.max(0, numberOrZero(data.cashSyncedAmount))
  };
};

const mapDueCustomerDoc = (id: string, data: Record<string, unknown>): DueCustomerRecord => ({
  id,
  customerId: String(data.customerId || id),
  customerName: String(data.customerName || ''),
  overdueDays: Math.max(0, Math.round(numberOrZero(data.overdueDays))),
  amount: Math.max(0, numberOrZero(data.amount)),
  invoices: (Array.isArray(data.invoices) ? data.invoices : [])
    .filter((invoice): invoice is Record<string, unknown> => Boolean(invoice) && typeof invoice === 'object')
    .map((invoice) => ({
      invoiceId: String(invoice.invoiceId || ''),
      invoiceNumber: String(invoice.invoiceNumber || ''),
      overdueDays: Math.max(0, Math.round(numberOrZero(invoice.overdueDays))),
      amount: Math.max(0, numberOrZero(invoice.amount))
    })),
  updatedAt: String(data.updatedAt || '')
});

const mapSettingsDoc = (id: string, data: Record<string, unknown>): AppSettings => {
  return mergeWithDefaultSettings({
    id,
    key: 'erpSettings',
    giftPercentages: data.giftPercentages as AppSettings['giftPercentages'],
    creditDays: data.creditDays as AppSettings['creditDays'],
    paymentBuffers: data.paymentBuffers as AppSettings['paymentBuffers'],
    scoringWeights: data.scoringWeights as AppSettings['scoringWeights'],
    highOutstandingThreshold: data.highOutstandingThreshold === undefined ? undefined : numberOrZero(data.highOutstandingThreshold),
    fixedMonthlyCosts: data.fixedMonthlyCosts === undefined ? undefined : numberOrZero(data.fixedMonthlyCosts),
    invoicePrefix: data.invoicePrefix ? String(data.invoicePrefix) : undefined,
    financialYearReset: data.financialYearReset as AppSettings['financialYearReset'],
    defaultReportPeriod: data.defaultReportPeriod as AppSettings['defaultReportPeriod'],
    giftPeriodOptions: data.giftPeriodOptions as AppSettings['giftPeriodOptions'],
    staffPermissions: data.staffPermissions as AppSettings['staffPermissions'],
    creditPolicy: data.creditPolicy as AppSettings['creditPolicy'],
    overduePolicy: data.overduePolicy as AppSettings['overduePolicy'],
    loyaltySettings: data.loyaltySettings as AppSettings['loyaltySettings'],
    targetSettings: data.targetSettings as AppSettings['targetSettings'],
    showCustomerTierToCustomer: data.showCustomerTierToCustomer === true,
    turnOnOrder: data.turnOnOrder === true,
    medicalOrder: data.medicalOrder === true,
    headerOrder: data.headerOrder === undefined ? DEFAULT_SETTINGS.headerOrder : data.headerOrder === true,
    down: data.down === true,
    customerDown: data.customerDown === true,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
  });
};

const mapGiftHistoryDoc = (id: string, data: Record<string, unknown>): GiftHistory => ({
  id,
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  tier: (data.tier || data.tierAtGiftTime || 'Tier 4') as CustomerTier,
  tierAtGiftTime: (data.tierAtGiftTime || data.tier || 'Tier 4') as CustomerTier,
  periodType: (data.periodType as GiftHistory['periodType']) || '3_months',
  periodStart: String(data.periodStart || ''),
  periodEnd: String(data.periodEnd || ''),
  salesAmount: numberOrZero(data.salesAmount),
  profitConsidered: numberOrZero(data.profitConsidered ?? data.salesAmount),
  giftPercentage: numberOrZero(data.giftPercentage),
  giftAmount: numberOrZero(data.giftAmount ?? data.actualGiftAmount ?? data.suggestedGiftBudget),
  suggestedGiftBudget: numberOrZero(data.suggestedGiftBudget ?? data.giftAmount),
  actualGiftAmount: numberOrZero(data.actualGiftAmount ?? data.giftAmount),
  giftItem: String(data.giftItem || ''),
  selectedGiftItemName: data.selectedGiftItemName ? String(data.selectedGiftItemName) : undefined,
  suggestedGiftOptions: Array.isArray(data.suggestedGiftOptions) ? data.suggestedGiftOptions.map(String) : undefined,
  giftBudget: data.giftBudget === undefined ? undefined : numberOrZero(data.giftBudget),
  giftedDate: String(data.giftedDate || data.giftGivenDate || ''),
  giftGivenDate: String(data.giftGivenDate || data.giftedDate || ''),
  giftedBy: String(data.giftedBy || data.approvedBy || ''),
  approvedBy: String(data.approvedBy || data.giftedBy || ''),
  status: (data.status as GiftHistory['status']) || 'Given',
  notes: String(data.notes || ''),
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

const mapGiftItemDoc = (id: string, data: Record<string, unknown>): GiftItem => ({
  id,
  giftItemName: String(data.giftItemName || ''),
  targetType: data.targetType === 'sales' || data.targetType === 'score' ? data.targetType : 'profit',
  targetValue: numberOrZero(data.targetValue),
  minBudget: numberOrZero(data.minBudget),
  maxBudget: numberOrZero(data.maxBudget),
  eligibleTier:
    data.eligibleTier === 'Tier 1' || data.eligibleTier === 'Tier 2' || data.eligibleTier === 'Tier 3' || data.eligibleTier === 'Tier 4'
      ? data.eligibleTier
      : 'All',
  notes: String(data.notes || ''),
  isActive: data.isActive !== false,
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

const sanitizeGiftItemPayload = (giftItem: GiftItemFormData): GiftItemFormData => ({
  giftItemName: giftItem.giftItemName.trim(),
  // Simplified gift item settings now use only targetValue as the PC points threshold.
  // Legacy targetType/minBudget/maxBudget/eligibleTier fields may still exist on old docs,
  // but new saves intentionally leave those untouched/unused.
  targetValue: Math.max(0, numberOrZero(giftItem.targetValue)),
  notes: giftItem.notes.trim(),
  isActive: giftItem.isActive
});

const dateFieldToString = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') return value;

  const timestampValue = value as { toDate?: () => Date };
  if (typeof timestampValue.toDate === 'function') {
    return timestampValue.toDate().toISOString();
  }

  return String(value);
};

const applyDateRangeConstraints = (constraints: QueryConstraint[], dateField: string, options?: DateRangeQueryOptions) => {
  if (options?.fromDate) constraints.push(where(dateField, '>=', options.fromDate));
  if (options?.toDate) constraints.push(where(dateField, '<=', options.toDate));
};

const applyLimitConstraint = (constraints: QueryConstraint[], limitCount?: number) => {
  if (limitCount && limitCount > 0) {
    constraints.push(firestoreLimit(limitCount));
  }
};

const buildInvoiceQueryConstraints = (options?: CustomerScopedQueryOptions) => {
  const constraints: QueryConstraint[] = [];

  if (options?.customerId) constraints.push(where('customerId', '==', options.customerId));
  if (options?.customerName && !options.customerId) constraints.push(where('customerName', '==', options.customerName));

  // Free-tier safety: filter by date/customer in Firestore before React receives rows.
  applyDateRangeConstraints(constraints, 'date', options);
  const hasDateRange = Boolean(options?.fromDate || options?.toDate);
  constraints.push(orderBy(!hasDateRange && options?.sortBy === 'invoiceNumber' ? 'invoiceNumber' : 'date', 'desc'));
  applyLimitConstraint(constraints, options?.limitCount);

  return constraints;
};

const buildPaymentQueryConstraints = (options?: CustomerScopedQueryOptions) => {
  const constraints: QueryConstraint[] = [];

  if (options?.customerId) constraints.push(where('customerId', '==', options.customerId));
  if (options?.customerName && !options.customerId) constraints.push(where('customerName', '==', options.customerName));

  applyDateRangeConstraints(constraints, 'date', options);
  const hasDateRange = Boolean(options?.fromDate || options?.toDate);
  constraints.push(orderBy(!hasDateRange && options?.sortBy === 'createdAt' ? 'createdAt' : 'date', 'desc'));
  applyLimitConstraint(constraints, options?.limitCount);

  return constraints;
};

const mapOfferDoc = (id: string, data: Record<string, unknown>): Offer => ({
  id,
  title: String(data.title || ''),
  description: data.description ? String(data.description) : '',
  imageUrl: String(data.imageUrl || ''),
  imagePath: data.imagePath ? String(data.imagePath) : undefined,
  levelRequired: (data.levelRequired as Offer['levelRequired']) || 'Active Partner',
  startDate: String(data.startDate || ''),
  endDate: String(data.endDate || ''),
  isActive: data.isActive === true,
  createdAt: dateFieldToString(data.createdAt),
  createdBy: data.createdBy ? String(data.createdBy) : undefined,
  updatedAt: data.updatedAt ? dateFieldToString(data.updatedAt) : undefined
});

const mapMonthlyCustomerStatsDoc = (id: string, data: Record<string, unknown>): MonthlyCustomerStats => ({
  id,
  customerId: String(data.customerId || ''),
  month: String(data.month || ''),
  totalSales: numberOrZero(data.totalSales),
  totalProfit: numberOrZero(data.totalProfit),
  totalPayments: numberOrZero(data.totalPayments),
  orderCount: numberOrZero(data.orderCount),
  overdueAmount: numberOrZero(data.overdueAmount),
  target: numberOrZero(data.target),
  basePcEarned: numberOrZero(data.basePcEarned),
  bonusPcEarned: numberOrZero(data.bonusPcEarned),
  availablePc: numberOrZero(data.availablePc),
  salesTarget: numberOrZero(data.salesTarget),
  profitTarget: numberOrZero(data.profitTarget),
  frequencyTarget: numberOrZero(data.frequencyTarget),
  paymentScore: numberOrZero(data.paymentScore),
  profitScore: numberOrZero(data.profitScore),
  frequencyScore: numberOrZero(data.frequencyScore),
  salesScore: numberOrZero(data.salesScore),
  loyaltyScore: numberOrZero(data.loyaltyScore),
  rollingScore: numberOrZero(data.rollingScore),
  calculatedTier: data.calculatedTier as MonthlyCustomerStats['calculatedTier'],
  finalTier: data.finalTier as MonthlyCustomerStats['finalTier'],
  tierCapReason: data.tierCapReason ? String(data.tierCapReason) : undefined,
  isOnboarding: data.isOnboarding === true,
  onboardingStage: data.onboardingStage as MonthlyCustomerStats['onboardingStage'],
  confidenceFactor: data.confidenceFactor === undefined ? undefined : numberOrZero(data.confidenceFactor),
  pointsEarned: numberOrZero(data.pointsEarned),
  currentLevel: (data.currentLevel as MonthlyCustomerStats['currentLevel']) || 'Active Partner',
  progressPercent: numberOrZero(data.progressPercent),
  updatedAt: String(data.updatedAt || '')
});

const mapCustomerMonthlySnapshotDoc = (id: string, data: Record<string, unknown>): CustomerMonthlySnapshot => ({
  id,
  customerId: String(data.customerId || ''),
  month: String(data.month || ''),
  totalSales: numberOrZero(data.totalSales),
  totalProfit: numberOrZero(data.totalProfit),
  invoiceCount: numberOrZero(data.invoiceCount),
  paymentsReceived: numberOrZero(data.paymentsReceived),
  needsBackfill: data.needsBackfill === true,
  updatedAt: String(data.updatedAt || '')
});

const mapBusinessMonthlySnapshotDoc = (id: string, data: Record<string, unknown>): BusinessMonthlySnapshot => ({
  id,
  month: String(data.month || id),
  totalSales: numberOrZero(data.totalSales),
  totalProfit: numberOrZero(data.totalProfit),
  invoiceCount: numberOrZero(data.invoiceCount),
  paymentsReceived: numberOrZero(data.paymentsReceived),
  needsBackfill: data.needsBackfill === true,
  updatedAt: String(data.updatedAt || '')
});

const mapRewardItemDoc = (id: string, data: Record<string, unknown>): RewardItem => ({
  id,
  name: String(data.name || ''),
  requiredPoints: numberOrZero(data.requiredPoints),
  levelRequired: (data.levelRequired as RewardItem['levelRequired']) || 'Active Partner',
  isActive: data.isActive !== false,
  description: data.description ? String(data.description) : '',
  imageUrl: data.imageUrl ? String(data.imageUrl) : '',
  imagePath: data.imagePath ? String(data.imagePath) : undefined,
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

const mapRedemptionRequestDoc = (id: string, data: Record<string, unknown>): RedemptionRequest => ({
  id,
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  rewardId: String(data.rewardId || ''),
  rewardName: String(data.rewardName || ''),
  points: numberOrZero(data.points),
  status: (data.status as RedemptionStatus) || 'Pending',
  requestedAt: String(data.requestedAt || ''),
  reviewedAt: data.reviewedAt ? String(data.reviewedAt) : undefined,
  reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
  notes: data.notes ? String(data.notes) : undefined
});

const mapOverduePcRequestDoc = (id: string, data: Record<string, unknown>): OverduePcRequest => ({
  id,
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  invoiceId: String(data.invoiceId || ''),
  invoiceNumber: String(data.invoiceNumber || ''),
  invoiceDate: String(data.invoiceDate || ''),
  dueDate: String(data.dueDate || ''),
  fullPaymentDate: String(data.fullPaymentDate || ''),
  overdueDays: numberOrZero(data.overdueDays),
  invoiceAmount: numberOrZero(data.invoiceAmount),
  suggestedCoins: numberOrZero(data.suggestedCoins),
  approvedCoins: numberOrZero(data.approvedCoins),
  status: (data.status as OverduePcRequestStatus) || 'Pending',
  generatedAt: String(data.generatedAt || ''),
  reviewedAt: data.reviewedAt ? String(data.reviewedAt) : undefined,
  reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
  notes: data.notes ? String(data.notes) : undefined
});

export const BONUS_PC_LABELS: Record<BonusPcType, string> = {
  monthly_target: 'Monthly sales-target bonus',
  clean_payment_month: 'Clean-payment-month bonus',
  new_customer: 'New customer bonus',
  referral: 'Referral bonus'
};

const normalizeBonusPcType = (value: unknown): BonusPcType => {
  if (value === 'monthly_target' || value === 'purchase_target') return 'monthly_target';
  if (value === 'clean_payment_month' || value === 'payment') return 'clean_payment_month';
  if (value === 'referral') return 'referral';
  return 'new_customer';
};

const mapBonusPcRequestDoc = (id: string, data: Record<string, unknown>): BonusPcRequest => {
  const bonusType = normalizeBonusPcType(data.bonusType);

  return {
    id,
    customerId: String(data.customerId || ''),
    customerName: String(data.customerName || ''),
    bonusType,
    bonusLabel: String(data.bonusLabel || BONUS_PC_LABELS[bonusType]),
    triggerType: String(data.triggerType || ''),
    referenceId: String(data.referenceId || ''),
    suggestedCoins: numberOrZero(data.suggestedCoins),
    approvedCoins: numberOrZero(data.approvedCoins),
    status: (data.status as BonusPcRequestStatus) || 'Pending',
    generatedAt: String(data.generatedAt || ''),
    reviewedAt: data.reviewedAt ? String(data.reviewedAt) : undefined,
    reviewedBy: data.reviewedBy ? String(data.reviewedBy) : undefined,
    customerSeenAt: data.customerSeenAt ? String(data.customerSeenAt) : undefined,
    notes: data.notes ? String(data.notes) : undefined
  };
};

const daysBetweenDateStrings = (fromDate: string, toDate: string) => {
  const fromTime = new Date(`${fromDate}T00:00:00`).getTime();
  const toTime = new Date(`${toDate}T00:00:00`).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return 0;
  return Math.max(0, Math.floor((toTime - fromTime) / (24 * 60 * 60 * 1000)));
};

const getPastDateString = (daysBack: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
};

const getMonthDateRange = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  const monthEnd = new Date(year, monthNumber, 0);
  const formatDate = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  return {
    fromDate: formatDate(monthStart),
    toDate: formatDate(monthEnd)
  };
};

const getMonthFromBonusRequest = (request: BonusPcRequest) => {
  const match = request.id.match(/:(\d{4})-(\d{2})$/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return request.generatedAt ? request.generatedAt.slice(0, 7) : getCurrentMonthKey();
};

const isMonthActivityInvoice = (invoice: Invoice, month: string) => invoice.date.startsWith(`${month}-`);

const getInvoicePaidDateOrEmpty = (invoice: Invoice, payments: Payment[]) => getInvoiceFullPaymentDate(invoice, payments) || '';

const hasUnpaidOverdueInvoice = (
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings,
  today = getTodayDateString()
) => {
  return invoices.some((invoice) => {
    if (invoice.customerId !== customer.id) return false;
    const pcInfo = calculateInvoiceApcInfo(invoice, payments, customer.tier, settings, today);
    const fullPaymentDate = getInvoicePaidDateOrEmpty(invoice, payments);
    return !fullPaymentDate && pcInfo.apcDeadline && today > pcInfo.apcDeadline;
  });
};

const getPaymentScoreForInvoices = (customer: Customer, invoices: Invoice[], payments: Payment[], settings: AppSettings) => {
  if (invoices.length === 0) return 0;

  const delayScores = invoices.map((invoice) => {
    const dueDate = getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, customer.tier, settings);
    const fullPaymentDate = getInvoicePaidDateOrEmpty(invoice, payments);

    if (!fullPaymentDate || !dueDate) return 0;

    const delayDays = daysBetweenDateStrings(dueDate, fullPaymentDate);
    return Math.max(20, Math.min(100, Math.round(100 - delayDays * 4)));
  });

  return Math.round(delayScores.reduce((sum, score) => sum + score, 0) / delayScores.length);
};

const allDueInvoicesPaidOnTime = (customer: Customer, invoices: Invoice[], payments: Payment[], settings: AppSettings, month: string) => {
  const dueInvoices = invoices.filter((invoice) => {
    if (invoice.customerId !== customer.id) return false;
    const dueDate = getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, customer.tier, settings);
    return dueDate.startsWith(`${month}-`);
  });

  if (dueInvoices.length === 0) return false;

  return dueInvoices.every((invoice) => {
    const dueDate = getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, customer.tier, settings);
    const fullPaymentDate = getInvoicePaidDateOrEmpty(invoice, payments);
    return Boolean(fullPaymentDate && fullPaymentDate <= dueDate);
  });
};

const getBasePcEarnedForMonth = (customer: Customer, monthlyInvoices: Invoice[], payments: Payment[], settings: AppSettings) => {
  return monthlyInvoices.reduce((sum, invoice) => sum + calculateInvoiceApcInfo(invoice, payments, customer.tier, settings).earnedApc, 0);
};

const getCappedBonusAmount = (configuredAmount: number, basePcEarned: number, alreadyPlannedBonus: number) => {
  const cleanAmount = Math.max(0, Math.round(numberOrZero(configuredAmount)));
  const monthlyCap = Math.floor(Math.max(0, basePcEarned) * 0.2);

  if (cleanAmount <= 0 || monthlyCap <= alreadyPlannedBonus) {
    return 0;
  }

  return Math.min(cleanAmount, monthlyCap - alreadyPlannedBonus);
};

const sanitizeRewardPayload = (reward: RewardFormData): RewardFormData => ({
  name: reward.name.trim(),
  requiredPoints: Math.max(0, Math.round(numberOrZero(reward.requiredPoints))),
  levelRequired: reward.levelRequired,
  isActive: reward.isActive,
  description: reward.description.trim(),
  imageUrl: reward.imageUrl.trim(),
  imagePath: reward.imagePath || ''
});

const sanitizeOfferPayload = (offer: OfferFormData): OfferFormData => ({
  title: offer.title.trim(),
  description: offer.description.trim(),
  imageUrl: offer.imageUrl.trim(),
  imagePath: offer.imagePath || '',
  levelRequired: offer.levelRequired || 'Active Partner',
  startDate: offer.startDate,
  endDate: offer.endDate,
  isActive: offer.isActive
});

const parseUserRole = (value: unknown): UserRole => {
  if (value === 'Admin' || value === 'Staff' || value === 'customer' || value === 'Medical') {
    return value;
  }

  throw new Error('User profile has an invalid role. An Admin must delete and recreate this access.');
};

export const mapUserProfileDoc = (id: string, data: Record<string, unknown>): UserProfile => ({
  id,
  uid: String(data.uid || ''),
  email: String(data.email || ''),
  name: String(data.name || data.customerName || data.email || ''),
  role: parseUserRole(data.role),
  customerId: data.customerId ? String(data.customerId) : undefined,
  customerName: data.customerName ? String(data.customerName) : undefined,
  shopId: isShopId(data.shopId) ? data.shopId : undefined,
  active: data.active !== false,
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

export const getCustomers = async (options?: CustomerQueryOptions) => {
  return getCached(cacheKey(CUSTOMERS, options ?? {}), async () => {
    const constraints: QueryConstraint[] = [
      orderBy(options?.sortBy ?? 'name', options?.sortDirection ?? 'asc')
    ];
    applyLimitConstraint(constraints, options?.limitCount);
    const customersQuery = query(collection(db, CUSTOMERS), ...constraints);
    const snapshot = await getDocs(customersQuery);
    return snapshot.docs.map((customerDoc) => mapCustomerDoc(customerDoc.id, customerDoc.data()));
  });
};

export const getCustomerById = async (customerId: string) => {
  if (!customerId) return undefined;
  const customerSnapshot = await getDoc(doc(db, CUSTOMERS, customerId));
  return customerSnapshot.exists() ? mapCustomerDoc(customerSnapshot.id, customerSnapshot.data()) : undefined;
};

export const getCustomersByName = async (customerName: string) => {
  if (!customerName) return [];
  // Customer portal links should prefer customerId, but this fallback supports older documents
  // that may have stored either `name` or `customerName`.
  const matches = new Map<string, Customer>();
  const nameSnapshot = await getDocs(query(collection(db, CUSTOMERS), where('name', '==', customerName)));
  nameSnapshot.docs.forEach((customerDoc) => matches.set(customerDoc.id, mapCustomerDoc(customerDoc.id, customerDoc.data())));

  const customerNameSnapshot = await getDocs(query(collection(db, CUSTOMERS), where('customerName', '==', customerName)));
  customerNameSnapshot.docs.forEach((customerDoc) => matches.set(customerDoc.id, mapCustomerDoc(customerDoc.id, customerDoc.data())));

  return Array.from(matches.values());
};

export const createCustomer = async (customer: CustomerFormData, auditUser?: AuditUser) => {
  const previousOutstandingAmount = Math.max(0, numberOrZero(customer.previousOutstandingAmount));
  const timestamp = nowIso();
  const customerRef = doc(collection(db, CUSTOMERS));
  const batch = writeBatch(db);
  const customerPayload = {
    ...customer,
    previousOutstandingAmount: 0,
    totalOutstandingAmount: previousOutstandingAmount,
    invoiceOutstandingAmount: 0,
    openingBalanceOutstandingAmount: previousOutstandingAmount,
    ...(previousOutstandingAmount > 0 ? {
      latestOutstandingInvoiceId: getOpeningBalanceInvoiceId(customerRef.id)
    } : {}),
    financialSummaryUpdatedAt: timestamp
  };

  batch.set(customerRef, {
    ...customerPayload,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  if (previousOutstandingAmount > 0) {
    batch.set(
      doc(db, INVOICES, getOpeningBalanceInvoiceId(customerRef.id)),
      buildOpeningBalanceInvoicePayload(customerRef.id, customerPayload, previousOutstandingAmount, timestamp)
    );
  }

  await batch.commit();
  clearFirestoreSessionCache();
  return customerRef;
};

export const updateCustomerRecord = async (customerId: string, customer: CustomerFormData, auditUser?: AuditUser) => {
  const previousOutstandingAmount = Math.max(0, numberOrZero(customer.previousOutstandingAmount));
  const timestamp = nowIso();
  const customerPayload = {
    ...customer,
    previousOutstandingAmount: 0
  };

  if (previousOutstandingAmount <= 0) {
    await updateDoc(doc(db, CUSTOMERS, customerId), {
      ...customerPayload,
      updatedAt: timestamp
    });
    await syncCustomerFinancialSummary(customerId);
    return;
  }

  const openingInvoiceRef = doc(db, INVOICES, getOpeningBalanceInvoiceId(customerId));

  await runTransaction(db, async (transaction) => {
    const openingInvoiceSnapshot = await transaction.get(openingInvoiceRef);

    transaction.update(doc(db, CUSTOMERS, customerId), {
      ...customerPayload,
      updatedAt: timestamp
    });

    if (!openingInvoiceSnapshot.exists()) {
      transaction.set(openingInvoiceRef, buildOpeningBalanceInvoicePayload(customerId, customerPayload, previousOutstandingAmount, timestamp));
    }
  });

  await syncCustomerFinancialSummary(customerId);
  clearFirestoreSessionCache();

};

export const syncCustomerPartnerLevelsFromFirestore = async () => {
  const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
    getCustomers(),
    getInvoices(),
    getPayments(),
    getAppSettings()
  ]);
  const customersById = new Map(customerRows.map((customer) => [customer.id, customer]));
  const scores = buildCustomerScores(customerRows, invoiceRows, paymentRows, new Date(), appSettings);
  const timestamp = nowIso();
  const updates = scores.filter((score) => customersById.get(score.customerId)?.tier !== score.tier);

  await Promise.all(
    updates.map((score) =>
      updateDoc(doc(db, CUSTOMERS, score.customerId), {
        tier: score.tier,
        paymentTerms: getPaymentTermsLabel(score.tier, appSettings),
        updatedAt: timestamp
      })
    )
  );

  return updates.length;
};

export const deleteCustomerRecord = async (customerId: string, auditUser?: AuditUser) => {
  const batch = writeBatch(db);
  batch.delete(doc(db, CUSTOMERS, customerId));
  batch.delete(doc(db, 'customerCreditProfiles', customerId));
  batch.delete(doc(db, 'customerCreditSummaries', customerId));
  await batch.commit();
  clearFirestoreSessionCache();
};

export const getInvoices = async (options?: DateRangeQueryOptions) => {
  return getCached(cacheKey(INVOICES, options), async () => {
    const invoicesQuery = query(collection(db, INVOICES), ...buildInvoiceQueryConstraints(options));
    const snapshot = await getDocs(invoicesQuery);
    return snapshot.docs.map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()));
  });
};

export const getInvoicesByCustomerId = async (customerId: string, options?: DateRangeQueryOptions) => {
  const invoicesQuery = query(collection(db, INVOICES), ...buildInvoiceQueryConstraints({ ...options, customerId }));
  const snapshot = await getDocs(invoicesQuery);
  return snapshot.docs.map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()));
};

export const getInvoicesForCustomerViewer = async (customerId?: string, customerName?: string) => {
  const invoiceMap = new Map<string, Invoice>();

  if (customerId) {
    // Customer portal avoids composite indexes: query only this customer, then sort locally.
    const byIdQuery = query(collection(db, INVOICES), where('customerId', '==', customerId));
    const byIdSnapshot = await getDocs(byIdQuery);
    byIdSnapshot.docs.forEach((invoiceDoc) => invoiceMap.set(invoiceDoc.id, mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data())));
  }

  if (!customerId && customerName) {
    // Legacy fallback only. New user profiles and invoice documents should use customerId.
    const byNameQuery = query(collection(db, INVOICES), where('customerName', '==', customerName));
    const byNameSnapshot = await getDocs(byNameQuery);
    byNameSnapshot.docs.forEach((invoiceDoc) => invoiceMap.set(invoiceDoc.id, mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data())));
  }

  return [...invoiceMap.values()].sort((a, b) => b.date.localeCompare(a.date));
};

const getFinancialYearRange = (date = new Date()) => {
  const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;

  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`
  };
};

export const getCustomerCount = async () => {
  return getCached(cacheKey(CUSTOMERS, { count: true }), async () => {
    const snapshot = await getCountFromServer(collection(db, CUSTOMERS));
    return snapshot.data().count;
  });
};

const parseInvoiceDate = (invoiceDate?: string) => {
  if (!invoiceDate) return new Date();
  const [year, month, day] = invoiceDate.split('-').map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
    ? new Date(year, month - 1, day)
    : new Date();
};

const getInvoiceCounterDetails = (settings: AppSettings, invoiceDate?: string) => {
  const prefix = settings.invoicePrefix || 'INV';
  const financialYear = getFinancialYearRange(parseInvoiceDate(invoiceDate));
  const scope = settings.financialYearReset
    ? `${financialYear.start.slice(0, 4)}_${financialYear.end.slice(0, 4)}`
    : 'all';
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'INV';

  return {
    prefix,
    financialYear,
    scope,
    ref: doc(db, COUNTERS, `invoices_${cleanPrefix}_${scope}`)
  };
};

const getHighestExistingInvoiceSequence = async (activeSettings: AppSettings, invoiceDate?: string) => {
  const { prefix, financialYear } = getInvoiceCounterDetails(activeSettings, invoiceDate);
  const invoicesQuery = activeSettings.financialYearReset
    ? query(collection(db, INVOICES), where('date', '>=', financialYear.start), where('date', '<=', financialYear.end), orderBy('date', 'desc'))
    : query(collection(db, INVOICES), orderBy('invoiceNumber', 'desc'), firestoreLimit(1));
  const snapshot = await getDocs(invoicesQuery);
  const highestNumber = snapshot.docs.reduce((highest, invoiceDoc) => {
    if (activeSettings.financialYearReset) {
      const invoiceDate = String(invoiceDoc.data().date || invoiceDoc.data().invoiceDate || '');
      if (!invoiceDate || invoiceDate < financialYear.start || invoiceDate > financialYear.end) {
        return highest;
      }
    }

    const invoiceNumber = String(invoiceDoc.data().invoiceNumber || '');
    const numericPart = Number(invoiceNumber.replace(`${prefix}-`, ''));
    return Number.isFinite(numericPart) && numericPart > highest ? numericPart : highest;
  }, 0);

  return highestNumber;
};

export const getNextInvoiceNumber = async (settings?: AppSettings, invoiceDate?: string) => {
  const activeSettings = mergeWithDefaultSettings(settings ?? (await getAppSettings()));
  const counter = getInvoiceCounterDetails(activeSettings, invoiceDate);
  const counterSnapshot = await getDoc(counter.ref);
  let currentSequence = counterSnapshot.exists()
    ? Math.max(0, Math.round(numberOrZero(counterSnapshot.data().sequence)))
    : await getHighestExistingInvoiceSequence(activeSettings, invoiceDate);

  if (!counterSnapshot.exists() && currentSequence > 0) {
    currentSequence = await runTransaction(db, async (transaction) => {
      const latestCounter = await transaction.get(counter.ref);
      if (latestCounter.exists()) {
        return Math.max(0, Math.round(numberOrZero(latestCounter.data().sequence)));
      }
      transaction.set(counter.ref, {
        kind: 'invoice',
        prefix: counter.prefix,
        scope: counter.scope,
        sequence: currentSequence,
        updatedAt: nowIso()
      });
      return currentSequence;
    });
  }

  return `${counter.prefix}-${String(currentSequence + 1).padStart(4, '0')}`;
};

export const createInvoice = async (invoice: InvoiceFormData, auditUser?: AuditUser) => {
  invoice = prepareNewInvoicePayload(invoice, auditUser);
  const activeSettings = await getAppSettings();
  const counter = getInvoiceCounterDetails(activeSettings, invoice.date);
  const initialCounterSnapshot = await getDoc(counter.ref);
  const initialSequence = initialCounterSnapshot.exists()
    ? 0
    : await getHighestExistingInvoiceSequence(activeSettings, invoice.date);
  const docRef = doc(collection(db, INVOICES));
  const advancePaymentRef = doc(collection(db, PAYMENTS));
  const customerRef = doc(db, CUSTOMERS, invoice.customerId);
  const timestamp = nowIso();
  let advanceAppliedAmount = 0;
  let invoiceNumber = '';
  let nextAdvanceBalance = 0;
  let customerBalanceBeforeInvoice = 0;
  let customerOutstandingUpdate: Partial<Customer> = {};

  await runTransaction(db, async (transaction) => {
    const [customerSnapshot, counterSnapshot] = await Promise.all([
      transaction.get(customerRef),
      transaction.get(counter.ref)
    ]);
    if (!customerSnapshot.exists()) throw new Error('Selected customer no longer exists.');
    const currentSequence = counterSnapshot.exists()
      ? Math.max(0, Math.round(numberOrZero(counterSnapshot.data().sequence)))
      : initialSequence;
    const nextSequence = currentSequence + 1;
    invoiceNumber = `${counter.prefix}-${String(nextSequence).padStart(4, '0')}`;
    const customerTier = (customerSnapshot.data().tier as CustomerTier | undefined) || 'Tier 4';
    const invoiceTerms = buildInvoiceTimeTerms(invoice.date, invoice.dueDate, customerTier, activeSettings);
    const advanceBalance = customerSnapshot.exists()
      ? Math.max(0, numberOrZero(customerSnapshot.data().advanceBalance))
      : 0;
    advanceAppliedAmount = Math.min(advanceBalance, Math.max(0, numberOrZero(invoice.totalSales)));
    nextAdvanceBalance = advanceBalance - advanceAppliedAmount;
    customerBalanceBeforeInvoice = applyCustomerOutstandingDelta(customerSnapshot.data(), {}).totalOutstandingAmount;
    customerOutstandingUpdate = buildAtomicOutstandingUpdate(
      customerSnapshot.data(),
      { invoice: Math.max(0, numberOrZero(invoice.totalSales)) - advanceAppliedAmount },
      timestamp
    );

    transaction.set(counter.ref, {
      kind: 'invoice',
      prefix: counter.prefix,
      scope: counter.scope,
      sequence: nextSequence,
      updatedAt: timestamp
    });
    transaction.set(docRef, {
      ...invoice,
      dueDate: invoiceTerms.savedDueDate,
      ...invoiceTerms,
      pcPolicyVersionAtInvoice: CURRENT_PC_POLICY_VERSION,
      invoiceNumber,
      customerBalanceBeforeInvoice,
      customerBalanceAfterInvoice: Math.max(0, numberOrZero(customerOutstandingUpdate.totalOutstandingAmount)),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    transaction.update(customerRef, {
      ...customerOutstandingUpdate,
      advanceBalance: nextAdvanceBalance,
      latestOutstandingInvoiceId: docRef.id
    });

    if (advanceAppliedAmount > 0) {
      transaction.set(advancePaymentRef, {
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        invoiceId: docRef.id,
        invoiceNumber,
        date: invoice.date,
        pcPolicyVersionAtPayment: CURRENT_PC_POLICY_VERSION,
        amount: 0,
        amountAppliedToInvoice: advanceAppliedAmount,
        advanceCreatedAmount: 0,
        advanceAppliedAmount,
        paymentKind: 'advance_application',
        amountUsedForOldBalance: 0,
        oldBalanceBeforePayment: 0,
        oldBalanceAfterPayment: 0,
        cashDiscount: 0,
        mode: 'Other',
        notes: 'Automatically adjusted from customer advance',
        ...(isBranchAwareRecord(invoice) ? {
          shopId: invoice.shopId,
          branchSystemVersion: BRANCH_SYSTEM_VERSION,
          affectsShopCash: false,
          cashSyncedAmount: 0
        } : {}),
        createdAt: timestamp,
        updatedAt: timestamp
      });

    }
  });

  patchCachedCustomer(invoice.customerId, {
    ...customerOutstandingUpdate,
    advanceBalance: nextAdvanceBalance,
    latestOutstandingInvoiceId: docRef.id
  });

  const postProcessing = await runTransactionPostProcessing({
    recordLabel: 'Invoice',
    monthlyDeltas: [{
      customerId: invoice.customerId,
      date: invoice.date,
      totalSales: invoice.totalSales,
      totalProfit: invoice.totalProfit,
      invoiceCount: 1
    }],
    customerIds: [],
    invoiceIds: advanceAppliedAmount > 0 ? [docRef.id] : []
  });
  invalidateTransactionCaches([invoice.customerId], [invoice.date]);
  return { id: docRef.id, invoiceNumber, ref: docRef, advanceAppliedAmount, ...postProcessing };
};

export const updateInvoiceRecord = async (
  invoiceId: string,
  invoice: InvoiceFormData,
  auditUser?: AuditUser,
  options?: { deferPcAward?: boolean }
) => {
  const [existingInvoiceSnapshot, requestedCustomer, activeSettings] = await Promise.all([
    getDoc(doc(db, INVOICES, invoiceId)),
    getCustomerById(invoice.customerId),
    getAppSettings()
  ]);
  const existingInvoice = existingInvoiceSnapshot.exists() ? mapInvoiceDoc(existingInvoiceSnapshot.id, existingInvoiceSnapshot.data()) : undefined;
  if (!existingInvoice) throw new Error('Invoice record no longer exists. Refresh the list and try again.');
  const editingOpeningBalance = isOpeningBalanceInvoice(existingInvoice);
  invoice = editingOpeningBalance
    ? prepareOpeningBalanceInvoiceEdit(existingInvoice, invoice)
    : prepareExistingInvoicePayload(existingInvoice, invoice, auditUser);
  const customer = invoice.customerId === requestedCustomer?.id
    ? requestedCustomer
    : await getCustomerById(invoice.customerId);
  if (!customer) throw new Error('Selected customer no longer exists.');
  if (existingInvoice.customerId && existingInvoice.customerId !== invoice.customerId) {
    const postedPcSnapshot = await getDoc(doc(
      db,
      LOYALTY_LEDGER,
      `${existingInvoice.customerId}_${existingInvoice.id}_invoice_pc`
    ));
    if (postedPcSnapshot.exists()) {
      throw new Error('This invoice cannot be moved because its PC award is already permanently posted.');
    }
  }
  const preserveExistingTerms = existingInvoice.customerId === invoice.customerId && !editingOpeningBalance;
  const invoiceTerms = editingOpeningBalance
    ? undefined
    : buildInvoiceTimeTerms(
        invoice.date,
        invoice.dueDate,
        customer.tier,
        activeSettings,
        preserveExistingTerms ? existingInvoice : undefined
      );

  await updateDoc(doc(db, INVOICES, invoiceId), {
    ...invoice,
    ...(editingOpeningBalance ? {
      invoiceType: OPENING_BALANCE_INVOICE_TYPE,
      isOpeningBalance: true,
      customerBalanceBeforeInvoice: 0,
      customerBalanceAfterInvoice: invoice.totalSales
    } : {}),
    ...(invoiceTerms ? { dueDate: invoiceTerms.savedDueDate, ...invoiceTerms } : {}),
    updatedAt: nowIso()
  });

  const affectedCustomerIds = [existingInvoice?.customerId, invoice.customerId].filter((customerId): customerId is string => Boolean(customerId));
  const postProcessing = await runTransactionPostProcessing({
    recordLabel: 'Invoice',
    monthlyDeltas: editingOpeningBalance ? [] : [
      {
        customerId: existingInvoice.customerId,
        date: existingInvoice.date,
        totalSales: -existingInvoice.totalSales,
        totalProfit: -existingInvoice.totalProfit,
        invoiceCount: -1
      },
      {
        customerId: invoice.customerId,
        date: invoice.date,
        totalSales: invoice.totalSales,
        totalProfit: invoice.totalProfit,
        invoiceCount: 1
      }
    ],
    customerIds: [...new Set(affectedCustomerIds)],
    invoiceIds: editingOpeningBalance || options?.deferPcAward ? [] : [invoiceId]
  });
  invalidateTransactionCaches(affectedCustomerIds, [existingInvoice.date, invoice.date]);
  return { invoiceId, ...postProcessing };
};

export const deleteInvoiceRecord = async (invoiceId: string, auditUser?: AuditUser) => {
  const invoiceRef = doc(db, INVOICES, invoiceId);
  const linkedPaymentsSnapshot = await getDocs(query(collection(db, PAYMENTS), where('invoiceId', '==', invoiceId)));
  const linkedPaymentRefs = linkedPaymentsSnapshot.docs.map((paymentDoc) => paymentDoc.ref);
  let deletedPaymentCount = 0;
  let affectedCustomerId = '';
  let deletedInvoice: Invoice | undefined;
  let deletedPayments: Payment[] = [];

  if (linkedPaymentRefs.length >= 450) {
    throw new Error('This invoice has too many linked payments to delete safely in one operation.');
  }

  await runTransaction(db, async (transaction) => {
    const invoiceSnapshot = await transaction.get(invoiceRef);

    if (!invoiceSnapshot.exists()) {
      throw new Error('Invoice record no longer exists. Refresh the list and try again.');
    }

    deletedInvoice = mapInvoiceDoc(invoiceSnapshot.id, invoiceSnapshot.data());
    affectedCustomerId = deletedInvoice.customerId;

    const paymentSnapshots = await Promise.all(linkedPaymentRefs.map((paymentRef) => transaction.get(paymentRef)));
    const paymentsToDelete = paymentSnapshots
      .filter((paymentSnapshot) => paymentSnapshot.exists())
      .map((paymentSnapshot) => mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data()));
    deletedPayments = paymentsToDelete;
    const oldBalanceRestoreByCustomerId = paymentsToDelete.reduce((restoreMap, payment) => {
      const amountToRestore = Math.max(0, payment.amountUsedForOldBalance ?? 0);

      if (amountToRestore > 0 && payment.customerId) {
        restoreMap.set(payment.customerId, (restoreMap.get(payment.customerId) ?? 0) + amountToRestore);
      }

      return restoreMap;
    }, new Map<string, number>());
    const advanceChangeByCustomerId = paymentsToDelete.reduce((changeMap, payment) => {
      const change = (payment.advanceAppliedAmount ?? 0) - (payment.advanceCreatedAmount ?? 0);

      if (change !== 0 && payment.customerId) {
        changeMap.set(payment.customerId, (changeMap.get(payment.customerId) ?? 0) + change);
      }

      return changeMap;
    }, new Map<string, number>());
    const affectedPaymentCustomerIds = new Set([
      ...oldBalanceRestoreByCustomerId.keys(),
      ...advanceChangeByCustomerId.keys()
    ]);
    const customerRefsById = new Map([...affectedPaymentCustomerIds].map((customerId) => [customerId, doc(db, CUSTOMERS, customerId)]));
    const customerSnapshotsById = new Map(
      await Promise.all(
        [...customerRefsById.entries()].map(async ([customerId, customerRef]) => [customerId, await transaction.get(customerRef)] as const)
      )
    );
    const timestamp = nowIso();

    customerSnapshotsById.forEach((customerSnapshot, customerId) => {
      const amountToRestore = oldBalanceRestoreByCustomerId.get(customerId) ?? 0;
      const advanceChange = advanceChangeByCustomerId.get(customerId) ?? 0;
      const customerRef = customerRefsById.get(customerId);

      if (customerRef && customerSnapshot.exists() && (amountToRestore > 0 || advanceChange !== 0)) {
        const nextAdvance = numberOrZero(customerSnapshot.data().advanceBalance) + advanceChange;

        if (nextAdvance < 0) {
          throw new Error('An advance from this invoice has already been used and the invoice cannot be deleted.');
        }

        transaction.update(customerRef, {
          previousOutstandingAmount: Math.max(0, numberOrZero(customerSnapshot.data().previousOutstandingAmount) + amountToRestore),
          advanceBalance: nextAdvance,
          updatedAt: timestamp
        });
      }
    });

    applyShopCashAdjustments(
      transaction,
      paymentsToDelete.flatMap((payment) => buildShopCashAdjustments(payment)),
      timestamp,
      { id: invoiceId, type: 'invoice_delete' }
    );

    paymentSnapshots.forEach((paymentSnapshot) => {
      if (paymentSnapshot.exists()) {
        transaction.delete(paymentSnapshot.ref);
      }
    });

    transaction.delete(invoiceRef);
    deletedPaymentCount = paymentsToDelete.length;
  });

  const deletedInvoiceSnapshot = await getDoc(invoiceRef);

  if (deletedInvoiceSnapshot.exists()) {
    throw new Error('Invoice delete did not complete. Refresh the list and try again.');
  }

  await applyMonthlySnapshotDeltas([
    ...(deletedInvoice && !isOpeningBalanceInvoice(deletedInvoice) ? [{
      customerId: deletedInvoice.customerId,
      date: deletedInvoice.date,
      totalSales: -deletedInvoice.totalSales,
      totalProfit: -deletedInvoice.totalProfit,
      invoiceCount: -1
    }] : []),
    ...deletedPayments.map((payment) => ({
      customerId: payment.customerId,
      date: payment.date,
      paymentsReceived: -payment.amount
    }))
  ]);

  await syncCustomerFinancialSummary(affectedCustomerId);
  invalidateTransactionCaches(
    [affectedCustomerId],
    [deletedInvoice?.date, ...deletedPayments.map((payment) => payment.date)].filter((date): date is string => Boolean(date))
  );
  return { deletedPaymentCount };
};

export const getPayments = async (options?: DateRangeQueryOptions) => {
  return getCached(cacheKey(PAYMENTS, options), async () => {
    const paymentsQuery = query(collection(db, PAYMENTS), ...buildPaymentQueryConstraints(options));
    const snapshot = await getDocs(paymentsQuery);
    return snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
  });
};

export const getPaymentsBySplitPaymentGroupIds = async (groupIds: string[]) => {
  const uniqueGroupIds = [...new Set(groupIds.filter(Boolean))];
  if (uniqueGroupIds.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < uniqueGroupIds.length; index += 30) {
    chunks.push(uniqueGroupIds.slice(index, index + 30));
  }

  const snapshots = await Promise.all(
    chunks.map((chunk) => getDocs(query(
      collection(db, PAYMENTS),
      where('splitPaymentGroupId', 'in', chunk)
    )))
  );

  return snapshots.flatMap((snapshot) => (
    snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()))
  ));
};

const dueCustomerRowsMatch = (record: DueCustomerRecord, row: DueCustomerRow) => (
  record.customerId === row.customerId
  && record.customerName === row.customerName
  && record.overdueDays === row.overdueDays
  && record.amount === row.amount
  && JSON.stringify(record.invoices) === JSON.stringify(row.invoices)
);

export const getDueCustomerRecords = async () => {
  const snapshot = await getDocs(collection(db, DUE_CUSTOMERS));
  return snapshot.docs
    .map((dueDoc) => mapDueCustomerDoc(dueDoc.id, dueDoc.data()))
    .sort((left, right) =>
      right.overdueDays - left.overdueDays
      || right.amount - left.amount
      || left.customerName.localeCompare(right.customerName)
    );
};

export const syncDueCustomerRecords = async (rows: DueCustomerRow[]) => {
  const existingRows = await getDueCustomerRecords();
  const existingByCustomerId = new Map(existingRows.map((row) => [row.customerId, row]));
  const currentCustomerIds = new Set(rows.map((row) => row.customerId));
  const timestamp = nowIso();
  const records = rows.map((row): DueCustomerRecord => ({
    id: row.customerId,
    ...row,
    updatedAt: existingByCustomerId.get(row.customerId)?.updatedAt || timestamp
  }));
  const changedRecords = records.filter((record) => {
    const existing = existingByCustomerId.get(record.customerId);
    return !existing || !dueCustomerRowsMatch(existing, record);
  });
  const staleRecords = existingRows.filter((record) => !currentCustomerIds.has(record.customerId));
  const batchSize = 450;

  for (let index = 0; index < changedRecords.length; index += batchSize) {
    const batch = writeBatch(db);
    changedRecords.slice(index, index + batchSize).forEach((record) => {
      record.updatedAt = timestamp;
      batch.set(doc(db, DUE_CUSTOMERS, record.customerId), {
        customerId: record.customerId,
        customerName: record.customerName,
        overdueDays: record.overdueDays,
        amount: record.amount,
        invoices: record.invoices,
        updatedAt: record.updatedAt
      });
    });
    await batch.commit();
  }

  for (let index = 0; index < staleRecords.length; index += batchSize) {
    const batch = writeBatch(db);
    staleRecords.slice(index, index + batchSize).forEach((record) => {
      batch.delete(doc(db, DUE_CUSTOMERS, record.id));
    });
    await batch.commit();
  }

  return records;
};

export const deleteDueCustomerRecord = async (customerId: string) => {
  await deleteDoc(doc(db, DUE_CUSTOMERS, customerId));
};

export const getPaymentsByInvoiceId = async (invoiceId: string, options?: Pick<DateRangeQueryOptions, 'limitCount'>) => {
  const paymentsQuery = query(collection(db, PAYMENTS), where('invoiceId', '==', invoiceId));
  const snapshot = await getDocs(paymentsQuery);
  const rows = snapshot.docs
    .map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()))
    .sort((left, right) => right.date.localeCompare(left.date));

  return options?.limitCount && options.limitCount > 0 ? rows.slice(0, options.limitCount) : rows;
};

export const getPaymentsByInvoiceIds = async (invoiceIds: string[]) => {
  const uniqueInvoiceIds = [...new Set(invoiceIds.filter(Boolean))];
  const chunks: string[][] = [];

  for (let index = 0; index < uniqueInvoiceIds.length; index += 30) {
    chunks.push(uniqueInvoiceIds.slice(index, index + 30));
  }

  const snapshots = await Promise.all(
    chunks.map((chunk) => getDocs(query(collection(db, PAYMENTS), where('invoiceId', 'in', chunk))))
  );

  return snapshots.flatMap((snapshot) => snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data())));
};

export const getPaymentsByCustomerId = async (customerId: string, options?: DateRangeQueryOptions) => {
  if (!options?.fromDate && !options?.toDate && !options?.limitCount && !options?.sortBy) {
    const paymentsQuery = query(collection(db, PAYMENTS), where('customerId', '==', customerId));
    const snapshot = await getDocs(paymentsQuery);
    return snapshot.docs
      .map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()))
      .sort((left, right) => right.date.localeCompare(left.date));
  }

  const paymentsQuery = query(collection(db, PAYMENTS), ...buildPaymentQueryConstraints({ ...options, customerId }));
  const snapshot = await getDocs(paymentsQuery);
  return snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
};

export const getPaymentsForCustomerViewer = async (customerId?: string, customerName?: string) => {
  const paymentMap = new Map<string, Payment>();

  if (customerId) {
    // Customer portal avoids composite indexes: query only this customer, then sort locally.
    const byIdQuery = query(collection(db, PAYMENTS), where('customerId', '==', customerId));
    const byIdSnapshot = await getDocs(byIdQuery);
    byIdSnapshot.docs.forEach((paymentDoc) => paymentMap.set(paymentDoc.id, mapPaymentDoc(paymentDoc.id, paymentDoc.data())));
  }

  if (!customerId && customerName) {
    // Legacy fallback only. Prefer customerId in user profiles and new payment docs.
    const byNameQuery = query(collection(db, PAYMENTS), where('customerName', '==', customerName));
    const byNameSnapshot = await getDocs(byNameQuery);
    byNameSnapshot.docs.forEach((paymentDoc) => paymentMap.set(paymentDoc.id, mapPaymentDoc(paymentDoc.id, paymentDoc.data())));
  }

  return [...paymentMap.values()].sort((a, b) => b.date.localeCompare(a.date));
};

const stripUndefinedFields = <T extends Record<string, unknown>>(data: T) => {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as T;
};

const sanitizePaymentPayload = (payment: PaymentFormData): PaymentFormData =>
  stripUndefinedFields({
    ...payment,
    amount: Math.max(0, numberOrZero(payment.amount)),
    amountAppliedToInvoice: payment.amountAppliedToInvoice === undefined
      ? undefined
      : Math.max(0, numberOrZero(payment.amountAppliedToInvoice)),
    cashDiscount: Math.max(0, numberOrZero(payment.cashDiscount))
  });

const buildAllocatedPaymentPayload = (payment: PaymentFormData, previousOutstandingAmount: number) => {
  const cleanPayment = sanitizePaymentPayload(payment);
  const oldBalanceBeforePayment = Math.max(0, numberOrZero(previousOutstandingAmount));
  const amountUsedForOldBalance = 0;
  const amountAppliedToInvoice = Math.min(
    cleanPayment.amount,
    Math.max(0, numberOrZero(cleanPayment.amountAppliedToInvoice ?? cleanPayment.amount))
  );
  const oldBalanceAfterPayment = oldBalanceBeforePayment;
  const advanceCreatedAmount = Math.max(0, cleanPayment.amount - amountAppliedToInvoice);

  return {
    payload: {
      ...cleanPayment,
      // Payments entered against an invoice reduce that selected invoice directly.
      // Legacy old-balance allocations are still preserved on older payment documents.
      amountAppliedToInvoice,
      advanceCreatedAmount,
      advanceAppliedAmount: 0,
      paymentKind: 'receipt' as const,
      amountUsedForOldBalance,
      oldBalanceBeforePayment,
      oldBalanceAfterPayment
    },
    oldBalanceAfterPayment
  };
};

const assertAdvanceCanBeCreated = async (
  payment: PaymentFormData & { amountAppliedToInvoice: number; advanceCreatedAmount: number },
  ignoredPaymentId = ''
) => {
  if (payment.advanceCreatedAmount <= 0) return;

  // Only overpayments take this additional read path.
  const [customerInvoices, customerPayments] = await Promise.all([
    getInvoicesByCustomerId(payment.customerId),
    getPaymentsByCustomerId(payment.customerId)
  ]);
  const unpaidInvoices = getUnpaidInvoicesAfterPayment(
    customerInvoices,
    customerPayments,
    payment,
    ignoredPaymentId
  );

  if (unpaidInvoices.length > 0) {
    throw new Error('Customer advance can be created only after every pending invoice is fully paid.');
  }
};

const awardInvoicePcOnce = async (invoiceId: string): Promise<InvoicePcAwardResult> => {
  if (!invoiceId) return { invoiceId, status: 'not_applicable', points: 0 };

  const invoiceSnapshot = await getDoc(doc(db, INVOICES, invoiceId));
  if (!invoiceSnapshot.exists()) return { invoiceId, status: 'not_applicable', points: 0 };

  const invoice = mapInvoiceDoc(invoiceSnapshot.id, invoiceSnapshot.data());
  if (!invoice.customerId || isOpeningBalanceInvoice(invoice)) {
    return { invoiceId, status: 'not_applicable', points: 0 };
  }
  const ledgerRef = doc(db, LOYALTY_LEDGER, `${invoice.customerId}_${invoice.id}_invoice_pc`);

  // Most edit/delete calls hit an already-posted invoice. Stop after one
  // ledger read instead of reloading its customer, payments, and settings.
  const postedLedgerSnapshot = await getDoc(ledgerRef);
  if (postedLedgerSnapshot.exists()) {
    return {
      invoiceId,
      status: 'already_finalized',
      points: Math.max(0, Math.round(numberOrZero(postedLedgerSnapshot.data().points)))
    };
  }

  const [customer, payments, settings] = await Promise.all([
    getCustomerById(invoice.customerId),
    getPaymentsByInvoiceId(invoice.id),
    getAppSettings()
  ]);
  if (!customer) return { invoiceId, status: 'not_applicable', points: 0 };

  const settlementPayment = getInvoiceFullPaymentEvent(invoice, payments);
  if (!settlementPayment) return { invoiceId, status: 'not_fully_paid', points: 0 };
  const award = calculateInvoiceApcInfo(invoice, payments, customer.tier, settings);
  const recalculatedPoints = Math.max(0, Math.round(award.earnedApc));

  const timestamp = nowIso();
  const balanceRef = doc(db, PC_BALANCES, customer.id);

  return runTransaction(db, async (transaction): Promise<InvoicePcAwardResult> => {
    const ledgerSnapshot = await transaction.get(ledgerRef);
    const decision = decideImmutableInvoicePcAward(
      ledgerSnapshot.exists(),
      ledgerSnapshot.exists() ? ledgerSnapshot.data().points : undefined,
      recalculatedPoints
    );
    if (decision.action === 'keep') {
      return {
        invoiceId,
        status: 'already_finalized',
        points: decision.awardedPoints
      };
    }

    const balanceSnapshot = await transaction.get(balanceRef);
    const balance = balanceSnapshot.exists()
      ? mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data())
      : undefined;

    if (!canPostInvoicePcForSettlement(invoice, settlementPayment, balance?.protectedAt)) {
      return { invoiceId, status: 'not_eligible', points: 0 };
    }

    const nextAvailablePc = (balance?.availablePc ?? 0) + decision.pointsToAdd;

    if (decision.action === 'award') {
      if (balance) {
        transaction.update(balanceRef, {
          availablePc: balance.availablePc + decision.pointsToAdd,
          incomingPc: balance.incomingPc + decision.pointsToAdd,
          lastAwardReferenceId: invoice.id,
          lastMutationReferenceId: ledgerRef.id,
          updatedAt: timestamp
        });
      } else {
        transaction.set(balanceRef, {
          customerId: customer.id,
          availablePc: decision.pointsToAdd,
          incomingPc: decision.pointsToAdd,
          redeemedPc: 0,
          protectedAt: '',
          lastAwardReferenceId: invoice.id,
          lastMutationReferenceId: ledgerRef.id,
          updatedAt: timestamp
        });
      }
    }

    transaction.set(ledgerRef, {
      customerId: customer.id,
      type: 'on_time_payment',
      points: decision.awardedPoints,
      reason: decision.awardedPoints > 0
        ? `Invoice ${invoice.invoiceNumber || invoice.id} PC permanently awarded`
        : `Invoice ${invoice.invoiceNumber || invoice.id} PC permanently finalized at zero`,
      referenceId: invoice.id,
      month: settlementPayment.date.slice(0, 7),
      createdAt: timestamp
    });

    return {
      invoiceId,
      status: decision.action === 'award' ? 'credited' : 'finalized_zero',
      points: decision.awardedPoints,
      availablePc: nextAvailablePc
    };
  });
};

interface TransactionPostProcessingOptions {
  recordLabel: 'Invoice' | 'Payment';
  monthlyDeltas: MonthlySnapshotDelta[];
  customerIds: string[];
  invoiceIds: string[];
}

const buildTransactionPostProcessingWarning = (
  recordLabel: TransactionPostProcessingOptions['recordLabel'],
  area: TransactionPostProcessingWarning['area'],
  referenceId?: string
): TransactionPostProcessingWarning => {
  const messages: Record<TransactionPostProcessingWarning['area'], string> = {
    monthly_snapshot: `${recordLabel} was saved, but the monthly summary refresh is pending.`,
    financial_summary: `${recordLabel} was saved, but the customer outstanding summary refresh is pending.`,
    pc: `${recordLabel} was saved, but PC posting is pending. Admin can retry it from the PC page.`
  };

  return { area, message: messages[area], referenceId };
};

const runTransactionPostProcessing = async ({
  recordLabel,
  monthlyDeltas,
  customerIds,
  invoiceIds
}: TransactionPostProcessingOptions) => {
  const tasks: Array<{
    area: TransactionPostProcessingWarning['area'];
    referenceId?: string;
    run: () => Promise<unknown>;
  }> = [
    {
      area: 'monthly_snapshot',
      run: () => applyMonthlySnapshotDeltas(monthlyDeltas)
    },
    ...customerIds.map((customerId) => ({
      area: 'financial_summary' as const,
      referenceId: customerId,
      run: () => syncCustomerFinancialSummary(customerId)
    })),
    ...invoiceIds.map((invoiceId) => ({
      area: 'pc' as const,
      referenceId: invoiceId,
      run: () => awardInvoicePcOnce(invoiceId)
    }))
  ];
  const settledTasks = await Promise.allSettled(tasks.map((task) => task.run()));
  const pcAwards: InvoicePcAwardResult[] = [];
  const warnings: TransactionPostProcessingWarning[] = [];

  settledTasks.forEach((result, index) => {
    const task = tasks[index];
    if (result.status === 'fulfilled') {
      if (task.area === 'pc') pcAwards.push(result.value as InvoicePcAwardResult);
      return;
    }

    warnings.push(buildTransactionPostProcessingWarning(recordLabel, task.area, task.referenceId));
  });

  return { pcAwards, warnings };
};

export const createPayment = async (payment: PaymentFormData, auditUser?: AuditUser): Promise<PaymentSaveResult> => {
  payment = prepareNewPaymentPayload(payment, auditUser);
  const paymentRef = doc(collection(db, PAYMENTS));
  const timestamp = nowIso();
  let allocatedPayment = buildAllocatedPaymentPayload(payment, 0).payload;
  let customerOutstandingUpdate: Partial<Customer> = {};
  let nextAdvanceBalance = 0;

  await assertAdvanceCanBeCreated(allocatedPayment);

  await runTransaction(db, async (transaction) => {
    const customerRef = doc(db, CUSTOMERS, payment.customerId);
    const invoiceRef = payment.invoiceId ? doc(db, INVOICES, payment.invoiceId) : undefined;
    const [customerSnapshot, invoiceSnapshot] = await Promise.all([
      transaction.get(customerRef),
      invoiceRef ? transaction.get(invoiceRef) : Promise.resolve(undefined)
    ]);
    const previousOutstandingAmount = customerSnapshot.exists() ? numberOrZero(customerSnapshot.data().previousOutstandingAmount) : 0;
    const allocation = buildAllocatedPaymentPayload(payment, previousOutstandingAmount);

    allocatedPayment = {
      ...allocation.payload,
      ...(isBranchAwareRecord(allocation.payload) ? {
        cashSyncedAmount: getNextCashSyncedAmount(allocation.payload)
      } : {})
    };

    if (customerSnapshot.exists()) {
      const targetInvoice = invoiceSnapshot?.exists()
        ? mapInvoiceDoc(invoiceSnapshot.id, invoiceSnapshot.data())
        : undefined;
      nextAdvanceBalance = Math.max(0, numberOrZero(customerSnapshot.data().advanceBalance))
        + allocation.payload.advanceCreatedAmount;
      customerOutstandingUpdate = buildAtomicOutstandingUpdate(
        customerSnapshot.data(),
        getPaymentOutstandingDelta(allocatedPayment as Payment, targetInvoice, -1),
        timestamp
      );
      transaction.update(customerRef, {
        ...customerOutstandingUpdate,
        advanceBalance: nextAdvanceBalance
      });
    }

    transaction.set(paymentRef, {
      ...allocatedPayment,
      pcPolicyVersionAtPayment: CURRENT_PC_POLICY_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    applyShopCashAdjustments(
      transaction,
      buildShopCashAdjustments(undefined, allocatedPayment),
      timestamp,
      { id: paymentRef.id, type: 'payment' }
    );
  });

  if (Object.keys(customerOutstandingUpdate).length > 0) {
    patchCachedCustomer(payment.customerId, {
      ...customerOutstandingUpdate,
      advanceBalance: nextAdvanceBalance
    });
  }

  const postProcessing = await runTransactionPostProcessing({
    recordLabel: 'Payment',
    monthlyDeltas: [{
      customerId: allocatedPayment.customerId,
      date: allocatedPayment.date,
      paymentsReceived: allocatedPayment.amount
    }],
    customerIds: [],
    invoiceIds: [allocatedPayment.invoiceId].filter(Boolean)
  });
  invalidateTransactionCaches([payment.customerId], [allocatedPayment.date]);
  return {
    paymentId: paymentRef.id,
    ...postProcessing
  };
};

export const updatePaymentRecord = async (
  paymentId: string,
  payment: PaymentFormData,
  auditUser?: AuditUser
): Promise<PaymentSaveResult> => {
  const paymentRef = doc(db, PAYMENTS, paymentId);
  const timestamp = nowIso();
  let allocatedPayment = buildAllocatedPaymentPayload(payment, 0).payload;
  let previousPayment: Payment | undefined;
  let affectedCustomerIds: string[] = [payment.customerId];
  let affectedInvoiceIds: string[] = [payment.invoiceId];

  await assertAdvanceCanBeCreated(allocatedPayment, paymentId);

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);
    const existingPayment = paymentSnapshot.exists() ? mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data()) : undefined;
    if (!existingPayment) throw new Error('Payment record no longer exists. Refresh the list and try again.');
    previousPayment = existingPayment;

    if (existingPayment?.paymentKind === 'advance_application') {
      throw new Error('Automatic advance adjustments cannot be edited. Edit the invoice or delete the adjustment instead.');
    }

    const movesPostedAward = Boolean(
      existingPayment
      && (existingPayment.invoiceId !== payment.invoiceId || existingPayment.customerId !== payment.customerId)
      && existingPayment.invoiceId
      && existingPayment.customerId
    );
    if (movesPostedAward && existingPayment) {
      const postedPcSnapshot = await transaction.get(doc(
        db,
        LOYALTY_LEDGER,
        `${existingPayment.customerId}_${existingPayment.invoiceId}_invoice_pc`
      ));
      if (postedPcSnapshot.exists()) {
        throw new Error('This payment cannot be moved because its invoice PC award is already permanently posted.');
      }
    }

    const oldCustomerId = existingPayment?.customerId || payment.customerId;
    affectedCustomerIds = [...new Set([oldCustomerId, payment.customerId].filter(Boolean))];
    affectedInvoiceIds = [...new Set([existingPayment?.invoiceId, payment.invoiceId].filter((invoiceId): invoiceId is string => Boolean(invoiceId)))];
    const oldCustomerRef = oldCustomerId ? doc(db, CUSTOMERS, oldCustomerId) : undefined;
    const newCustomerRef = doc(db, CUSTOMERS, payment.customerId);
    const oldCustomerSnapshot = oldCustomerRef ? await transaction.get(oldCustomerRef) : undefined;
    const newCustomerSnapshot = oldCustomerId === payment.customerId ? oldCustomerSnapshot : await transaction.get(newCustomerRef);
    const oldBalanceRestored = oldCustomerSnapshot?.exists()
      ? Math.max(0, numberOrZero(oldCustomerSnapshot.data().previousOutstandingAmount) + (existingPayment?.amountUsedForOldBalance ?? 0))
      : 0;
    const newCustomerOldBalanceBeforePayment =
      oldCustomerId === payment.customerId
        ? oldBalanceRestored
        : newCustomerSnapshot?.exists()
          ? numberOrZero(newCustomerSnapshot.data().previousOutstandingAmount)
          : 0;
    const preparedPayment = prepareExistingPaymentPayload(existingPayment, payment, auditUser);
    const allocation = buildAllocatedPaymentPayload(preparedPayment, newCustomerOldBalanceBeforePayment);
    const oldAdvanceCreated = existingPayment?.advanceCreatedAmount ?? 0;
    const newAdvanceCreated = allocation.payload.advanceCreatedAmount;

    allocatedPayment = {
      ...allocation.payload,
      ...(isBranchAwareRecord(allocation.payload) ? {
        cashSyncedAmount: getNextCashSyncedAmount(allocation.payload)
      } : {})
    };

    if (oldCustomerId === payment.customerId) {
      const currentAdvance = newCustomerSnapshot?.exists()
        ? Math.max(0, numberOrZero(newCustomerSnapshot.data().advanceBalance))
        : 0;
      const nextAdvance = currentAdvance - oldAdvanceCreated + newAdvanceCreated;

      if (nextAdvance < 0) {
        throw new Error('This payment advance has already been used on a newer invoice and cannot be reduced.');
      }

      if (newCustomerSnapshot?.exists()) {
        transaction.update(newCustomerRef, {
          previousOutstandingAmount: allocation.oldBalanceAfterPayment,
          advanceBalance: nextAdvance,
          updatedAt: timestamp
        });
      }
    } else {
      const oldCustomerAdvance = oldCustomerSnapshot?.exists()
        ? Math.max(0, numberOrZero(oldCustomerSnapshot.data().advanceBalance))
        : 0;

      if (oldCustomerAdvance < oldAdvanceCreated) {
        throw new Error('This payment advance has already been used and the payment cannot be moved to another customer.');
      }

      if (oldCustomerRef && oldCustomerSnapshot?.exists()) {
        transaction.update(oldCustomerRef, {
          previousOutstandingAmount: oldBalanceRestored,
          advanceBalance: oldCustomerAdvance - oldAdvanceCreated,
          updatedAt: timestamp
        });
      }

      if (newCustomerSnapshot?.exists()) {
        transaction.update(newCustomerRef, {
          previousOutstandingAmount: allocation.oldBalanceAfterPayment,
          advanceBalance: Math.max(0, numberOrZero(newCustomerSnapshot.data().advanceBalance)) + newAdvanceCreated,
          updatedAt: timestamp
        });
      }
    }

    transaction.update(paymentRef, {
      ...allocatedPayment,
      updatedAt: timestamp
    });
    applyShopCashAdjustments(
      transaction,
      buildShopCashAdjustments(existingPayment, allocatedPayment),
      timestamp,
      { id: paymentId, type: 'payment' }
    );
  });

  const postProcessing = await runTransactionPostProcessing({
    recordLabel: 'Payment',
    monthlyDeltas: [
      ...(previousPayment ? [{
        customerId: previousPayment.customerId,
        date: previousPayment.date,
        paymentsReceived: -previousPayment.amount
      }] : []),
      {
        customerId: allocatedPayment.customerId,
        date: allocatedPayment.date,
        paymentsReceived: allocatedPayment.amount
      }
    ],
    customerIds: affectedCustomerIds,
    invoiceIds: affectedInvoiceIds
  });
  invalidateTransactionCaches(
    affectedCustomerIds,
    [previousPayment?.date, allocatedPayment.date].filter((date): date is string => Boolean(date))
  );
  return {
    paymentId,
    ...postProcessing
  };
};

export const deletePaymentRecord = async (paymentId: string, auditUser?: AuditUser) => {
  const paymentRef = doc(db, PAYMENTS, paymentId);
  const timestamp = nowIso();
  let deletedPayment: Payment | undefined;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);

    if (!paymentSnapshot.exists()) {
      throw new Error('Payment record no longer exists. Refresh the list and try again.');
    }

    deletedPayment = mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data());
    const oldBalanceAllocation = deletedPayment.amountUsedForOldBalance ?? 0;
    const advanceCreatedAmount = deletedPayment.advanceCreatedAmount ?? 0;
    const advanceAppliedAmount = deletedPayment.advanceAppliedAmount ?? 0;

    if (oldBalanceAllocation > 0 || advanceCreatedAmount > 0 || advanceAppliedAmount > 0) {
      const customerRef = doc(db, CUSTOMERS, deletedPayment.customerId);
      const customerSnapshot = await transaction.get(customerRef);

      if (customerSnapshot.exists()) {
        const currentAdvance = Math.max(0, numberOrZero(customerSnapshot.data().advanceBalance));
        const nextAdvance = currentAdvance - advanceCreatedAmount + advanceAppliedAmount;

        if (nextAdvance < 0) {
          throw new Error('This payment advance has already been used on a newer invoice and cannot be deleted.');
        }

        // Deleting a payment reverses the old-balance clearing that payment originally performed.
        transaction.update(customerRef, {
          previousOutstandingAmount: Math.max(0, numberOrZero(customerSnapshot.data().previousOutstandingAmount) + oldBalanceAllocation),
          advanceBalance: nextAdvance,
          updatedAt: timestamp
        });
      }
    }

    applyShopCashAdjustments(
      transaction,
      buildShopCashAdjustments(deletedPayment),
      timestamp,
      { id: paymentId, type: 'payment' }
    );
    transaction.delete(paymentRef);
  });

  const deletedPaymentSnapshot = await getDoc(paymentRef);

  if (deletedPaymentSnapshot.exists()) {
    throw new Error('Payment delete did not complete. Refresh the list and try again.');
  }

  if (deletedPayment) {
    await applyMonthlySnapshotDeltas([{
      customerId: deletedPayment.customerId,
      date: deletedPayment.date,
      paymentsReceived: -deletedPayment.amount
    }]);
  }

  await syncCustomerFinancialSummary(deletedPayment?.customerId ?? '');
  await awardInvoicePcOnce(deletedPayment?.invoiceId ?? '');
  invalidateTransactionCaches(
    deletedPayment?.customerId ? [deletedPayment.customerId] : [],
    deletedPayment?.date ? [deletedPayment.date] : []
  );
};

export const getAppSettings = async (forceRefresh = false) => {
  if (appSettingsCache && !forceRefresh) {
    return appSettingsCache;
  }

  if (!forceRefresh) {
    const cachedSettings = await getCached(cacheKey(SETTINGS, { key: 'erpSettings' }), async () => {
      const preferredSettingsDoc = await getDoc(doc(db, SETTINGS, APP_SETTINGS_DOC_ID));

      if (preferredSettingsDoc.exists()) {
        return mapSettingsDoc(preferredSettingsDoc.id, preferredSettingsDoc.data());
      }

      const settingsQuery = query(collection(db, SETTINGS), where('key', '==', 'erpSettings'));
      const snapshot = await getDocs(settingsQuery);
      const existingSettings = snapshot.docs[0];

      return existingSettings ? mapSettingsDoc(existingSettings.id, existingSettings.data()) : undefined;
    });

    if (cachedSettings) {
      appSettingsCache = cachedSettings;
      return appSettingsCache;
    }
  }

  const preferredSettingsDoc = await getDoc(doc(db, SETTINGS, APP_SETTINGS_DOC_ID));

  if (preferredSettingsDoc.exists()) {
    appSettingsCache = mapSettingsDoc(preferredSettingsDoc.id, preferredSettingsDoc.data());
    return appSettingsCache;
  }

  const settingsQuery = query(collection(db, SETTINGS), where('key', '==', 'erpSettings'));
  const snapshot = await getDocs(settingsQuery);
  const existingSettings = snapshot.docs[0];

  if (existingSettings) {
    appSettingsCache = mapSettingsDoc(existingSettings.id, existingSettings.data());
    return appSettingsCache;
  }

  const timestamp = nowIso();

  await setDoc(doc(db, SETTINGS, APP_SETTINGS_DOC_ID), {
    ...DEFAULT_SETTINGS,
    updatedAt: timestamp
  });

  appSettingsCache = {
    ...DEFAULT_SETTINGS,
    id: APP_SETTINGS_DOC_ID,
    updatedAt: timestamp
  };

  return appSettingsCache;
};

export const listenToAppSettings = async (
  onChange: (settings: AppSettings) => void,
  onError?: (error: Error) => void
) => {
  const currentSettings = await getAppSettings(true);
  onChange(currentSettings);

  return onSnapshot(
    doc(db, SETTINGS, currentSettings.id || APP_SETTINGS_DOC_ID),
    (snapshot) => {
      if (!snapshot.exists()) return;

      appSettingsCache = mapSettingsDoc(snapshot.id, snapshot.data());
      onChange(appSettingsCache);
    },
    (error) => onError?.(error)
  );
};

export const updateAppSettings = async (settings: AppSettings, auditUser?: AuditUser) => {
  const appSettings = mergeWithDefaultSettings(settings);
  const validation = validateAppSettings(appSettings);

  if (!validation.isValid) {
    throw new Error(validation.errors.join(' '));
  }

  if (!settings.id) {
    const timestamp = nowIso();
    const docRef = await addDoc(collection(db, SETTINGS), {
      ...appSettings,
      updatedAt: timestamp
    });

    clearFirestoreSessionCache();
    appSettingsCache = { ...appSettings, id: docRef.id, updatedAt: timestamp };
    return docRef;
  }

  const timestamp = nowIso();
  await updateDoc(doc(db, SETTINGS, settings.id), {
    ...appSettings,
    updatedAt: timestamp
  });

  clearFirestoreSessionCache();
  appSettingsCache = { ...appSettings, id: settings.id, updatedAt: timestamp };
};

export type AppSettingsToggleField = 'down' | 'customerDown' | 'turnOnOrder' | 'medicalOrder' | 'headerOrder';

export const updateAppSettingsToggle = async (field: AppSettingsToggleField, value: boolean) => {
  const currentSettings = await getAppSettings();
  const settingsId = currentSettings.id || APP_SETTINGS_DOC_ID;
  const timestamp = nowIso();

  const updates = field === 'medicalOrder' && value
    ? { medicalOrder: true, turnOnOrder: false, updatedAt: timestamp }
    : { [field]: value, updatedAt: timestamp };
  await updateDoc(doc(db, SETTINGS, settingsId), updates);

  clearFirestoreSessionCache(SETTINGS);
  appSettingsCache = {
    ...currentSettings,
    id: settingsId,
    ...updates
  };
};

export const getGiftHistory = async (options?: DateRangeQueryOptions) => {
  return getCached(cacheKey(GIFT_HISTORY, options), async () => {
    const constraints: QueryConstraint[] = [];
    applyDateRangeConstraints(constraints, 'giftedDate', options);
    constraints.push(orderBy('giftedDate', 'desc'));
    applyLimitConstraint(constraints, options?.limitCount);
    const giftQuery = query(collection(db, GIFT_HISTORY), ...constraints);
    const snapshot = await getDocs(giftQuery);
    return snapshot.docs.map((giftDoc) => mapGiftHistoryDoc(giftDoc.id, giftDoc.data()));
  });
};

export const getGiftHistoryByCustomerId = async (customerId: string) => {
  const giftQuery = query(collection(db, GIFT_HISTORY), where('customerId', '==', customerId));
  const snapshot = await getDocs(giftQuery);
  return snapshot.docs
    .map((giftDoc) => mapGiftHistoryDoc(giftDoc.id, giftDoc.data()))
    .sort((a, b) => b.giftedDate.localeCompare(a.giftedDate));
};

export const createGiftHistoryRecord = async (gift: GiftHistoryFormData, auditUser?: AuditUser) => {
  const docRef = await addDoc(collection(db, GIFT_HISTORY), {
    ...gift,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  clearFirestoreSessionCache();
  return docRef;
};

export const updateGiftHistoryRecord = async (giftId: string, gift: Partial<GiftHistory>, auditUser?: AuditUser) => {
  await updateDoc(doc(db, GIFT_HISTORY, giftId), {
    ...gift,
    updatedAt: nowIso()
  });

  clearFirestoreSessionCache();
};

export const deleteGiftHistoryRecord = async (giftId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, GIFT_HISTORY, giftId));
  clearFirestoreSessionCache();
};

export const getGiftItems = async () => {
  return getCached(cacheKey(GIFT_ITEMS), async () => {
    const giftItemsQuery = query(collection(db, GIFT_ITEMS), orderBy('giftItemName', 'asc'));
    const snapshot = await getDocs(giftItemsQuery);
    return snapshot.docs.map((giftItemDoc) => mapGiftItemDoc(giftItemDoc.id, giftItemDoc.data()));
  });
};

export const createGiftItem = async (giftItem: GiftItemFormData, auditUser?: AuditUser) => {
  const payload = sanitizeGiftItemPayload(giftItem);
  const docRef = await addDoc(collection(db, GIFT_ITEMS), {
    ...payload,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  clearFirestoreSessionCache();
  return docRef;
};

export const updateGiftItemRecord = async (giftItemId: string, giftItem: GiftItemFormData, auditUser?: AuditUser) => {
  const payload = sanitizeGiftItemPayload(giftItem);

  await updateDoc(doc(db, GIFT_ITEMS, giftItemId), {
    ...payload,
    updatedAt: nowIso()
  });

  clearFirestoreSessionCache();
};

export const deleteGiftItemRecord = async (giftItemId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, GIFT_ITEMS, giftItemId));
  clearFirestoreSessionCache();
};

export const getUserProfiles = async () => {
  const usersQuery = query(collection(db, USERS), orderBy('email', 'asc'));
  const snapshot = await getDocs(usersQuery);
  return snapshot.docs.map((userDoc) => mapUserProfileDoc(userDoc.id, userDoc.data()));
};

export const getUserProfileByUid = async (uid: string) => {
  if (!uid) return undefined;

  const directSnapshot = await getDoc(doc(db, USERS, uid));

  if (directSnapshot.exists()) {
    return mapUserProfileDoc(directSnapshot.id, directSnapshot.data());
  }

  const userQuery = query(collection(db, USERS), where('uid', '==', uid));
  const snapshot = await getDocs(userQuery);
  const userDoc = snapshot.docs[0];
  return userDoc ? mapUserProfileDoc(userDoc.id, userDoc.data()) : undefined;
};

export const createUserProfile = async (profile: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>) => {
  const profileRef = profile.uid ? doc(db, USERS, profile.uid) : doc(collection(db, USERS));
  const timestamp = nowIso();

  await setDoc(profileRef, {
    ...withoutUndefined(profile),
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return profileRef;
};

export const updateUserProfileRecord = async (profileId: string, profile: Partial<Pick<UserProfile, 'name' | 'email' | 'customerId' | 'customerName' | 'shopId' | 'active'>>, auditUser?: AuditUser) => {
  await updateDoc(doc(db, USERS, profileId), {
    ...withoutUndefined(profile),
    updatedAt: nowIso()
  });

};

export const deleteUserProfileRecord = async (profileId: string) => {
  await deleteDoc(doc(db, USERS, profileId));
};

export const getOffers = async () => {
  return getCached(cacheKey(OFFERS, { limitCount: DEFAULT_LIST_LIMIT }), async () => {
    const offersQuery = query(collection(db, OFFERS), orderBy('createdAt', 'desc'), firestoreLimit(DEFAULT_LIST_LIMIT));
    const snapshot = await getDocs(offersQuery);
    return snapshot.docs.map((offerDoc) => mapOfferDoc(offerDoc.id, offerDoc.data()));
  });
};

export const getActiveOffers = async () => {
  const offers = await getCached(cacheKey(OFFERS, { isActive: true }), async () => {
    // Free-tier safety: customers only read active offer docs. Sorting stays local so this
    // customer portal query does not require a composite Firestore index.
    const offersQuery = query(collection(db, OFFERS), where('isActive', '==', true));
    const snapshot = await getDocs(offersQuery);
    return snapshot.docs.map((offerDoc) => mapOfferDoc(offerDoc.id, offerDoc.data()));
  });

  // Inactive offer filtering: customers only receive active offers inside any valid date window.
  return sortOffersByLatest(offers.filter((offer) => isOfferCurrentlyActive(offer, getTodayDateString()))).slice(0, ACTIVE_OFFER_LIMIT);
};

export const createOffer = async (offer: OfferFormData, auditUser?: AuditUser) => {
  const payload = sanitizeOfferPayload(offer);

  const docRef = await addDoc(collection(db, OFFERS), {
    ...payload,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: auditUser?.userEmail || auditUser?.userId || ''
  });

  clearFirestoreSessionCache();
  return docRef;
};

export const updateOfferRecord = async (offerId: string, offer: OfferFormData, auditUser?: AuditUser) => {
  const payload = sanitizeOfferPayload(offer);

  await updateDoc(doc(db, OFFERS, offerId), {
    ...payload,
    updatedAt: nowIso()
  });
  clearFirestoreSessionCache();
};

export const deleteOfferRecord = async (offerId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, OFFERS, offerId));
  clearFirestoreSessionCache();
};

export const getMonthlyCustomerStats = async (customerId: string, month = getCurrentMonthKey()) => {
  if (!customerId) return undefined;
  const statsId = getMonthlyStatsId(customerId, month);
  const snapshot = await getDoc(doc(db, MONTHLY_CUSTOMER_STATS, statsId));
  return snapshot.exists() ? mapMonthlyCustomerStatsDoc(snapshot.id, snapshot.data()) : undefined;
};

export const getMonthlyCustomerStatsForMonth = async (month = getCurrentMonthKey(), limitCount = DEFAULT_LIST_LIMIT) => {
  const statsQuery = query(collection(db, MONTHLY_CUSTOMER_STATS), where('month', '==', month), firestoreLimit(limitCount));
  const snapshot = await getDocs(statsQuery);
  return snapshot.docs.map((statsDoc) => mapMonthlyCustomerStatsDoc(statsDoc.id, statsDoc.data()));
};

export const getBusinessMonthlySnapshots = async (fromMonth: string, toMonth: string) => {
  return getCached(cacheKey(BUSINESS_MONTHLY_SNAPSHOTS, { fromMonth, toMonth }), async () => {
    const snapshotQuery = query(
      collection(db, BUSINESS_MONTHLY_SNAPSHOTS),
      where('month', '>=', fromMonth),
      where('month', '<=', toMonth),
      orderBy('month', 'asc')
    );
    const snapshot = await getDocs(snapshotQuery);
    return snapshot.docs.map((snapshotDoc) => mapBusinessMonthlySnapshotDoc(snapshotDoc.id, snapshotDoc.data()));
  });
};

export const getCustomerMonthlySnapshots = async (customerId: string, fromMonth: string, toMonth: string) => {
  if (!customerId) return [];
  const snapshotQuery = query(
    collection(db, CUSTOMER_MONTHLY_SNAPSHOTS),
    where('customerId', '==', customerId),
    where('month', '>=', fromMonth),
    where('month', '<=', toMonth),
    orderBy('month', 'asc')
  );
  const snapshot = await getDocs(snapshotQuery);
  return snapshot.docs.map((snapshotDoc) => mapCustomerMonthlySnapshotDoc(snapshotDoc.id, snapshotDoc.data()));
};

export const rebuildMonthlyCustomerStats = async (month = getCurrentMonthKey(), auditUser?: AuditUser) => {
  const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
    getCustomers(),
    getInvoices({ fromDate: `${month}-01`, toDate: `${month}-31` }),
    getPayments({ fromDate: `${month}-01`, toDate: `${month}-31` }),
    getAppSettings()
  ]);
  const timestamp = nowIso();
  const statsRows = customerRows.map((customer) => buildMonthlyCustomerStats(customer, invoiceRows, paymentRows, appSettings, month));

  await Promise.all(
    statsRows.map(async (stats) => {
      const statsRef = doc(db, MONTHLY_CUSTOMER_STATS, stats.id);
      await setDoc(statsRef, {
        ...stats,
        updatedAt: timestamp
      }, { merge: true });
    })
  );

  clearFirestoreSessionCache();
  return statsRows;
};

export const getCustomerPcBalanceRecord = async (customerId: string) => {
  if (!customerId) return undefined;
  const snapshot = await getDoc(doc(db, PC_BALANCES, customerId));
  return snapshot.exists() ? mapPcBalanceRecord(snapshot.id, snapshot.data()) : undefined;
};

export const getCustomerPcLedgerEntries = async (customerId: string, limitCount = 500) => {
  if (!customerId) return [];
  const snapshot = await getDocs(query(
    collection(db, LOYALTY_LEDGER),
    where('customerId', '==', customerId),
    firestoreLimit(limitCount)
  ));
  return snapshot.docs
    .map((entryDoc) => mapLoyaltyLedgerEntry(entryDoc.id, entryDoc.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const requireAdminAudit = (auditUser?: AuditUser) => {
  if (auditUser?.role !== 'Admin') throw new Error('Only Admin users can change protected PC balances.');
};

export const retryInvoicePcAwards = async (invoiceIds: string[], auditUser?: AuditUser) => {
  requireAdminAudit(auditUser);
  const results: InvoicePcAwardResult[] = [];
  const failures: InvoicePcRetryFailure[] = [];

  for (const invoiceId of [...new Set(invoiceIds.filter(Boolean))]) {
    try {
      results.push(await awardInvoicePcOnce(invoiceId));
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const message = error instanceof Error ? error.message : '';
      failures.push({
        invoiceId,
        permissionDenied: code.includes('permission-denied') || /missing or insufficient permissions/i.test(message)
      });
    }
  }

  return { results, failures };
};

export const protectCustomerPcBalance = async (
  customerId: string,
  currentBalance: number,
  auditUser?: AuditUser
) => {
  requireAdminAudit(auditUser);
  const cleanBalance = Math.max(0, Math.round(numberOrZero(currentBalance)));
  const balanceRef = doc(db, PC_BALANCES, customerId);
  const openingRef = doc(db, LOYALTY_LEDGER, `${customerId}_pc_opening_balance_v1`);
  const timestamp = nowIso();

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(balanceRef);
    if (existing.exists()) throw new Error('This customer PC balance is already protected.');

    transaction.set(balanceRef, {
      customerId,
      availablePc: cleanBalance,
      incomingPc: cleanBalance,
      redeemedPc: 0,
      protectedAt: timestamp,
      lastMutationReferenceId: openingRef.id,
      updatedAt: timestamp
    });
    transaction.set(openingRef, {
      customerId,
      type: 'opening_balance',
      points: cleanBalance,
      reason: 'Protected PC opening balance',
      referenceId: 'pc_opening_balance_v1',
      month: timestamp.slice(0, 7),
      createdAt: timestamp
    });
  });

  clearFirestoreSessionCache();
  return getCustomerPcBalanceRecord(customerId);
};

export const adjustCustomerPcBalance = async (
  customerId: string,
  direction: 'add' | 'deduct',
  points: number,
  reason: string,
  auditUser?: AuditUser
) => {
  requireAdminAudit(auditUser);
  const cleanPoints = Math.max(0, Math.round(numberOrZero(points)));
  const cleanReason = reason.trim();
  if (cleanPoints <= 0) throw new Error('PC amount must be above 0.');
  if (!cleanReason) throw new Error('Reason is required for a manual PC adjustment.');
  if (cleanReason.length > 140) throw new Error('Reason must be 140 characters or fewer.');

  const balanceRef = doc(db, PC_BALANCES, customerId);
  const entryRef = doc(collection(db, LOYALTY_LEDGER));
  const timestamp = nowIso();
  const delta = direction === 'add' ? cleanPoints : -cleanPoints;

  const result = await runTransaction(db, async (transaction) => {
    const balanceSnapshot = await transaction.get(balanceRef);
    if (!balanceSnapshot.exists()) throw new Error('Protect this customer PC balance before adjusting it.');
    const balance = mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data());
    const nextAvailable = balance.availablePc + delta;
    if (nextAvailable < 0) throw new Error('PC deduction cannot exceed the available balance.');

    const nextBalance: PcBalanceRecord = {
      ...balance,
      availablePc: nextAvailable,
      incomingPc: balance.incomingPc + (delta > 0 ? delta : 0),
      redeemedPc: balance.redeemedPc + (delta < 0 ? Math.abs(delta) : 0),
      lastMutationReferenceId: entryRef.id,
      updatedAt: timestamp
    };
    const ledgerEntry: LoyaltyLedgerEntry = {
      id: entryRef.id,
      customerId,
      type: 'manual_adjustment',
      points: delta,
      reason: cleanReason,
      referenceId: entryRef.id,
      month: timestamp.slice(0, 7),
      createdAt: timestamp
    };

    transaction.update(balanceRef, {
      availablePc: nextBalance.availablePc,
      incomingPc: nextBalance.incomingPc,
      redeemedPc: nextBalance.redeemedPc,
      lastMutationReferenceId: nextBalance.lastMutationReferenceId,
      updatedAt: nextBalance.updatedAt
    });
    transaction.set(entryRef, {
      customerId: ledgerEntry.customerId,
      type: ledgerEntry.type,
      points: ledgerEntry.points,
      reason: ledgerEntry.reason,
      referenceId: ledgerEntry.referenceId,
      month: ledgerEntry.month,
      createdAt: ledgerEntry.createdAt
    });

    return { balance: nextBalance, ledgerEntry };
  });

  clearFirestoreSessionCache();
  return result;
};

export const getOverduePcRequests = async (limitCount = DEFAULT_LIST_LIMIT) => {
  return getCached(cacheKey(OVERDUE_PC_REQUESTS, { status: 'Pending', limitCount }), async () => {
    const requestsQuery = query(collection(db, OVERDUE_PC_REQUESTS), where('status', '==', 'Pending'), firestoreLimit(limitCount));
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs
      .map((requestDoc) => mapOverduePcRequestDoc(requestDoc.id, requestDoc.data()))
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  });
};

export const getApprovedOverduePcRequests = async (limitCount = DEFAULT_LIST_LIMIT) => {
  return getCached(cacheKey(OVERDUE_PC_REQUESTS, { status: 'Approved', limitCount }), async () => {
    const requestsQuery = query(collection(db, OVERDUE_PC_REQUESTS), where('status', '==', 'Approved'), firestoreLimit(limitCount));
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs.map((requestDoc) => mapOverduePcRequestDoc(requestDoc.id, requestDoc.data()));
  });
};

export const getApprovedOverduePcRequestsForCustomer = async (customerId: string, limitCount = DEFAULT_LIST_LIMIT) => {
  if (!customerId) return [];
  return getCached(cacheKey(OVERDUE_PC_REQUESTS, { customerId, status: 'Approved', limitCount }), async () => {
    const requestsQuery = query(
      collection(db, OVERDUE_PC_REQUESTS),
      where('customerId', '==', customerId),
      where('status', '==', 'Approved'),
      firestoreLimit(limitCount)
    );
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs.map((requestDoc) => mapOverduePcRequestDoc(requestDoc.id, requestDoc.data()));
  });
};

export const generateOverduePcRequests = async (auditUser?: AuditUser, options?: DateRangeQueryOptions) => {
  requireAdminAudit(auditUser);
  void options;
  // Hybrid invoice PC already applies lateness retention and posts the final
  // amount. Generating a second overdue request would duplicate that award.
  return { createdCount: 0 };
};

export const reviewOverduePcRequest = async (
  requestId: string,
  status: 'Approved' | 'Rejected',
  approvedCoins: number,
  auditUser?: AuditUser,
  notes = ''
) => {
  requireAdminAudit(auditUser);
  if (status === 'Approved') {
    throw new Error('Legacy overdue PC requests cannot be approved because hybrid invoice PC is posted automatically.');
  }
  void approvedCoins;
  const requestRef = doc(db, OVERDUE_PC_REQUESTS, requestId);
  const timestamp = nowIso();

  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error('Overdue PC request no longer exists.');
    }

    const pcRequest = mapOverduePcRequestDoc(requestSnapshot.id, requestSnapshot.data());

    if (pcRequest.status !== 'Pending') {
      throw new Error('Only pending overdue PC requests can be reviewed.');
    }

    transaction.update(requestRef, {
      status: 'Rejected',
      approvedCoins: 0,
      reviewedAt: timestamp,
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes
    });
  });

  clearFirestoreSessionCache(OVERDUE_PC_REQUESTS);
};

export const getBonusPcRequests = async (limitCount = DEFAULT_LIST_LIMIT) => {
  return getCached(cacheKey(BONUS_PC_REQUESTS, { status: 'Pending', limitCount }), async () => {
    const requestsQuery = query(collection(db, BONUS_PC_REQUESTS), where('status', '==', 'Pending'), firestoreLimit(limitCount));
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs
      .map((requestDoc) => mapBonusPcRequestDoc(requestDoc.id, requestDoc.data()))
      .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  });
};

export const getApprovedBonusPcRequests = async (limitCount = DEFAULT_LIST_LIMIT) => {
  return getCached(cacheKey(BONUS_PC_REQUESTS, { status: 'Approved', limitCount }), async () => {
    const requestsQuery = query(collection(db, BONUS_PC_REQUESTS), where('status', '==', 'Approved'), firestoreLimit(limitCount));
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs.map((requestDoc) => mapBonusPcRequestDoc(requestDoc.id, requestDoc.data()));
  });
};

export const getApprovedBonusPcRequestsForCustomer = async (customerId: string, limitCount = DEFAULT_LIST_LIMIT) => {
  if (!customerId) return [];
  return getCached(cacheKey(BONUS_PC_REQUESTS, { customerId, status: 'Approved', limitCount }), async () => {
    const requestsQuery = query(
      collection(db, BONUS_PC_REQUESTS),
      where('customerId', '==', customerId),
      where('status', '==', 'Approved'),
      firestoreLimit(limitCount)
    );
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs.map((requestDoc) => mapBonusPcRequestDoc(requestDoc.id, requestDoc.data()));
  });
};

export const approveReferralBonus = async (referrerId: string, referredCustomerId: string, auditUser?: AuditUser) => {
  if (auditUser?.role !== 'Admin') {
    throw new Error('Only Admin users can approve referral bonuses.');
  }

  if (!referrerId || !referredCustomerId) throw new Error('Select both the referrer and referred customer.');
  if (referrerId === referredCustomerId) throw new Error('The referrer and referred customer must be different.');

  const [referrer, referredCustomer, referredInvoices, referredPayments] = await Promise.all([
    getCustomerById(referrerId),
    getCustomerById(referredCustomerId),
    getInvoicesByCustomerId(referredCustomerId),
    getPaymentsByCustomerId(referredCustomerId)
  ]);

  if (!referrer || !referredCustomer) throw new Error('A selected customer no longer exists.');
  const firstValidInvoice = referredInvoices
    .filter(isValidBonusInvoice)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt))[0];
  if (!firstValidInvoice || !isInvoiceFullyPaidThrough(firstValidInvoice, referredPayments, getTodayDateString())) {
    throw new Error('The referred customer first valid business invoice must be fully paid before referral PC is awarded.');
  }

  const referralCoins = FIXED_BONUS_PC.referral;
  const requestId = getReferralBonusId(referrer.id, referredCustomer.id);
  const requestRef = doc(db, BONUS_PC_REQUESTS, requestId);
  const timestamp = nowIso();
  const reviewer = auditUser.userEmail || auditUser.userId || '';
  const notes = `Referral completed after ${referredCustomer.name}'s first valid invoice was fully paid.`;
  let awarded = false;

  await runTransaction(db, async (transaction) => {
    const balanceRef = doc(db, PC_BALANCES, referrer.id);
    const ledgerRef = doc(db, LOYALTY_LEDGER, `${referrer.id}_${requestId}_bonus_pc`);
    const [existingRequest, balanceSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(balanceRef),
      transaction.get(ledgerRef)
    ]);
    if (existingRequest.exists() || ledgerSnapshot.exists()) return;

    transaction.set(requestRef, {
      customerId: referrer.id,
      customerName: referrer.name,
      bonusType: 'referral',
      bonusLabel: BONUS_PC_LABELS.referral,
      triggerType: 'referred_first_invoice_fully_paid',
      referenceId: referredCustomer.id,
      suggestedCoins: referralCoins,
      approvedCoins: referralCoins,
      status: 'Approved',
      generatedAt: timestamp,
      reviewedAt: timestamp,
      reviewedBy: reviewer,
      customerSeenAt: '',
      notes
    });

    transaction.set(ledgerRef, {
      customerId: referrer.id,
      type: 'bonus',
      points: referralCoins,
      reason: `${BONUS_PC_LABELS.referral}: ${notes}`,
      referenceId: requestId,
      month: timestamp.slice(0, 7),
      createdAt: timestamp
    });
    if (balanceSnapshot.exists()) {
      const balance = mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data());
      transaction.update(balanceRef, {
        availablePc: balance.availablePc + referralCoins,
        incomingPc: balance.incomingPc + referralCoins,
        lastMutationReferenceId: ledgerRef.id,
        updatedAt: timestamp
      });
    } else {
      transaction.set(balanceRef, {
        customerId: referrer.id,
        availablePc: referralCoins,
        incomingPc: referralCoins,
        redeemedPc: 0,
        protectedAt: '',
        lastMutationReferenceId: ledgerRef.id,
        updatedAt: timestamp
      });
    }
    awarded = true;
  });

  clearFirestoreSessionCache(BONUS_PC_REQUESTS);
  clearFirestoreSessionCache(LOYALTY_LEDGER);
  clearFirestoreSessionCache(PC_BALANCES);
  return { requestId, customer: referrer, referredCustomer, referralCoins, awarded };
};

export const generateBonusPcRequests = async (
  auditUser?: AuditUser,
  month = getCurrentMonthKey(),
  customerId?: string
) => {
  requireAdminAudit(auditUser);
  const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
    customerId ? getCustomerById(customerId).then((customer) => customer ? [customer] : []) : getCustomers({ limitCount: 5000 }),
    customerId ? getInvoicesByCustomerId(customerId) : getInvoices(),
    customerId ? getPaymentsByCustomerId(customerId) : getPayments(),
    getAppSettings()
  ]);
  const timestamp = nowIso();
  let createdCount = 0;

  await Promise.all(
    customerRows.map(async (customer) => {
      const customerInvoices = invoiceRows.filter((invoice) => invoice.customerId === customer.id);
      const customerPayments = paymentRows.filter((payment) => payment.customerId === customer.id);
      const candidates = buildAutomaticBonusCandidates(customer, customerInvoices, customerPayments, appSettings, month);

      await Promise.all(candidates.map(async (candidate) => {
        const requestRef = doc(db, BONUS_PC_REQUESTS, candidate.id);
        const existingSnapshot = candidate.bonusType === 'new_customer'
          ? (await getDocs(query(
              collection(db, BONUS_PC_REQUESTS),
              where('customerId', '==', customer.id),
              where('bonusType', '==', 'new_customer'),
              firestoreLimit(1)
            ))).docs[0]
          : await getDoc(requestRef);
        const amount = FIXED_BONUS_PC[candidate.bonusType];
        if (existingSnapshot?.exists()) {
          const existing = mapBonusPcRequestDoc(existingSnapshot.id, existingSnapshot.data());
          if (existing.status === 'Pending' && existing.triggerType !== candidate.triggerType) {
            await updateDoc(existingSnapshot.ref, {
              triggerType: candidate.triggerType,
              referenceId: candidate.referenceId,
              suggestedCoins: amount,
              approvedCoins: amount,
              notes: candidate.notes
            });
          }
          return;
        }

        await setDoc(requestRef, {
          customerId: customer.id,
          customerName: customer.name,
          bonusType: candidate.bonusType,
          bonusLabel: BONUS_PC_LABELS[candidate.bonusType],
          triggerType: candidate.triggerType,
          referenceId: candidate.referenceId,
          suggestedCoins: amount,
          approvedCoins: amount,
          status: 'Pending',
          generatedAt: timestamp,
          reviewedAt: '',
          reviewedBy: '',
          customerSeenAt: '',
          notes: candidate.notes
        });
        createdCount += 1;
      }));
    })
  );

  clearFirestoreSessionCache(BONUS_PC_REQUESTS);
  return { createdCount };
};

export const reviewBonusPcRequest = async (
  requestId: string,
  status: 'Approved' | 'Rejected',
  approvedCoins: number,
  auditUser?: AuditUser,
  notes = ''
) => {
  requireAdminAudit(auditUser);
  const requestRef = doc(db, BONUS_PC_REQUESTS, requestId);
  const timestamp = nowIso();

  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error('Bonus PC request no longer exists.');
    }

    const bonusRequest = mapBonusPcRequestDoc(requestSnapshot.id, requestSnapshot.data());

    if (bonusRequest.status !== 'Pending') {
      throw new Error('Only pending bonus PC requests can be reviewed.');
    }

    if (
      status === 'Approved'
      && bonusRequest.bonusType === 'monthly_target'
      && bonusRequest.triggerType !== 'monthly_target_paid'
    ) {
      throw new Error('The monthly target bonus cannot be released until the qualifying invoices are fully paid.');
    }

    const cleanCoins = status === 'Approved' ? FIXED_BONUS_PC[bonusRequest.bonusType] : 0;
    const balanceRef = doc(db, PC_BALANCES, bonusRequest.customerId);
    const ledgerRef = doc(db, LOYALTY_LEDGER, getBonusPcLedgerId(bonusRequest.customerId, requestId));
    const otherWelcomeRequestRefs = status === 'Approved' && bonusRequest.bonusType === 'new_customer'
      ? getNewCustomerBonusRequestIds(bonusRequest.customerId)
          .filter((candidateId) => candidateId !== requestId)
          .map((candidateId) => doc(db, BONUS_PC_REQUESTS, candidateId))
      : [];
    const welcomeLedgerRefs = status === 'Approved' && bonusRequest.bonusType === 'new_customer'
      ? getNewCustomerBonusRequestIds(bonusRequest.customerId)
          .map((candidateId) => doc(db, LOYALTY_LEDGER, getBonusPcLedgerId(bonusRequest.customerId, candidateId)))
      : [];
    const [balanceSnapshot, otherWelcomeRequestSnapshots, welcomeLedgerSnapshots] = await Promise.all([
      transaction.get(balanceRef),
      Promise.all(otherWelcomeRequestRefs.map((reference) => transaction.get(reference))),
      Promise.all(welcomeLedgerRefs.map((reference) => transaction.get(reference)))
    ]);

    if (status === 'Approved' && bonusRequest.bonusType === 'new_customer') {
      const alreadyApproved = otherWelcomeRequestSnapshots.some((snapshot) => (
        snapshot.exists()
        && mapBonusPcRequestDoc(snapshot.id, snapshot.data()).status === 'Approved'
      ));
      const alreadyCredited = welcomeLedgerSnapshots.some((snapshot) => snapshot.exists());
      if (alreadyApproved || alreadyCredited) {
        throw new Error('This customer has already received the new customer bonus.');
      }
    }

    transaction.update(requestRef, {
      bonusType: bonusRequest.bonusType,
      bonusLabel: BONUS_PC_LABELS[bonusRequest.bonusType],
      suggestedCoins: FIXED_BONUS_PC[bonusRequest.bonusType],
      status,
      approvedCoins: cleanCoins,
      reviewedAt: timestamp,
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes
    });

    if (status === 'Approved' && cleanCoins > 0) {
      transaction.set(ledgerRef, {
        customerId: bonusRequest.customerId,
        type: 'bonus',
        points: cleanCoins,
        reason: `${bonusRequest.bonusLabel}: ${bonusRequest.notes || 'Admin approved bonus'}`,
        referenceId: requestId,
        month: getMonthFromBonusRequest(bonusRequest),
        createdAt: timestamp
      });
      if (balanceSnapshot.exists()) {
        const balance = mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data());
        transaction.update(balanceRef, {
          availablePc: balance.availablePc + cleanCoins,
          incomingPc: balance.incomingPc + cleanCoins,
          lastMutationReferenceId: ledgerRef.id,
          updatedAt: timestamp
        });
      } else {
        transaction.set(balanceRef, {
          customerId: bonusRequest.customerId,
          availablePc: cleanCoins,
          incomingPc: cleanCoins,
          redeemedPc: 0,
          protectedAt: '',
          lastMutationReferenceId: ledgerRef.id,
          updatedAt: timestamp
        });
      }
    }
  });

  clearFirestoreSessionCache();
};

export const markBonusPcRequestSeen = async (requestId: string) => {
  if (!requestId) return;
  await updateDoc(doc(db, BONUS_PC_REQUESTS, requestId), {
    customerSeenAt: nowIso()
  });
  clearFirestoreSessionCache(BONUS_PC_REQUESTS);
};

export const getRewardItems = async () => {
  return getCached(cacheKey(REWARD_ITEMS, { order: 'requiredPoints', limitCount: ACTIVE_REWARD_LIMIT }), async () => {
    const rewardsQuery = query(collection(db, REWARD_ITEMS), orderBy('requiredPoints', 'asc'), firestoreLimit(ACTIVE_REWARD_LIMIT));
    const snapshot = await getDocs(rewardsQuery);
    return snapshot.docs.map((rewardDoc) => mapRewardItemDoc(rewardDoc.id, rewardDoc.data()));
  });
};

export const getActiveRewardItems = async () => {
  const rewards = await getCached(cacheKey(REWARD_ITEMS, { isActive: true }), async () => {
    const rewardsQuery = query(collection(db, REWARD_ITEMS), where('isActive', '==', true));
    const snapshot = await getDocs(rewardsQuery);
    return snapshot.docs.map((rewardDoc) => mapRewardItemDoc(rewardDoc.id, rewardDoc.data()));
  });

  return rewards
    .sort((left, right) => left.requiredPoints - right.requiredPoints)
    .slice(0, ACTIVE_REWARD_LIMIT);
};

export const getAvailableRewardsForCustomer = async (customerId: string, month = getCurrentMonthKey()) => {
  const [stats, rewards] = await Promise.all([
    getMonthlyCustomerStats(customerId, month),
    getDocs(query(collection(db, REWARD_ITEMS), where('isActive', '==', true)))
  ]);
  const activeRewards = rewards.docs.map((rewardDoc) => mapRewardItemDoc(rewardDoc.id, rewardDoc.data()));

  if (!stats) return { stats, rewards: [] };

  return {
    stats,
    rewards: activeRewards
      .filter((reward) => reward.requiredPoints <= stats.pointsEarned && canViewRewardAtLevel(stats.currentLevel, reward.levelRequired))
      .sort((left, right) => left.requiredPoints - right.requiredPoints)
      .slice(0, ACTIVE_REWARD_LIMIT)
  };
};

export const createRewardItem = async (reward: RewardFormData, auditUser?: AuditUser) => {
  const payload = sanitizeRewardPayload(reward);
  const timestamp = nowIso();
  const docRef = await addDoc(collection(db, REWARD_ITEMS), {
    ...payload,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  clearFirestoreSessionCache();
  return docRef;
};

export const updateRewardItemRecord = async (rewardId: string, reward: RewardFormData, auditUser?: AuditUser) => {
  const payload = sanitizeRewardPayload(reward);
  await updateDoc(doc(db, REWARD_ITEMS, rewardId), {
    ...payload,
    updatedAt: nowIso()
  });
  clearFirestoreSessionCache();
};

export const deleteRewardItemRecord = async (rewardId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, REWARD_ITEMS, rewardId));
  clearFirestoreSessionCache();
};

export const getRedemptionRequests = async (limitCount = DEFAULT_LIST_LIMIT) => {
  return getCached(cacheKey(REDEMPTION_REQUESTS, { order: 'requestedAt', limitCount }), async () => {
    const requestsQuery = query(collection(db, REDEMPTION_REQUESTS), orderBy('requestedAt', 'desc'), firestoreLimit(limitCount));
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs
      .map((requestDoc) => mapRedemptionRequestDoc(requestDoc.id, requestDoc.data()))
      .filter((request) => request.status !== 'Rejected');
  });
};

export const getRedemptionRequestsForCustomer = async (customerId: string, limitCount = 20) => {
  if (!customerId) return [];
  return getCached(cacheKey(REDEMPTION_REQUESTS, { customerId, limitCount }), async () => {
    const requestsQuery = query(collection(db, REDEMPTION_REQUESTS), where('customerId', '==', customerId), firestoreLimit(limitCount));
    const snapshot = await getDocs(requestsQuery);
    return snapshot.docs
      .map((requestDoc) => mapRedemptionRequestDoc(requestDoc.id, requestDoc.data()))
      .filter((request) => request.status !== 'Rejected')
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  });
};

export const createRedemptionRequest = async (customer: Customer, reward: RewardItem) => {
  const requestId = `${customer.id}_${reward.id}`;
  const requestRef = doc(db, REDEMPTION_REQUESTS, requestId);
  const timestamp = nowIso();

  await setDoc(requestRef, {
    customerId: customer.id,
    customerName: customer.name,
    rewardId: reward.id,
    rewardName: reward.name,
    points: reward.requiredPoints,
    status: 'Pending',
    requestedAt: timestamp
  });
  clearFirestoreSessionCache();
};

export const reviewRedemptionRequest = async (
  requestId: string,
  status: 'Approved' | 'Rejected',
  auditUser?: AuditUser,
  notes = ''
) => {
  requireAdminAudit(auditUser);
  const requestRef = doc(db, REDEMPTION_REQUESTS, requestId);
  const timestamp = nowIso();

  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error('Redemption request no longer exists.');
    }

    const redemption = mapRedemptionRequestDoc(requestSnapshot.id, requestSnapshot.data());

    if (redemption.status !== 'Pending') {
      throw new Error('Only pending redemption requests can be reviewed.');
    }

    if (status === 'Rejected') {
      transaction.delete(requestRef);
      return;
    }

    const balanceRef = doc(db, PC_BALANCES, redemption.customerId);
    const ledgerRef = doc(db, LOYALTY_LEDGER, `${redemption.customerId}_${requestId}_redemption`);
    const balanceSnapshot = await transaction.get(balanceRef);
    if (!balanceSnapshot.exists()) throw new Error('Protect this customer PC balance before approving a redemption.');
    if (redemption.points <= 0) throw new Error('Reward PC must be above 0.');
    const balance = mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data());
    if (redemption.points > balance.availablePc) throw new Error('Customer does not have enough available PC for this gift.');
    transaction.update(balanceRef, {
      availablePc: balance.availablePc - redemption.points,
      redeemedPc: balance.redeemedPc + redemption.points,
      lastMutationReferenceId: ledgerRef.id,
      updatedAt: timestamp
    });
    transaction.set(ledgerRef, {
      customerId: redemption.customerId,
      type: 'redemption',
      points: -Math.abs(redemption.points),
      reason: `Gift approved: ${redemption.rewardName}`,
      referenceId: requestId,
      month: timestamp.slice(0, 7),
      createdAt: timestamp
    });

    transaction.update(requestRef, {
      status,
      reviewedAt: timestamp,
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes
    });
  });

  clearFirestoreSessionCache();
};

export const removeRedemptionApproval = async (requestId: string, auditUser?: AuditUser) => {
  requireAdminAudit(auditUser);
  const requestRef = doc(db, REDEMPTION_REQUESTS, requestId);
  const timestamp = nowIso();

  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error('Redemption request no longer exists.');
    }

    const redemption = mapRedemptionRequestDoc(requestSnapshot.id, requestSnapshot.data());

    if (redemption.status !== 'Approved') {
      throw new Error('Only approved redemption requests can have approval removed.');
    }

    const ledgerRef = doc(db, LOYALTY_LEDGER, `${redemption.customerId}_${requestId}_redemption`);
    const reversalRef = doc(db, LOYALTY_LEDGER, `${redemption.customerId}_${requestId}_redemption_reversal`);
    const balanceRef = doc(db, PC_BALANCES, redemption.customerId);
    const [ledgerSnapshot, reversalSnapshot, balanceSnapshot] = await Promise.all([
      transaction.get(ledgerRef),
      transaction.get(reversalRef),
      transaction.get(balanceRef)
    ]);

    transaction.update(requestRef, {
      status: 'Pending',
      reviewedAt: '',
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes: 'Approval removed'
    });

    if (ledgerSnapshot.exists() && !reversalSnapshot.exists()) {
      if (!balanceSnapshot.exists()) throw new Error('The customer PC balance is missing and the redemption cannot be reversed.');
      transaction.set(reversalRef, {
        customerId: redemption.customerId,
        type: 'redemption_reversal',
        points: Math.abs(redemption.points),
        reason: `Gift approval removed: ${redemption.rewardName}`,
        referenceId: requestId,
        month: timestamp.slice(0, 7),
        createdAt: timestamp
      });
      const balance = mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data());
      if (redemption.points > balance.redeemedPc) {
        throw new Error('The redeemed PC history is inconsistent and cannot be reversed automatically.');
      }
      transaction.update(balanceRef, {
        availablePc: balance.availablePc + redemption.points,
        redeemedPc: balance.redeemedPc - redemption.points,
        lastMutationReferenceId: reversalRef.id,
        updatedAt: timestamp
      });
    }
  });

  clearFirestoreSessionCache();
};

export const markRedemptionRequestGifted = async (requestId: string, auditUser?: AuditUser) => {
  requireAdminAudit(auditUser);
  const requestRef = doc(db, REDEMPTION_REQUESTS, requestId);
  const timestamp = nowIso();
  const today = getTodayDateString();

  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error('Redemption request no longer exists.');
    }

    const redemption = mapRedemptionRequestDoc(requestSnapshot.id, requestSnapshot.data());

    if (redemption.status !== 'Approved') {
      throw new Error('Approve the redemption request before marking it gifted.');
    }

    const ledgerRef = doc(db, LOYALTY_LEDGER, `${redemption.customerId}_${requestId}_redemption`);
    const balanceRef = doc(db, PC_BALANCES, redemption.customerId);
    const [customerSnapshot, ledgerSnapshot, balanceSnapshot] = await Promise.all([
      redemption.customerId ? transaction.get(doc(db, CUSTOMERS, redemption.customerId)) : Promise.resolve(undefined),
      transaction.get(ledgerRef),
      transaction.get(balanceRef)
    ]);
    const customerTier = (customerSnapshot?.data()?.tier as CustomerTier | undefined) || 'Tier 4';
    const giftRef = doc(collection(db, GIFT_HISTORY));

    transaction.set(giftRef, {
      customerId: redemption.customerId,
      customerName: redemption.customerName,
      tier: customerTier,
      tierAtGiftTime: customerTier,
      periodType: 'custom',
      periodStart: '2000-01-01',
      periodEnd: today,
      salesAmount: 0,
      profitConsidered: 0,
      giftPercentage: 0,
      giftAmount: redemption.points,
      suggestedGiftBudget: redemption.points,
      actualGiftAmount: redemption.points,
      giftItem: redemption.rewardName,
      selectedGiftItemName: redemption.rewardName,
      suggestedGiftOptions: [redemption.rewardName],
      giftBudget: redemption.points,
      giftedDate: today,
      giftGivenDate: today,
      giftedBy: auditUser?.userEmail || auditUser?.userId || 'Admin',
      approvedBy: redemption.reviewedBy || auditUser?.userEmail || auditUser?.userId || 'Admin',
      status: 'Given',
      notes: 'Gifted from redemption request',
      createdAt: timestamp,
      updatedAt: timestamp
    });

    transaction.update(requestRef, {
      status: 'Gifted',
      reviewedAt: timestamp,
      reviewedBy: redemption.reviewedBy || auditUser?.userEmail || auditUser?.userId || '',
      notes: 'Gifted'
    });

    if (!ledgerSnapshot.exists()) {
      if (!balanceSnapshot.exists()) throw new Error('Protect this customer PC balance before redeeming a gift.');
      if (redemption.points <= 0) throw new Error('Reward PC must be above 0.');
      transaction.set(ledgerRef, {
        customerId: redemption.customerId,
        type: 'redemption',
        points: -Math.abs(redemption.points),
        reason: `Reward gifted: ${redemption.rewardName}`,
        referenceId: requestId,
        month: getCurrentMonthKey(),
        createdAt: timestamp
      });
      const balance = mapPcBalanceRecord(balanceSnapshot.id, balanceSnapshot.data());
      if (redemption.points > balance.availablePc) throw new Error('Customer does not have enough available PC for this gift.');
      transaction.update(balanceRef, {
        availablePc: balance.availablePc - redemption.points,
        redeemedPc: balance.redeemedPc + redemption.points,
        lastMutationReferenceId: ledgerRef.id,
        updatedAt: timestamp
      });
    }
  });

  clearFirestoreSessionCache();
};
