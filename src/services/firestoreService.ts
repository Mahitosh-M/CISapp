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
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Alert,
  AlertStatus,
  Customer,
  CustomerFormData,
  CustomerTier,
  AppSettings,
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
  UserProfile,
  UserRole
} from '../types';
import {
  DEFAULT_SETTINGS,
  calculateDynamicDueDate,
  getPaymentTermsLabel,
  mergeWithDefaultSettings,
  validateAppSettings
} from '../utils/settings';
import { isOfferCurrentlyActive, sortOffersByLatest } from '../utils/offers';

const CUSTOMERS = 'customers';
const INVOICES = 'invoices';
const PAYMENTS = 'payments';
const SETTINGS = 'settings';
const APP_SETTINGS_DOC_ID = 'appSettings';
const GIFT_HISTORY = 'giftHistory';
const GIFT_ITEMS = 'giftItems';
const USERS = 'users';
const ALERTS = 'alerts';
const OFFERS = 'offers';
const DEFAULT_LIST_LIMIT = 50;
const ACTIVE_OFFER_LIMIT = 20;

export interface AuditUser {
  userId?: string;
  userEmail?: string;
  role?: UserRole;
}

interface DateRangeQueryOptions {
  fromDate?: string;
  toDate?: string;
  limitCount?: number;
}

interface CustomerScopedQueryOptions extends DateRangeQueryOptions {
  customerId?: string;
  customerName?: string;
}

const nowIso = () => new Date().toISOString();

const getTodayDateString = () => nowIso().slice(0, 10);

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
  const tier = (data.tier as CustomerTier) || 'Tier 3';

  return {
    id,
    name: String(data.name || ''),
    mobile: String(data.mobile || ''),
    area: String(data.area || ''),
    tier,
    tierOverride: Boolean(data.tierOverride),
    // Old balance from before this ERP started. Missing legacy documents safely read as zero.
    previousOutstandingAmount: Math.max(0, numberOrZero(data.previousOutstandingAmount)),
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
    date: String(data.date || data.invoiceDate || ''),
    dueDate: String(data.dueDate || data.date || data.invoiceDate || ''),
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
    invoicePrefix: data.invoicePrefix ? String(data.invoicePrefix) : undefined,
    financialYearReset: data.financialYearReset as AppSettings['financialYearReset'],
    defaultReportPeriod: data.defaultReportPeriod as AppSettings['defaultReportPeriod'],
    giftPeriodOptions: data.giftPeriodOptions as AppSettings['giftPeriodOptions'],
    staffPermissions: data.staffPermissions as AppSettings['staffPermissions'],
    targetSettings: data.targetSettings as AppSettings['targetSettings'],
    showCustomerTierToCustomer: data.showCustomerTierToCustomer === true,
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
  });
};

