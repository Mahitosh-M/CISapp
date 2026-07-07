import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  QueryConstraint,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Customer,
  CustomerFormData,
  CustomerTier,
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
  MonthlyCustomerStats,
  LoyaltyLedgerEntry,
  OverduePcRequest,
  OverduePcRequestStatus,
  RewardFormData,
  RewardItem,
  RedemptionRequest,
  RedemptionStatus,
  UserProfile,
  UserRole
} from '../types';
import {
  DEFAULT_SETTINGS,
  calculateDynamicDueDate,
  getEffectiveInvoiceDueDate,
  getPaymentTermsLabel,
  mergeWithDefaultSettings,
  validateAppSettings
} from '../utils/settings';
import { isOfferCurrentlyActive, sortOffersByLatest } from '../utils/offers';
import { calculateInvoiceApcInfo, getInvoiceFullPaymentDate } from '../utils/customerPortal';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { buildMonthlyCustomerStats, canViewRewardAtLevel, getCurrentMonthKey, getMonthlyStatsId } from '../utils/loyalty';
import { getOpeningBalanceInvoiceId, getOpeningBalanceInvoiceNumber, isOpeningBalanceInvoice, OPENING_BALANCE_INVOICE_TYPE } from '../utils/openingBalance';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';

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
const REWARD_ITEMS = 'rewardItems';
const REDEMPTION_REQUESTS = 'redemptionRequests';
const OVERDUE_PC_REQUESTS = 'overduePcRequests';
const BONUS_PC_REQUESTS = 'bonusPcRequests';
const DEFAULT_LIST_LIMIT = 50;
const ACTIVE_OFFER_LIMIT = 20;
const ACTIVE_REWARD_LIMIT = 50;
const READ_CACHE_TTL_MS = 5 * 60 * 1000;

export interface AuditUser {
  userId?: string;
  userEmail?: string;
  role?: UserRole;
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

const nowIso = () => new Date().toISOString();

const getTodayDateString = () => nowIso().slice(0, 10);

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

const cacheKey = (collectionName: string, options?: unknown) => `${collectionName}:${JSON.stringify(options ?? {})}`;

const withoutUndefined = <T extends Record<string, unknown>>(payload: T) => {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)) as Partial<T>;
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
  const payload = {
    totalOutstandingAmount,
    invoiceOutstandingAmount: summary.invoiceOutstandingAmount,
    openingBalanceOutstandingAmount: summary.openingBalanceOutstandingAmount,
    financialSummaryUpdatedAt: nowIso(),
    previousOutstandingAmount: 0
  };

  await updateDoc(doc(db, CUSTOMERS, customerId), payload);

  return payload;
}

let appSettingsCache: AppSettings | undefined;

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getPaymentTermsForTier = (tier: CustomerTier) => {
  return getPaymentTermsLabel(tier);
};

export const getCreditDaysForTier = (tier: CustomerTier) => {
  return DEFAULT_SETTINGS.creditDays[tier] + DEFAULT_SETTINGS.paymentBuffers[tier];
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
    tier,
    // Old balance from before this ERP started. Missing legacy documents safely read as zero.
    previousOutstandingAmount: Math.max(0, numberOrZero(data.previousOutstandingAmount)),
    totalOutstandingAmount: data.totalOutstandingAmount === undefined ? undefined : numberOrZero(data.totalOutstandingAmount),
    invoiceOutstandingAmount: data.invoiceOutstandingAmount === undefined ? undefined : numberOrZero(data.invoiceOutstandingAmount),
    openingBalanceOutstandingAmount: data.openingBalanceOutstandingAmount === undefined ? undefined : numberOrZero(data.openingBalanceOutstandingAmount),
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
    isOpeningBalance: data.isOpeningBalance === true,
    date: String(data.date || data.invoiceDate || ''),
    dueDate: String(data.dueDate || ''),
    salesAmount,
    costAmount,
    transportAmount,
    totalSales: numberOrZero(data.totalSales ?? salesAmount),
    totalCost,
    totalProfit,
    notes: String(data.notes || ''),
    createdAt: String(data.createdAt || ''),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
  };
};

