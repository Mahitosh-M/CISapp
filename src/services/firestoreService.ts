import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  Customer,
  CustomerFormData,
  CustomerTier,
  AppSettings,
  GiftHistory,
  GiftHistoryFormData,
  Invoice,
  InvoiceFormData,
  Payment,
  PaymentFormData,
  UserProfile
} from '../types';
import {
  DEFAULT_SETTINGS,
  calculateDynamicDueDate,
  getPaymentTermsLabel,
  mergeWithDefaultSettings
} from '../utils/settings';

const CUSTOMERS = 'customers';
const INVOICES = 'invoices';
const PAYMENTS = 'payments';
const SETTINGS = 'settings';
const GIFT_HISTORY = 'giftHistory';
const USERS = 'users';

const nowIso = () => new Date().toISOString();

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
    paymentTerms: String(data.paymentTerms || getPaymentTermsLabel(tier)),
    notes: String(data.notes || ''),
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
    date: String(data.date || ''),
    dueDate: String(data.dueDate || data.date || ''),
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

const mapPaymentDoc = (id: string, data: Record<string, unknown>): Payment => ({
  id,
  invoiceId: String(data.invoiceId || ''),
  invoiceNumber: String(data.invoiceNumber || ''),
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  date: String(data.date || ''),
  amount: numberOrZero(data.amount),
  mode: (data.mode as Payment['mode']) || 'Cash',
  notes: String(data.notes || ''),
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

const mapSettingsDoc = (id: string, data: Record<string, unknown>): AppSettings => {
  return mergeWithDefaultSettings({
    id,
    key: 'erpSettings',
    giftPercentages: data.giftPercentages as AppSettings['giftPercentages'],
    creditDays: data.creditDays as AppSettings['creditDays'],
    paymentBuffers: data.paymentBuffers as AppSettings['paymentBuffers'],
    scoringWeights: data.scoringWeights as AppSettings['scoringWeights'],
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
  });
};

const mapGiftHistoryDoc = (id: string, data: Record<string, unknown>): GiftHistory => ({
  id,
  customerId: String(data.customerId || ''),
  customerName: String(data.customerName || ''),
  tier: (data.tier as CustomerTier) || 'Tier 3',
  periodType: (data.periodType as GiftHistory['periodType']) || '3_months',
  periodStart: String(data.periodStart || ''),
  periodEnd: String(data.periodEnd || ''),
  salesAmount: numberOrZero(data.salesAmount),
  giftPercentage: numberOrZero(data.giftPercentage),
  giftAmount: numberOrZero(data.giftAmount),
  giftedDate: String(data.giftedDate || ''),
  giftedBy: String(data.giftedBy || ''),
  notes: String(data.notes || ''),
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

export const mapUserProfileDoc = (id: string, data: Record<string, unknown>): UserProfile => ({
  id,
  uid: String(data.uid || ''),
  email: String(data.email || ''),
  name: String(data.name || ''),
  role: data.role === 'Admin' ? 'Admin' : 'Staff',
  active: data.active !== false,
  createdAt: String(data.createdAt || ''),
  updatedAt: data.updatedAt ? String(data.updatedAt) : undefined
});

export const getCustomers = async () => {
  const customersQuery = query(collection(db, CUSTOMERS), orderBy('name', 'asc'));
  const snapshot = await getDocs(customersQuery);
  return snapshot.docs.map((customerDoc) => mapCustomerDoc(customerDoc.id, customerDoc.data()));
};

export const createCustomer = async (customer: CustomerFormData) => {
  return addDoc(collection(db, CUSTOMERS), {
    ...customer,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
};

export const updateCustomerRecord = async (customerId: string, customer: CustomerFormData) => {
  return updateDoc(doc(db, CUSTOMERS, customerId), {
    ...customer,
    updatedAt: nowIso()
  });
};

export const deleteCustomerRecord = async (customerId: string) => {
  return deleteDoc(doc(db, CUSTOMERS, customerId));
};

export const getInvoices = async () => {
  const invoicesQuery = query(collection(db, INVOICES), orderBy('date', 'desc'));
  const snapshot = await getDocs(invoicesQuery);
  return snapshot.docs.map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()));
};

export const getInvoicesByCustomerId = async (customerId: string) => {
  const invoicesQuery = query(collection(db, INVOICES), where('customerId', '==', customerId));
  const snapshot = await getDocs(invoicesQuery);
  return snapshot.docs
    .map((invoiceDoc) => mapInvoiceDoc(invoiceDoc.id, invoiceDoc.data()))
    .sort((a, b) => b.date.localeCompare(a.date));
};

export const getNextInvoiceNumber = async () => {
  const invoicesQuery = query(collection(db, INVOICES), orderBy('invoiceNumber', 'desc'));
  const snapshot = await getDocs(invoicesQuery);
  const highestNumber = snapshot.docs.reduce((highest, invoiceDoc) => {
    const invoiceNumber = String(invoiceDoc.data().invoiceNumber || '');
    const numericPart = Number(invoiceNumber.replace('INV-', ''));
    return Number.isFinite(numericPart) && numericPart > highest ? numericPart : highest;
  }, 0);

  return `INV-${String(highestNumber + 1).padStart(4, '0')}`;
};

export const createInvoice = async (invoice: InvoiceFormData) => {
  const invoiceNumber = await getNextInvoiceNumber();

  return addDoc(collection(db, INVOICES), {
    ...invoice,
    invoiceNumber,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
};

export const updateInvoiceRecord = async (invoiceId: string, invoice: InvoiceFormData) => {
  return updateDoc(doc(db, INVOICES, invoiceId), {
    ...invoice,
    updatedAt: nowIso()
  });
};

export const deleteInvoiceRecord = async (invoiceId: string) => {
  return deleteDoc(doc(db, INVOICES, invoiceId));
};

export const getPayments = async () => {
  const paymentsQuery = query(collection(db, PAYMENTS), orderBy('date', 'desc'));
  const snapshot = await getDocs(paymentsQuery);
  return snapshot.docs.map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()));
};

export const getPaymentsByInvoiceId = async (invoiceId: string) => {
  const paymentsQuery = query(collection(db, PAYMENTS), where('invoiceId', '==', invoiceId));
  const snapshot = await getDocs(paymentsQuery);
  return snapshot.docs
    .map((paymentDoc) => mapPaymentDoc(paymentDoc.id, paymentDoc.data()))
    .sort((a, b) => b.date.localeCompare(a.date));
};

export const createPayment = async (payment: PaymentFormData) => {
  return addDoc(collection(db, PAYMENTS), {
    ...payment,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
};

export const updatePaymentRecord = async (paymentId: string, payment: PaymentFormData) => {
  return updateDoc(doc(db, PAYMENTS, paymentId), {
    ...payment,
    updatedAt: nowIso()
  });
};

export const deletePaymentRecord = async (paymentId: string) => {
  return deleteDoc(doc(db, PAYMENTS, paymentId));
};

export const getAppSettings = async () => {
  const settingsQuery = query(collection(db, SETTINGS), where('key', '==', 'erpSettings'));
  const snapshot = await getDocs(settingsQuery);
  const existingSettings = snapshot.docs[0];

  if (existingSettings) {
    return mapSettingsDoc(existingSettings.id, existingSettings.data());
  }

  const createdSettings = await addDoc(collection(db, SETTINGS), {
    ...DEFAULT_SETTINGS,
    updatedAt: nowIso()
  });

  return {
    ...DEFAULT_SETTINGS,
    id: createdSettings.id,
    updatedAt: nowIso()
  };
};

export const updateAppSettings = async (settings: AppSettings) => {
  if (!settings.id) {
    return addDoc(collection(db, SETTINGS), {
      ...mergeWithDefaultSettings(settings),
      updatedAt: nowIso()
    });
  }

  return updateDoc(doc(db, SETTINGS, settings.id), {
    ...mergeWithDefaultSettings(settings),
    updatedAt: nowIso()
  });
};

export const getGiftHistory = async () => {
  const giftQuery = query(collection(db, GIFT_HISTORY), orderBy('giftedDate', 'desc'));
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

export const createGiftHistoryRecord = async (gift: GiftHistoryFormData) => {
  return addDoc(collection(db, GIFT_HISTORY), {
    ...gift,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
};

export const deleteGiftHistoryRecord = async (giftId: string) => {
  return deleteDoc(doc(db, GIFT_HISTORY, giftId));
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

export const updateUserProfileRecord = async (profileId: string, profile: Partial<UserProfile>) => {
  return updateDoc(doc(db, USERS, profileId), {
    ...profile,
    updatedAt: nowIso()
  });
};

export const deleteUserProfileRecord = async (profileId: string) => {
  return deleteDoc(doc(db, USERS, profileId));
};