const mapGiftHistoryDoc = (id: string, data: Record<string, unknown>): GiftHistory => ({
  id,
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  tier: (data.tier || data.tierAtGiftTime || 'Tier 3') as CustomerTier,
  tierAtGiftTime: (data.tierAtGiftTime || data.tier || 'Tier 3') as CustomerTier,
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
    data.eligibleTier === 'Tier 1' || data.eligibleTier === 'Tier 2' || data.eligibleTier === 'Tier 3'
      ? data.eligibleTier
      : 'All',
  notes: String(data.notes || ''),
  isActive: data.isActive !== false,
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

const sanitizeGiftItemPayload = (giftItem: GiftItemFormData): GiftItemFormData => ({
  giftItemName: giftItem.giftItemName.trim(),
  // Simplified gift item settings now use only targetValue as the budget threshold.
  // Legacy targetType/minBudget/maxBudget/eligibleTier fields may still exist on old docs,
  // but new saves intentionally leave those untouched/unused.
  targetValue: Math.max(0, numberOrZero(giftItem.targetValue)),
  notes: giftItem.notes.trim(),
  isActive: giftItem.isActive
});

const mapAlertDoc = (id: string, data: Record<string, unknown>): Alert => ({
  id,
  uniqueKey: String(data.uniqueKey || id),
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  invoiceId: data.invoiceId ? String(data.invoiceId) : undefined,
  invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : undefined,
  alertType: data.alertType as Alert['alertType'],
  severity: (data.severity as Alert['severity']) || 'Medium',
  date: String(data.date || getTodayDateString()),
  status: (data.status as Alert['status']) || 'Open',
  actionRequired: String(data.actionRequired || ''),
  message: String(data.message || ''),
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
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
  constraints.push(orderBy('date', 'desc'));
  applyLimitConstraint(constraints, options?.limitCount);

  return constraints;
};

const buildPaymentQueryConstraints = (options?: CustomerScopedQueryOptions) => {
  const constraints: QueryConstraint[] = [];

  if (options?.customerId) constraints.push(where('customerId', '==', options.customerId));
  if (options?.customerName && !options.customerId) constraints.push(where('customerName', '==', options.customerName));

  applyDateRangeConstraints(constraints, 'date', options);
  constraints.push(orderBy('date', 'desc'));
  applyLimitConstraint(constraints, options?.limitCount);

  return constraints;
};

const mapOfferDoc = (id: string, data: Record<string, unknown>): Offer => ({
  id,
  title: String(data.title || ''),
  description: data.description ? String(data.description) : '',
  imageUrl: String(data.imageUrl || ''),
  imagePath: data.imagePath ? String(data.imagePath) : undefined,
  startDate: String(data.startDate || ''),
  endDate: String(data.endDate || ''),
  isActive: data.isActive === true,
  createdAt: dateFieldToString(data.createdAt),
  createdBy: data.createdBy ? String(data.createdBy) : undefined,
  updatedAt: data.updatedAt ? dateFieldToString(data.updatedAt) : undefined
});

const sanitizeOfferPayload = (offer: OfferFormData): OfferFormData => ({
  title: offer.title.trim(),
  description: offer.description.trim(),
  // Uploaded offer images save their Firebase Storage download URL here; manual imageUrl remains a fallback.
  imageUrl: offer.imageUrl.trim(),
  imagePath: offer.imagePath || '',
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
  const customersQuery = query(collection(db, CUSTOMERS), orderBy('name', 'asc'));
  const snapshot = await getDocs(customersQuery);
  return snapshot.docs.map((customerDoc) => mapCustomerDoc(customerDoc.id, customerDoc.data()));
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
  const customerPayload = {
    ...customer,
    previousOutstandingAmount: Math.max(0, numberOrZero(customer.previousOutstandingAmount))
  };

  const docRef = await addDoc(collection(db, CUSTOMERS), {
    ...customerPayload,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  return docRef;
};

export const updateCustomerRecord = async (customerId: string, customer: CustomerFormData, auditUser?: AuditUser) => {
  const customerPayload = {
    ...customer,
    previousOutstandingAmount: Math.max(0, numberOrZero(customer.previousOutstandingAmount))
  };

  await updateDoc(doc(db, CUSTOMERS, customerId), {
    ...customerPayload,
    updatedAt: nowIso()
  });

};

export const deleteCustomerRecord = async (customerId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, CUSTOMERS, customerId));
};

export const getInvoices = async (options?: DateRangeQueryOptions) => {
  const invoicesQuery = query(collection(db, INVOICES), ...buildInvoiceQueryConstraints(options));
  const snapshot = await getDocs(invoicesQuery);
  return snapshot.docs.map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()));
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

  return docRef;
};

export const updateInvoiceRecord = async (invoiceId: string, invoice: InvoiceFormData, auditUser?: AuditUser) => {
  await updateDoc(doc(db, INVOICES, invoiceId), {
    ...invoice,
    updatedAt: nowIso()
  });

};

export const deleteInvoiceRecord = async (invoiceId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, INVOICES, invoiceId));
};

export const getPayments = async (options?: DateRangeQueryOptions) => {
  const paymentsQuery = query(collection(db, PAYMENTS), ...buildPaymentQueryConstraints(options));
  const snapshot = await getDocs(paymentsQuery);
  return snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
};