const mapPaymentDoc = (id: string, data: Record<string, unknown>): Payment => {
  const amount = numberOrZero(data.amount ?? data.amountReceived);

  return {
    id,
    invoiceId: String(data.invoiceId || ''),
    invoiceNumber: String(data.invoiceNumber || ''),
    customerId: String(data.customerId || ''),
    customerName: String(data.customerName || ''),
    date: String(data.date || data.paymentDate || ''),
    amount,
    amountAppliedToInvoice: data.amountAppliedToInvoice === undefined ? amount : numberOrZero(data.amountAppliedToInvoice),
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
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
  };
};

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
    loyaltySettings: data.loyaltySettings as AppSettings['loyaltySettings'],
    targetSettings: data.targetSettings as AppSettings['targetSettings'],
    showCustomerTierToCustomer: data.showCustomerTierToCustomer === true,
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
  new_customer: 'New customer bonus',
  payment: 'Payment bonus',
  purchase_target: 'Purchase target bonus',
  referral: 'Referral bonus'
};

const isBonusPcType = (value: unknown): value is BonusPcType => (
  value === 'new_customer' || value === 'payment' || value === 'purchase_target' || value === 'referral'
);

const mapBonusPcRequestDoc = (id: string, data: Record<string, unknown>): BonusPcRequest => {
  const bonusType = isBonusPcType(data.bonusType) ? data.bonusType : 'new_customer';

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

const getBonusRequestId = (customerId: string, bonusType: 'payment' | 'purchase_target', month: string) => {
  const suffix = bonusType === 'payment' ? 'payment' : 'target';
  return `${customerId}_${suffix}_${month.replace('-', '_')}`;
};

const getMonthFromBonusRequest = (request: BonusPcRequest) => {
  const match = request.id.match(/_(payment|target)_(\d{4})_(\d{2})$/);
  if (match) {
    return `${match[2]}-${match[3]}`;
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

export const mapUserProfileDoc = (id: string, data: Record<string, unknown>): UserProfile => ({
  id,
  uid: String(data.uid || ''),
  email: String(data.email || ''),
  name: String(data.name || data.customerName || data.email || ''),
  role: data.role === 'Admin' ? 'Admin' : data.role === 'customer' ? 'customer' : 'Staff',
  customerId: data.customerId ? String(data.customerId) : undefined,
  customerName: data.customerName ? String(data.customerName) : undefined,
  active: data.active !== false,
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

export const getCustomers = async () => {
  return getCached(cacheKey(CUSTOMERS), async () => {
    const customersQuery = query(collection(db, CUSTOMERS), orderBy('name', 'asc'));
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

export const syncOpeningBalanceInvoices = async (customers: Customer[], invoices: Invoice[]) => {
  const existingOpeningCustomerIds = new Set(invoices.filter(isOpeningBalanceInvoice).map((invoice) => invoice.customerId));
  const customersToConvert = customers.filter((customer) => (customer.previousOutstandingAmount ?? 0) > 0 && !existingOpeningCustomerIds.has(customer.id));

  if (customersToConvert.length === 0) {
    return { convertedCustomerIds: [] as string[], createdInvoices: [] as Invoice[] };
  }

  const batch = writeBatch(db);
  const timestamp = nowIso();
  const createdInvoices: Invoice[] = [];

  customersToConvert.forEach((customer) => {
    const invoiceRef = doc(db, INVOICES, getOpeningBalanceInvoiceId(customer.id));
    const createdAt = customer.createdAt || timestamp;
    const payload = buildOpeningBalanceInvoicePayload(customer.id, customer, customer.previousOutstandingAmount, createdAt);

    batch.set(invoiceRef, payload);
    batch.update(doc(db, CUSTOMERS, customer.id), {
      previousOutstandingAmount: 0,
      totalOutstandingAmount: customer.previousOutstandingAmount,
      invoiceOutstandingAmount: 0,
      openingBalanceOutstandingAmount: customer.previousOutstandingAmount,
      financialSummaryUpdatedAt: timestamp,
      updatedAt: timestamp
    });
    createdInvoices.push({ id: invoiceRef.id, ...payload });
  });

  await batch.commit();
  await Promise.all(customersToConvert.map((customer) => syncCustomerFinancialSummary(customer.id)));

  return {
    convertedCustomerIds: customersToConvert.map((customer) => customer.id),
    createdInvoices
  };
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
  await deleteDoc(doc(db, CUSTOMERS, customerId));
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
  const invoicesQuery = query(collection(db, INVOICES), where('customerId', '==', customerId));
  const snapshot = await getDocs(invoicesQuery);
  const rows = snapshot.docs
    .map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()))
    .filter((invoice) => !options?.fromDate || invoice.date >= options.fromDate)
    .filter((invoice) => !options?.toDate || invoice.date <= options.toDate)
    .sort((left, right) =>
      options?.sortBy === 'invoiceNumber'
        ? right.invoiceNumber.localeCompare(left.invoiceNumber, undefined, { numeric: true })
        : right.date.localeCompare(left.date)
    );

  return options?.limitCount && options.limitCount > 0 ? rows.slice(0, options.limitCount) : rows;
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

export const getNextInvoiceNumber = async (settings?: AppSettings) => {
  const activeSettings = mergeWithDefaultSettings(settings ?? (await getAppSettings()));
  const prefix = activeSettings.invoicePrefix || 'INV';
  const financialYear = getFinancialYearRange();
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

  return `${prefix}-${String(highestNumber + 1).padStart(4, '0')}`;
};

export const createInvoice = async (invoice: InvoiceFormData, auditUser?: AuditUser) => {
  const invoiceNumber = await getNextInvoiceNumber();

  const docRef = await addDoc(collection(db, INVOICES), {
    ...invoice,
    invoiceNumber,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await syncCustomerFinancialSummary(invoice.customerId);
  clearFirestoreSessionCache();
  return { id: docRef.id, invoiceNumber, ref: docRef };
};

export const updateInvoiceRecord = async (invoiceId: string, invoice: InvoiceFormData, auditUser?: AuditUser) => {
  const existingInvoiceSnapshot = await getDoc(doc(db, INVOICES, invoiceId));
  const existingInvoice = existingInvoiceSnapshot.exists() ? mapInvoiceDoc(existingInvoiceSnapshot.id, existingInvoiceSnapshot.data()) : undefined;

  await updateDoc(doc(db, INVOICES, invoiceId), {
    ...invoice,
    updatedAt: nowIso()
  });

  const affectedCustomerIds = [existingInvoice?.customerId, invoice.customerId].filter((customerId): customerId is string => Boolean(customerId));
  await Promise.all([...new Set(affectedCustomerIds)].map((customerId) => syncCustomerFinancialSummary(customerId)));
  clearFirestoreSessionCache();
};

export const deleteInvoiceRecord = async (invoiceId: string, auditUser?: AuditUser) => {
  const invoiceRef = doc(db, INVOICES, invoiceId);
  const linkedPaymentsSnapshot = await getDocs(query(collection(db, PAYMENTS), where('invoiceId', '==', invoiceId)));
  const linkedPaymentRefs = linkedPaymentsSnapshot.docs.map((paymentDoc) => paymentDoc.ref);
  let deletedPaymentCount = 0;
  let affectedCustomerId = '';

  if (linkedPaymentRefs.length >= 450) {
    throw new Error('This invoice has too many linked payments to delete safely in one operation.');
  }

  await runTransaction(db, async (transaction) => {
    const invoiceSnapshot = await transaction.get(invoiceRef);

    if (!invoiceSnapshot.exists()) {
      throw new Error('Invoice record no longer exists. Refresh the list and try again.');
    }

    affectedCustomerId = mapInvoiceDoc(invoiceSnapshot.id, invoiceSnapshot.data()).customerId;

    const paymentSnapshots = await Promise.all(linkedPaymentRefs.map((paymentRef) => transaction.get(paymentRef)));
    const paymentsToDelete = paymentSnapshots
      .filter((paymentSnapshot) => paymentSnapshot.exists())
      .map((paymentSnapshot) => mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data()));
    const oldBalanceRestoreByCustomerId = paymentsToDelete.reduce((restoreMap, payment) => {
      const amountToRestore = Math.max(0, payment.amountUsedForOldBalance ?? 0);

      if (amountToRestore > 0 && payment.customerId) {
        restoreMap.set(payment.customerId, (restoreMap.get(payment.customerId) ?? 0) + amountToRestore);
      }

      return restoreMap;
    }, new Map<string, number>());
    const customerRefsById = new Map([...oldBalanceRestoreByCustomerId.keys()].map((customerId) => [customerId, doc(db, CUSTOMERS, customerId)]));
    const customerSnapshotsById = new Map(
      await Promise.all(
        [...customerRefsById.entries()].map(async ([customerId, customerRef]) => [customerId, await transaction.get(customerRef)] as const)
      )
    );
    const timestamp = nowIso();

    customerSnapshotsById.forEach((customerSnapshot, customerId) => {
      const amountToRestore = oldBalanceRestoreByCustomerId.get(customerId) ?? 0;
      const customerRef = customerRefsById.get(customerId);

      if (customerRef && customerSnapshot.exists() && amountToRestore > 0) {
        transaction.update(customerRef, {
          previousOutstandingAmount: Math.max(0, numberOrZero(customerSnapshot.data().previousOutstandingAmount) + amountToRestore),
          updatedAt: timestamp
        });
      }
    });

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

  await syncCustomerFinancialSummary(affectedCustomerId);
  clearFirestoreSessionCache();
  return { deletedPaymentCount };
};

export const getPayments = async (options?: DateRangeQueryOptions) => {
  return getCached(cacheKey(PAYMENTS, options), async () => {
    const paymentsQuery = query(collection(db, PAYMENTS), ...buildPaymentQueryConstraints(options));
    const snapshot = await getDocs(paymentsQuery);
    return snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
  });
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
  const paymentsQuery = query(collection(db, PAYMENTS), where('customerId', '==', customerId));
  const snapshot = await getDocs(paymentsQuery);
  const rows = snapshot.docs
    .map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()))
    .filter((payment) => !options?.fromDate || payment.date >= options.fromDate)
    .filter((payment) => !options?.toDate || payment.date <= options.toDate)
    .sort((left, right) => (right.createdAt || right.date).localeCompare(left.createdAt || left.date));

  return options?.limitCount && options.limitCount > 0 ? rows.slice(0, options.limitCount) : rows;
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

const sanitizePaymentPayload = (payment: PaymentFormData): PaymentFormData => ({
  ...payment,
  amount: Math.max(0, numberOrZero(payment.amount)),
  cashDiscount: Math.max(0, numberOrZero(payment.cashDiscount))
});

const buildAllocatedPaymentPayload = (payment: PaymentFormData, previousOutstandingAmount: number) => {
  const cleanPayment = sanitizePaymentPayload(payment);
  const oldBalanceBeforePayment = Math.max(0, numberOrZero(previousOutstandingAmount));
  const amountUsedForOldBalance = 0;
  const amountAppliedToInvoice = cleanPayment.amount;
  const oldBalanceAfterPayment = oldBalanceBeforePayment;

  return {
    payload: {
      ...cleanPayment,
      // Payments entered against an invoice reduce that selected invoice directly.
      // Legacy old-balance allocations are still preserved on older payment documents.
      amountAppliedToInvoice,
      amountUsedForOldBalance,
      oldBalanceBeforePayment,
      oldBalanceAfterPayment
    },
    oldBalanceAfterPayment
  };
};

export const createPayment = async (payment: PaymentFormData, auditUser?: AuditUser) => {
  const paymentRef = doc(collection(db, PAYMENTS));
  const timestamp = nowIso();
  let allocatedPayment = buildAllocatedPaymentPayload(payment, 0).payload;

  await runTransaction(db, async (transaction) => {
    const customerRef = doc(db, CUSTOMERS, payment.customerId);
    const customerSnapshot = await transaction.get(customerRef);
    const previousOutstandingAmount = customerSnapshot.exists() ? numberOrZero(customerSnapshot.data().previousOutstandingAmount) : 0;
    const allocation = buildAllocatedPaymentPayload(payment, previousOutstandingAmount);

    allocatedPayment = allocation.payload;

    transaction.set(paymentRef, {
      ...allocatedPayment,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  });

  await syncCustomerFinancialSummary(payment.customerId);
  clearFirestoreSessionCache();
  return paymentRef;
};

export const updatePaymentRecord = async (paymentId: string, payment: PaymentFormData, auditUser?: AuditUser) => {
  const paymentRef = doc(db, PAYMENTS, paymentId);
  const timestamp = nowIso();
  let allocatedPayment = buildAllocatedPaymentPayload(payment, 0).payload;
  let affectedCustomerIds: string[] = [payment.customerId];

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);
    const existingPayment = paymentSnapshot.exists() ? mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data()) : undefined;
    const oldCustomerId = existingPayment?.customerId || payment.customerId;
    affectedCustomerIds = [...new Set([oldCustomerId, payment.customerId].filter(Boolean))];
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
    const allocation = buildAllocatedPaymentPayload(payment, newCustomerOldBalanceBeforePayment);

    allocatedPayment = allocation.payload;

    if (oldCustomerRef && oldCustomerSnapshot?.exists() && oldCustomerId !== payment.customerId && (existingPayment?.amountUsedForOldBalance ?? 0) > 0) {
      transaction.update(oldCustomerRef, {
        previousOutstandingAmount: oldBalanceRestored,
        updatedAt: timestamp
      });
    }

    if (newCustomerSnapshot?.exists()) {
      transaction.update(newCustomerRef, {
        previousOutstandingAmount: allocation.oldBalanceAfterPayment,
        updatedAt: timestamp
      });
    }

    transaction.update(paymentRef, {
      ...allocatedPayment,
      updatedAt: timestamp
    });
  });

  await Promise.all(affectedCustomerIds.map((customerId) => syncCustomerFinancialSummary(customerId)));
  clearFirestoreSessionCache();
};

export const deletePaymentRecord = async (paymentId: string, auditUser?: AuditUser) => {
  const paymentRef = doc(db, PAYMENTS, paymentId);
  let deletedPayment: Payment | undefined;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);

    if (!paymentSnapshot.exists()) {
      throw new Error('Payment record no longer exists. Refresh the list and try again.');
    }

    deletedPayment = mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data());
    const oldBalanceAllocation = deletedPayment.amountUsedForOldBalance ?? 0;

    if (oldBalanceAllocation > 0) {
      const customerRef = doc(db, CUSTOMERS, deletedPayment.customerId);
      const customerSnapshot = await transaction.get(customerRef);

      if (customerSnapshot.exists()) {
        // Deleting a payment reverses the old-balance clearing that payment originally performed.
        transaction.update(customerRef, {
          previousOutstandingAmount: Math.max(0, numberOrZero(customerSnapshot.data().previousOutstandingAmount) + oldBalanceAllocation),
          updatedAt: nowIso()
        });
      }
    }

    transaction.delete(paymentRef);
  });

  const deletedPaymentSnapshot = await getDoc(paymentRef);

  if (deletedPaymentSnapshot.exists()) {
    throw new Error('Payment delete did not complete. Refresh the list and try again.');
  }

  await syncCustomerFinancialSummary(deletedPayment?.customerId ?? '');
  clearFirestoreSessionCache();
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

export const getUserProfileByEmail = async (email: string) => {
  const userQuery = query(collection(db, USERS), where('email', '==', email));
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

export const updateUserProfileRecord = async (profileId: string, profile: Partial<UserProfile>, auditUser?: AuditUser) => {
  await updateDoc(doc(db, USERS, profileId), {
    ...withoutUndefined(profile),
    updatedAt: nowIso()
  });

};

export const deleteUserProfileRecord = async (profileId: string, auditUser?: AuditUser) => {
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
      const existingStatsSnapshot = await getDoc(statsRef);
      const existingStats = existingStatsSnapshot.exists() ? mapMonthlyCustomerStatsDoc(existingStatsSnapshot.id, existingStatsSnapshot.data()) : undefined;
      const approvedRedemptions = existingStats ? Math.max(0, stats.pointsEarned - existingStats.pointsEarned) : 0;
      const adjustedPoints = Math.max(0, stats.pointsEarned - approvedRedemptions);

      await setDoc(statsRef, {
        ...stats,
        pointsEarned: adjustedPoints,
        updatedAt: timestamp
      }, { merge: true });

      if (stats.pointsEarned > 0) {
        const ledgerId = `${stats.customerId}_${month.replace('-', '_')}_monthly_points`;
        const ledgerEntry: Omit<LoyaltyLedgerEntry, 'id'> = {
          customerId: stats.customerId,
          type: 'purchase',
          points: stats.pointsEarned,
          reason: 'Monthly PC points',
          referenceId: stats.id,
          month,
          createdAt: timestamp
        };

        await setDoc(doc(db, LOYALTY_LEDGER, ledgerId), ledgerEntry, { merge: false });
      }
    })
  );

  clearFirestoreSessionCache();
  return statsRows;
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
  const fromDate = options?.fromDate || getPastDateString(180);
  const toDate = options?.toDate || getTodayDateString();
  const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
    getCustomers(),
    getInvoices({ fromDate, toDate }),
    getPayments({ fromDate, toDate }),
    getAppSettings()
  ]);
  const customersById = new Map(customerRows.map((customer) => [customer.id, customer]));
  const timestamp = nowIso();
  let createdCount = 0;

  await Promise.all(
    invoiceRows.map(async (invoice) => {
      const customer = customersById.get(invoice.customerId);
      if (!customer) return;

      const fullPaymentDate = getInvoiceFullPaymentDate(invoice, paymentRows);
      const pcInfo = calculateInvoiceApcInfo(invoice, paymentRows, customer.tier, appSettings);

      if (!fullPaymentDate || !pcInfo.apcDeadline || fullPaymentDate <= pcInfo.apcDeadline || pcInfo.expectedApc <= 0) {
        return;
      }

      const requestRef = doc(db, OVERDUE_PC_REQUESTS, invoice.id);
      const existingSnapshot = await getDoc(requestRef);
      if (existingSnapshot.exists()) return;

      await setDoc(requestRef, {
        customerId: customer.id,
        customerName: customer.name,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.date,
        dueDate: pcInfo.apcDeadline,
        fullPaymentDate,
        overdueDays: daysBetweenDateStrings(pcInfo.apcDeadline, fullPaymentDate),
        invoiceAmount: invoice.totalSales || invoice.salesAmount,
        suggestedCoins: Math.max(0, Math.round(pcInfo.expectedApc)),
        approvedCoins: Math.max(0, Math.round(pcInfo.expectedApc)),
        status: 'Pending',
        generatedAt: timestamp,
        reviewedAt: '',
        reviewedBy: '',
        notes: auditUser?.userEmail ? `Generated by ${auditUser.userEmail}` : 'Generated by Admin'
      });
      createdCount += 1;
    })
  );

  clearFirestoreSessionCache();
  return { createdCount };
};

