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
  setDoc,
  startAfter,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AppSettings,
  CreditLimitApprovalStatus,
  CreditStatus,
  Customer,
  CustomerCreditProfile,
  CustomerCreditSummary,
  CustomerTier,
  Invoice,
  Payment
} from '../types';
import { calculateCustomerCredit } from '../utils/creditCalculation';
import type { CreditCalculationInput, CreditCalculationResult, CreditDocumentData } from '../utils/creditCalculation';
import {
  getAppSettings,
  getCustomerById,
  getCustomers,
  getInvoicesByCustomerId,
  getPaymentsByCustomerId,
  updateAppSettings
} from './firestoreService';

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
    manualHold: data.manualHold === true,
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

export const getCustomerCreditSummary = async (customerId: string) => {
  if (!customerId) return undefined;
  const snapshot = await getDoc(doc(db, SUMMARY_COLLECTION, customerId));
  if (!snapshot.exists()) return undefined;
  const data = snapshot.data();
  return {
    id: snapshot.id,
    customerId: String(data.customerId || snapshot.id),
    approvedCreditLimit: data.approvedCreditLimit === undefined ? undefined : numberOrZero(data.approvedCreditLimit),
    availableCredit: numberOrZero(data.availableCredit),
    usedCredit: numberOrZero(data.usedCredit),
    creditDays: numberOrZero(data.creditDays),
    nextInvoiceDueDate: data.nextInvoiceDueDate ? String(data.nextInvoiceDueDate) : undefined,
    nextInvoiceDueAmount: data.nextInvoiceDueAmount === null || data.nextInvoiceDueAmount === undefined ? undefined : numberOrZero(data.nextInvoiceDueAmount),
    creditStatus: mapCreditStatus(data.creditStatus),
    manualHold: data.manualHold === true,
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

const requiredText = (value: unknown, label: string, maxLength = 500) => {
  const clean = String(value || '').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > maxLength) throw new Error(`${label} is too long.`);
  return clean;
};

export const autoApproveCalculatedProfiles = async (profiles: CustomerCreditProfile[]) => {
  const today = new Date().toISOString().slice(0, 10);
  const pending = profiles.filter((profile) => {
    const hasActiveOverride = Boolean(profile.creditOverride && profile.creditOverride.expiresAt >= today);
    return !hasActiveOverride && (
      profile.creditLimitApprovalStatus !== 'approved'
      || Math.abs(profile.approvedCreditLimit - profile.calculatedCreditLimit) > 0.01
    );
  });

  for (let index = 0; index < pending.length; index += 200) {
    const batch = writeBatch(db);
    const updatedAt = new Date().toISOString();
    pending.slice(index, index + 200).forEach((profile) => {
      const approvedCreditLimit = profile.calculatedCreditLimit;
      const usedCredit = profile.currentOutstanding + profile.confirmedUninvoicedCreditOrders;
      const availableCredit = profile.creditStatus === 'hold' || profile.creditStatus === 'disabled'
        ? 0
        : Math.max(0, approvedCreditLimit - usedCredit);
      batch.update(doc(db, PROFILE_COLLECTION, profile.id), {
        approvedCreditLimit,
        availableCredit,
        creditLimitApprovalStatus: 'approved',
        updatedAt
      });
      batch.set(doc(db, SUMMARY_COLLECTION, profile.id), {
        customerId: profile.customerId,
        approvedCreditLimit,
        availableCredit,
        usedCredit,
        creditDays: profile.creditDays,
        nextInvoiceDueDate: profile.nextInvoiceDueDate ?? null,
        nextInvoiceDueAmount: profile.nextInvoiceDueAmount ?? null,
        creditStatus: profile.creditStatus,
        manualHold: profile.manualHold === true,
        updatedAt
      });
    });
    await batch.commit();
  }

  const pendingIds = new Set(pending.map((profile) => profile.id));
  return profiles.map((profile) => {
    if (!pendingIds.has(profile.id)) return profile;
    const approvedCreditLimit = profile.calculatedCreditLimit;
    const usedCredit = profile.currentOutstanding + profile.confirmedUninvoicedCreditOrders;
    return {
      ...profile,
      approvedCreditLimit,
      availableCredit: profile.creditStatus === 'hold' || profile.creditStatus === 'disabled'
        ? 0
        : Math.max(0, approvedCreditLimit - usedCredit),
      creditLimitApprovalStatus: 'approved' as const
    };
  });
};

const optionalReason = (value: unknown, maxLength = 500) => {
  const clean = String(value || '').trim();
  if (clean.length > maxLength) throw new Error('Reason is too long.');
  return clean || 'Not provided';
};

const finiteAmount = (value: unknown, label: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new Error(`${label} must be a valid non-negative amount.`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

interface LoadedCreditCalculation {
  calculation: CreditCalculationResult;
  calculationInput: CreditCalculationInput;
  existingProfile: CreditDocumentData;
  settings: AppSettings;
}

const asCreditData = (value: object): CreditDocumentData => value as unknown as CreditDocumentData;

const loadCreditCalculation = async (
  customerId: string,
  reviewReason: string,
  lookbackDays?: 60 | 90,
  preloadedCustomer?: Customer,
  preloadedSettings?: AppSettings
): Promise<LoadedCreditCalculation | undefined> => {
  const [customer, invoices, payments, settings, existingSnapshot] = await Promise.all([
    preloadedCustomer ?? getCustomerById(customerId),
    getInvoicesByCustomerId(customerId),
    getPaymentsByCustomerId(customerId),
    preloadedSettings ?? getAppSettings(),
    getDoc(doc(db, PROFILE_COLLECTION, customerId))
  ]);
  if (!customer) return undefined;

  const existingProfile = (existingSnapshot.data() ?? {}) as CreditDocumentData;
  const calculationInput: CreditCalculationInput = {
    customerId,
    customer: asCreditData(customer),
    invoices: invoices.map((invoice) => ({ id: invoice.id, data: asCreditData(invoice) })),
    payments: payments.map((payment) => ({ id: payment.id, data: asCreditData(payment) })),
    settings: asCreditData(settings),
    existingProfile,
    reviewReason,
    lookbackDays
  };

  return {
    calculation: calculateCustomerCredit(calculationInput),
    calculationInput,
    existingProfile,
    settings
  };
};

const recalculateLoaded = (
  loaded: LoadedCreditCalculation,
  reviewReason: string,
  overrides: CreditDocumentData = {}
) => calculateCustomerCredit({
  ...loaded.calculationInput,
  existingProfile: { ...loaded.existingProfile, ...overrides },
  reviewReason
});

interface CreditAuditInput {
  action: string;
  reason: string;
  oldValue: unknown;
  newValue: unknown;
}

const writeCreditResult = async (
  customerId: string,
  calculation: CreditCalculationResult,
  audit?: CreditAuditInput
) => {
  const batch = writeBatch(db);
  batch.set(doc(db, PROFILE_COLLECTION, customerId), calculation.profile);
  batch.set(doc(db, SUMMARY_COLLECTION, customerId), calculation.summary);

  if (audit) {
    const adminUid = auth.currentUser?.uid;
    if (!adminUid) throw new Error('Sign in before performing this Admin action.');
    batch.set(doc(collection(db, 'creditAuditLogs')), {
      customerId,
      customerName: String(calculation.profile.customerName || ''),
      action: audit.action,
      adminUid,
      timestamp: new Date().toISOString(),
      oldValue: audit.oldValue ?? null,
      newValue: audit.newValue ?? null,
      reason: audit.reason
    });
  }

  await batch.commit();
};

export const manageCustomerCredit = async (input: ManageCreditInput) => {
  const customerId = requiredText(input.customerId, 'Customer', 160);
  const loaded = await loadCreditCalculation(customerId, `admin_${input.action}`, input.lookbackDays);
  if (!loaded) throw new Error('Customer was not found.');

  if (input.action === 'recalculate') {
    await writeCreditResult(customerId, loaded.calculation);
    return { ok: true };
  }

  const reason = optionalReason(input.reason);
  const current = Object.keys(loaded.existingProfile).length > 0
    ? loaded.existingProfile
    : loaded.calculation.profile;
  let overrides: CreditDocumentData = {};
  let auditOld: unknown = null;
  let auditNew: unknown = null;

  if (input.action === 'hold' || input.action === 'remove_hold') {
    const manualHold = input.action === 'hold';
    overrides = { manualHold };
    auditOld = { manualHold: current.manualHold === true, creditStatus: current.creditStatus };
    auditNew = { manualHold };
  } else if (input.action === 'override') {
    const amount = finiteAmount(input.amount, 'Override amount');
    const expiresAt = requiredText(input.expiresAt, 'Expiry date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || expiresAt < new Date().toISOString().slice(0, 10)) {
      throw new Error('Override expiry must be today or a future date.');
    }
    const creditOverride = {
      amount,
      reason,
      expiresAt,
      createdAt: new Date().toISOString(),
      createdBy: auth.currentUser?.uid || ''
    };
    overrides = { creditOverride };
    auditOld = current.creditOverride ?? null;
    auditNew = creditOverride;
  } else if (input.action === 'remove_override') {
    overrides = { creditOverride: null };
    auditOld = current.creditOverride ?? null;
  } else if (input.action === 'approve' || input.action === 'manual_starter' || input.action === 'reject') {
    auditOld = {
      approvedCreditLimit: current.approvedCreditLimit,
      creditLimitApprovalStatus: current.creditLimitApprovalStatus
    };
  } else {
    throw new Error('Unsupported credit action.');
  }

  const calculated = recalculateLoaded(loaded, `admin_${input.action}`, overrides);

  if (input.action === 'approve' || input.action === 'manual_starter') {
    const amount = finiteAmount(input.amount, 'Approved amount');
    if (input.action === 'approve' && amount > Number(calculated.profile.calculatedCreditLimit) + 0.01) {
      throw new Error('Use an override to approve above the calculated recommendation.');
    }
    if (input.action === 'manual_starter') {
      const starterCap = Number(loaded.settings.creditPolicy.starterLimitCap ?? 25000);
      if (amount > starterCap + 0.01) throw new Error('The starter limit cannot exceed the configured starter cap.');
      calculated.profile.manualStarterLimit = amount;
    }
    calculated.profile.approvedCreditLimit = amount;
    calculated.profile.creditLimitApprovalStatus = 'approved';
    calculated.profile.availableCredit = calculated.profile.creditStatus === 'hold' || calculated.profile.creditStatus === 'disabled'
      ? 0
      : Math.max(0, amount - Number(calculated.profile.currentOutstanding) - Number(calculated.profile.confirmedUninvoicedCreditOrders));
    calculated.summary.availableCredit = calculated.profile.availableCredit;
    calculated.summary.approvedCreditLimit = amount;
    auditNew = { approvedCreditLimit: amount, creditLimitApprovalStatus: 'approved' };
  } else if (input.action === 'reject') {
    calculated.profile.approvedCreditLimit = Math.min(
      Number(current.approvedCreditLimit || 0),
      Number(calculated.profile.approvedCreditLimit || 0)
    );
    calculated.profile.creditLimitApprovalStatus = 'rejected';
    calculated.profile.availableCredit = calculated.profile.creditStatus === 'hold' || calculated.profile.creditStatus === 'disabled'
      ? 0
      : Math.max(0, Number(calculated.profile.approvedCreditLimit) - Number(calculated.profile.currentOutstanding) - Number(calculated.profile.confirmedUninvoicedCreditOrders));
    calculated.summary.availableCredit = calculated.profile.availableCredit;
    calculated.summary.approvedCreditLimit = calculated.profile.approvedCreditLimit;
    auditNew = {
      approvedCreditLimit: calculated.profile.approvedCreditLimit,
      creditLimitApprovalStatus: 'rejected'
    };
  }

  await writeCreditResult(customerId, calculated, {
    action: input.action,
    reason,
    oldValue: auditOld,
    newValue: auditNew
  });
  return { ok: true };
};

export const saveCreditPolicy = async (starterLimitCap: number, overdueGraceDays: number, lookbackDays: 60 | 90) => {
  const cleanStarterLimit = finiteAmount(starterLimitCap, 'Starter limit cap');
  if (!Number.isInteger(overdueGraceDays) || overdueGraceDays < 0 || overdueGraceDays > 365) {
    throw new Error('Overdue grace days must be a whole number from 0 to 365.');
  }
  if (lookbackDays !== 60 && lookbackDays !== 90) throw new Error('Calculation period must be 2 or 3 months.');

  const currentSettings = await getAppSettings(true);
  await updateAppSettings({
    ...currentSettings,
    creditPolicy: {
      starterLimitCap: cleanStarterLimit,
      overdueGraceDays,
      lookbackDays
    }
  });
  return { ok: true };
};

const recalculateAndWrite = async (customer: Customer, settings: AppSettings, lookbackDays: 60 | 90) => {
  const loaded = await loadCreditCalculation(customer.id, 'admin_bulk_review', lookbackDays, customer, settings);
  if (!loaded) return false;
  await writeCreditResult(customer.id, loaded.calculation);
  return true;
};

export const recalculateAllCustomerCredit = async (lookbackDays: 60 | 90) => {
  const [customers, settings] = await Promise.all([getCustomers({ limitCount: 5000 }), getAppSettings()]);
  let count = 0;
  for (let index = 0; index < customers.length; index += 10) {
    const results = await Promise.all(
      customers.slice(index, index + 10).map((customer) => recalculateAndWrite(customer, settings, lookbackDays))
    );
    count += results.filter(Boolean).length;
  }
  return { ok: true, count };
};

export const calculateCustomerCreditSummaryLocally = (
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings,
  storedSummary?: CustomerCreditSummary
): CustomerCreditSummary => {
  const result = calculateCustomerCredit({
    customerId: customer.id,
    customer: asCreditData(customer),
    invoices: invoices.map((invoice) => ({ id: invoice.id, data: asCreditData(invoice) })),
    payments: payments.map((payment) => ({ id: payment.id, data: asCreditData(payment) })),
    settings: asCreditData(settings),
    reviewReason: 'customer_view'
  });
  const summary = result.summary;
  const usedCredit = numberOrZero(summary.usedCredit);
  const approvedCreditLimit = storedSummary?.approvedCreditLimit
    ?? Math.max(0, numberOrZero(storedSummary?.availableCredit) + numberOrZero(storedSummary?.usedCredit));
  const manualHold = storedSummary?.manualHold === true;
  const calculatedStatus = mapCreditStatus(summary.creditStatus);
  const creditStatus: CreditStatus = manualHold ? 'hold' : calculatedStatus;
  const availableCredit = creditStatus === 'hold' || creditStatus === 'disabled'
    ? 0
    : Math.max(0, approvedCreditLimit - usedCredit);
  return {
    id: customer.id,
    customerId: customer.id,
    approvedCreditLimit,
    availableCredit,
    usedCredit,
    creditDays: numberOrZero(summary.creditDays),
    nextInvoiceDueDate: summary.nextInvoiceDueDate ? String(summary.nextInvoiceDueDate) : undefined,
    nextInvoiceDueAmount: summary.nextInvoiceDueAmount === null || summary.nextInvoiceDueAmount === undefined
      ? undefined
      : numberOrZero(summary.nextInvoiceDueAmount),
    creditStatus,
    manualHold,
    updatedAt: String(summary.updatedAt || '')
  };
};