export const getPaymentsByInvoiceId = async (invoiceId: string, options?: Pick<DateRangeQueryOptions, 'limitCount'>) => {
  const constraints: QueryConstraint[] = [where('invoiceId', '==', invoiceId), orderBy('date', 'desc')];
  applyLimitConstraint(constraints, options?.limitCount);
  const paymentsQuery = query(collection(db, PAYMENTS), ...constraints);
  const snapshot = await getDocs(paymentsQuery);
  return snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
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
  const amountUsedForOldBalance = Math.min(cleanPayment.amount, oldBalanceBeforePayment);
  const amountAppliedToInvoice = Math.max(0, cleanPayment.amount - amountUsedForOldBalance);
  const oldBalanceAfterPayment = Math.max(0, oldBalanceBeforePayment - amountUsedForOldBalance);

  return {
    payload: {
      ...cleanPayment,
      // previousOutstandingAmount is an old opening balance from before this ERP started.
      // Cash received clears that old balance first; only the remaining amount is applied to the selected invoice.
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

    if (customerSnapshot.exists() && allocation.payload.amountUsedForOldBalance > 0) {
      transaction.update(customerRef, {
        previousOutstandingAmount: allocation.oldBalanceAfterPayment,
        updatedAt: timestamp
      });
    }

    transaction.set(paymentRef, {
      ...allocatedPayment,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  });

  return paymentRef;
};

export const updatePaymentRecord = async (paymentId: string, payment: PaymentFormData, auditUser?: AuditUser) => {
  const paymentRef = doc(db, PAYMENTS, paymentId);
  const timestamp = nowIso();
  let allocatedPayment = buildAllocatedPaymentPayload(payment, 0).payload;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);
    const existingPayment = paymentSnapshot.exists() ? mapPaymentDoc(paymentSnapshot.id, paymentSnapshot.data()) : undefined;
    const oldCustomerId = existingPayment?.customerId || payment.customerId;
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

};

export const deletePaymentRecord = async (paymentId: string, auditUser?: AuditUser) => {
  const paymentRef = doc(db, PAYMENTS, paymentId);
  let deletedPayment: Payment | undefined;

  await runTransaction(db, async (transaction) => {
    const paymentSnapshot = await transaction.get(paymentRef);

    if (!paymentSnapshot.exists()) {
      return;
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

};

export const getAppSettings = async (forceRefresh = false) => {
  if (appSettingsCache && !forceRefresh) {
    return appSettingsCache;
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

    appSettingsCache = { ...appSettings, id: docRef.id, updatedAt: timestamp };
    return docRef;
  }

  const timestamp = nowIso();
  await updateDoc(doc(db, SETTINGS, settings.id), {
    ...appSettings,
    updatedAt: timestamp
  });

  appSettingsCache = { ...appSettings, id: settings.id, updatedAt: timestamp };
};

export const getGiftHistory = async (options?: DateRangeQueryOptions) => {
  const constraints: QueryConstraint[] = [];
  applyDateRangeConstraints(constraints, 'giftedDate', options);
  constraints.push(orderBy('giftedDate', 'desc'));
  applyLimitConstraint(constraints, options?.limitCount);
  const giftQuery = query(collection(db, GIFT_HISTORY), ...constraints);
  const snapshot = await getDocs(giftQuery);
  return snapshot.docs.map((giftDoc) => mapGiftHistoryDoc(giftDoc.id, giftDoc.data()));
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

  return docRef;
};

export const updateGiftHistoryRecord = async (giftId: string, gift: Partial<GiftHistory>, auditUser?: AuditUser) => {
  await updateDoc(doc(db, GIFT_HISTORY, giftId), {
    ...gift,
    updatedAt: nowIso()
  });

};

export const deleteGiftHistoryRecord = async (giftId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, GIFT_HISTORY, giftId));
};

export const getGiftItems = async () => {
  const giftItemsQuery = query(collection(db, GIFT_ITEMS), orderBy('giftItemName', 'asc'));
  const snapshot = await getDocs(giftItemsQuery);
  return snapshot.docs.map((giftItemDoc) => mapGiftItemDoc(giftItemDoc.id, giftItemDoc.data()));
};

export const createGiftItem = async (giftItem: GiftItemFormData, auditUser?: AuditUser) => {
  const payload = sanitizeGiftItemPayload(giftItem);
  const docRef = await addDoc(collection(db, GIFT_ITEMS), {
    ...payload,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  return docRef;
};

export const updateGiftItemRecord = async (giftItemId: string, giftItem: GiftItemFormData, auditUser?: AuditUser) => {
  const payload = sanitizeGiftItemPayload(giftItem);

  await updateDoc(doc(db, GIFT_ITEMS, giftItemId), {
    ...payload,
    updatedAt: nowIso()
  });

};

export const deleteGiftItemRecord = async (giftItemId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, GIFT_ITEMS, giftItemId));
};

export const getUserProfiles = async () => {
  const usersQuery = query(collection(db, USERS), orderBy('email', 'asc'));
  const snapshot = await getDocs(usersQuery);
  return snapshot.docs.map((userDoc) => mapUserProfileDoc(userDoc.id, userDoc.data()));
};

export const getUserProfileByUid = async (uid: string) => {
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
  return addDoc(collection(db, USERS), {
    ...profile,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
};

export const updateUserProfileRecord = async (profileId: string, profile: Partial<UserProfile>, auditUser?: AuditUser) => {
  await updateDoc(doc(db, USERS, profileId), {
    ...profile,
    updatedAt: nowIso()
  });

};

export const deleteUserProfileRecord = async (profileId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, USERS, profileId));
};

export const getAlerts = async (limitCount = DEFAULT_LIST_LIMIT) => {
  const alertsQuery = query(collection(db, ALERTS), orderBy('createdAt', 'desc'), firestoreLimit(limitCount));
  const snapshot = await getDocs(alertsQuery);
  return snapshot.docs.map((alertDoc) => mapAlertDoc(alertDoc.id, alertDoc.data()));
};

export const upsertAlerts = async (alerts: Omit<Alert, 'id' | 'createdAt' | 'updatedAt'>[], auditUser?: AuditUser) => {
  // Upsert needs the complete existing key set to avoid duplicate alert writes.
  const existingSnapshot = await getDocs(query(collection(db, ALERTS), orderBy('createdAt', 'desc')));
  const existingAlerts = existingSnapshot.docs.map((alertDoc) => mapAlertDoc(alertDoc.id, alertDoc.data()));
  const existingByKey = new Map(existingAlerts.map((alert) => [alert.uniqueKey, alert]));

  await Promise.all(
    alerts.map(async (alert) => {
      const existing = existingByKey.get(alert.uniqueKey);

      if (existing) {
        return updateDoc(doc(db, ALERTS, existing.id), {
          ...alert,
          status: existing.status,
          updatedAt: nowIso()
        });
      }

      const docRef = await addDoc(collection(db, ALERTS), {
        ...alert,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });

    })
  );
};

export const updateAlertStatus = async (alertId: string, status: AlertStatus, auditUser?: AuditUser) => {
  await updateDoc(doc(db, ALERTS, alertId), {
    status,
    updatedAt: nowIso()
  });

};

export const getOffers = async () => {
  const offersQuery = query(collection(db, OFFERS), orderBy('createdAt', 'desc'), firestoreLimit(DEFAULT_LIST_LIMIT));
  const snapshot = await getDocs(offersQuery);
  return snapshot.docs.map((offerDoc) => mapOfferDoc(offerDoc.id, offerDoc.data()));
};

export const getActiveOffers = async () => {
  // Free-tier safety: customers only read active offer docs. Sorting stays local so this
  // customer portal query does not require a composite Firestore index.
  const offersQuery = query(collection(db, OFFERS), where('isActive', '==', true));
  const snapshot = await getDocs(offersQuery);
  const offers = snapshot.docs.map((offerDoc) => mapOfferDoc(offerDoc.id, offerDoc.data()));

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

  return docRef;
};

export const updateOfferRecord = async (offerId: string, offer: OfferFormData, auditUser?: AuditUser) => {
  const payload = sanitizeOfferPayload(offer);

  await updateDoc(doc(db, OFFERS, offerId), {
    ...payload,
    updatedAt: nowIso()
  });
};

export const deleteOfferRecord = async (offerId: string, auditUser?: AuditUser) => {
  await deleteDoc(doc(db, OFFERS, offerId));
};