export const reviewOverduePcRequest = async (
  requestId: string,
  status: 'Approved' | 'Rejected',
  approvedCoins: number,
  auditUser?: AuditUser,
  notes = ''
) => {
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

    const cleanCoins = Math.max(0, Math.round(numberOrZero(approvedCoins)));

    transaction.update(requestRef, {
      status,
      approvedCoins: status === 'Approved' ? cleanCoins : 0,
      reviewedAt: timestamp,
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes
    });

    if (status === 'Approved' && cleanCoins > 0) {
      transaction.set(doc(db, LOYALTY_LEDGER, `${pcRequest.customerId}_${requestId}_overdue_pc`), {
        customerId: pcRequest.customerId,
        type: 'overdue_payment',
        points: cleanCoins,
        reason: `Admin approved overdue invoice PC: ${pcRequest.invoiceNumber}`,
        referenceId: requestId,
        month: (pcRequest.fullPaymentDate || getTodayDateString()).slice(0, 7),
        createdAt: timestamp
      });
    }
  });

  clearFirestoreSessionCache();
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

export const generateBonusPcRequests = async (auditUser?: AuditUser, month = getCurrentMonthKey()) => {
  const monthRange = getMonthDateRange(month);
  const recentFromDate = getPastDateString(180);
  const [customerRows, invoiceRows, paymentRows, monthlyInvoiceRows, monthlyPaymentRows, statsRows, appSettings] = await Promise.all([
    getCustomers(),
    getInvoices({ fromDate: recentFromDate, toDate: monthRange.toDate }),
    getPayments({ fromDate: recentFromDate, toDate: monthRange.toDate }),
    getInvoices({ fromDate: monthRange.fromDate, toDate: monthRange.toDate }),
    getPayments({ fromDate: monthRange.fromDate, toDate: monthRange.toDate }),
    getMonthlyCustomerStatsForMonth(month, 500),
    getAppSettings()
  ]);
  const newCustomerAmount = Math.max(0, Math.round(numberOrZero(appSettings.loyaltySettings.newCustomerBonus)));
  const paymentBonusAmount = Math.max(0, Math.round(numberOrZero(appSettings.loyaltySettings.paymentBonus)));
  const targetBonusAmount = Math.max(0, Math.round(numberOrZero(appSettings.loyaltySettings.purchaseTargetBonus)));
  const paymentScoreThreshold = 85;
  const statsByCustomerId = new Map(statsRows.map((stats) => [stats.customerId, stats]));
  const timestamp = nowIso();
  let createdCount = 0;

  if (newCustomerAmount <= 0 && paymentBonusAmount <= 0 && targetBonusAmount <= 0) {
    return { createdCount };
  }

  const createBonusRequestIfMissing = async (
    requestId: string,
    customer: Customer,
    bonusType: Exclude<BonusPcType, 'referral'>,
    triggerType: string,
    referenceId: string,
    amount: number,
    notes: string
  ) => {
    if (amount <= 0) return;

    const requestRef = doc(db, BONUS_PC_REQUESTS, requestId);
    const existingSnapshot = await getDoc(requestRef);
    if (existingSnapshot.exists()) return;

    await setDoc(requestRef, {
      customerId: customer.id,
      customerName: customer.name,
      bonusType,
      bonusLabel: BONUS_PC_LABELS[bonusType],
      triggerType,
      referenceId,
      suggestedCoins: amount,
      approvedCoins: amount,
      status: 'Pending',
      generatedAt: timestamp,
      reviewedAt: '',
      reviewedBy: '',
      customerSeenAt: '',
      notes
    });
    createdCount += 1;
  };

  await Promise.all(
    customerRows.map(async (customer) => {
      const customerInvoices = invoiceRows
        .filter((invoice) => invoice.customerId === customer.id)
        .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
      const firstInvoice = customerInvoices[0];

      if (firstInvoice && newCustomerAmount > 0) {
        await createBonusRequestIfMissing(
          `${customer.id}_new_customer`,
          customer,
          'new_customer',
          'first_invoice',
          firstInvoice.id,
          newCustomerAmount,
          `First invoice ${firstInvoice.invoiceNumber || firstInvoice.id}`
        );
      }

      const monthlyInvoices = monthlyInvoiceRows.filter((invoice) => invoice.customerId === customer.id);
      const monthlyPayments = monthlyPaymentRows.filter((payment) => payment.customerId === customer.id);
      const stats = statsByCustomerId.get(customer.id);
      const hasMonthlyActivity = monthlyInvoices.length > 0 || monthlyPayments.length > 0;

      if (!hasMonthlyActivity || hasUnpaidOverdueInvoice(customer, invoiceRows, paymentRows, appSettings)) {
        return;
      }

      const basePcEarned = stats?.basePcEarned ?? getBasePcEarnedForMonth(customer, monthlyInvoices, paymentRows, appSettings);
      if (basePcEarned <= 0) return;

      let plannedMonthlyBonus = 0;
      const dueInvoicesPaidOnTime = allDueInvoicesPaidOnTime(customer, invoiceRows, paymentRows, appSettings, month);
      const paymentScore = stats?.paymentScore && stats.paymentScore > 0
        ? stats.paymentScore
        : getPaymentScoreForInvoices(
            customer,
            invoiceRows.filter((invoice) => {
              const dueDate = getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, customer.tier, appSettings);
              return invoice.customerId === customer.id && dueDate.startsWith(`${month}-`);
            }),
            paymentRows,
            appSettings
          );

      if (paymentBonusAmount > 0 && dueInvoicesPaidOnTime && paymentScore >= paymentScoreThreshold) {
        const paymentRequestAmount = getCappedBonusAmount(paymentBonusAmount, basePcEarned, plannedMonthlyBonus);
        plannedMonthlyBonus += paymentRequestAmount;
        await createBonusRequestIfMissing(
          getBonusRequestId(customer.id, 'payment', month),
          customer,
          'payment',
          'monthly_payment_discipline',
          stats?.id || getMonthlyStatsId(customer.id, month),
          paymentRequestAmount,
          `Payment discipline bonus for ${month}: no overdue and payment score above threshold.`
        );
      }

      const totalSales = stats?.totalSales ?? monthlyInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalSales), 0);
      const totalProfit = stats?.totalProfit ?? monthlyInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalProfit), 0);
      const orderCount = stats?.orderCount ?? monthlyInvoices.length;
      const salesTarget = stats?.salesTarget ?? stats?.target ?? 0;
      const frequencyTarget = stats?.frequencyTarget ?? 0;
      const salesTargetAchieved = salesTarget > 0 && totalSales >= salesTarget;
      const frequencyTargetAchieved = frequencyTarget > 0 && orderCount >= frequencyTarget;

      if (targetBonusAmount > 0 && salesTargetAchieved && frequencyTargetAchieved && totalProfit > 0) {
        const targetRequestAmount = getCappedBonusAmount(targetBonusAmount, basePcEarned, plannedMonthlyBonus);
        plannedMonthlyBonus += targetRequestAmount;
        await createBonusRequestIfMissing(
          getBonusRequestId(customer.id, 'purchase_target', month),
          customer,
          'purchase_target',
          'monthly_purchase_target',
          stats?.id || getMonthlyStatsId(customer.id, month),
          targetRequestAmount,
          `Purchase target bonus for ${month}: sales target and order frequency achieved.`
        );
      }
    })
  );

  clearFirestoreSessionCache();
  return { createdCount };
};

export const reviewBonusPcRequest = async (
  requestId: string,
  status: 'Approved' | 'Rejected',
  approvedCoins: number,
  auditUser?: AuditUser,
  notes = ''
) => {
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

    const cleanCoins = Math.max(0, Math.round(numberOrZero(approvedCoins)));

    transaction.update(requestRef, {
      status,
      approvedCoins: status === 'Approved' ? cleanCoins : 0,
      reviewedAt: timestamp,
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes
    });

    if (status === 'Approved' && cleanCoins > 0) {
      transaction.set(doc(db, LOYALTY_LEDGER, `${bonusRequest.customerId}_${requestId}_bonus_pc`), {
        customerId: bonusRequest.customerId,
        type: 'bonus',
        points: cleanCoins,
        reason: `${bonusRequest.bonusLabel}: ${bonusRequest.notes || 'Admin approved bonus'}`,
        referenceId: requestId,
        month: getMonthFromBonusRequest(bonusRequest),
        createdAt: timestamp
      });
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
  const requestRef = doc(db, REDEMPTION_REQUESTS, requestId);

  await runTransaction(db, async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);

    if (!requestSnapshot.exists()) {
      throw new Error('Redemption request no longer exists.');
    }

    const redemption = mapRedemptionRequestDoc(requestSnapshot.id, requestSnapshot.data());

    if (redemption.status !== 'Approved') {
      throw new Error('Only approved redemption requests can have approval removed.');
    }

    transaction.update(requestRef, {
      status: 'Pending',
      reviewedAt: '',
      reviewedBy: auditUser?.userEmail || auditUser?.userId || '',
      notes: 'Approval removed'
    });

    transaction.delete(doc(db, LOYALTY_LEDGER, `${redemption.customerId}_${requestId}_redemption`));
  });

  clearFirestoreSessionCache();
};

export const markRedemptionRequestGifted = async (requestId: string, auditUser?: AuditUser) => {
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

    const customerSnapshot = redemption.customerId ? await transaction.get(doc(db, CUSTOMERS, redemption.customerId)) : undefined;
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

    transaction.set(doc(db, LOYALTY_LEDGER, `${redemption.customerId}_${requestId}_redemption`), {
      customerId: redemption.customerId,
      type: 'redemption',
      points: -Math.abs(redemption.points),
      reason: `Reward gifted: ${redemption.rewardName}`,
      referenceId: requestId,
      month: getCurrentMonthKey(),
      createdAt: timestamp
    });
  });

  clearFirestoreSessionCache();
};
