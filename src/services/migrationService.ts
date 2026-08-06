import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import type { CustomerTier } from '../types';
import { buildInvoiceTimeTerms } from '../utils/settings';
import { recalculateCustomerDerivedData } from './derivedDataService';
import { getAppSettings, type AuditUser } from './firestoreService';

const MIGRATION_ID = 'customerDerivedDataV1';
const MIGRATION_VERSION = 1;
const INVOICE_BATCH_SIZE = 50;
const CUSTOMER_BATCH_SIZE = 5;
const BUSINESS_MONTH_BATCH_SIZE = 3;

type MigrationPhase = 'invoice_terms' | 'customer_summaries' | 'business_snapshots' | 'complete';

export interface DerivedDataMigrationStatus {
  version: number;
  phase: MigrationPhase;
  invoiceCursor: string;
  customerCursor: string;
  businessMonthCursor: string;
  businessEndMonth: string;
  processedInvoices: number;
  updatedInvoices: number;
  processedCustomers: number;
  processedBusinessMonths: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string;
  updatedBy: string;
}

const emptyStatus = (): DerivedDataMigrationStatus => ({
  version: MIGRATION_VERSION,
  phase: 'invoice_terms',
  invoiceCursor: '',
  customerCursor: '',
  businessMonthCursor: '',
  businessEndMonth: '',
  processedInvoices: 0,
  updatedInvoices: 0,
  processedCustomers: 0,
  processedBusinessMonths: 0,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: '',
  updatedBy: ''
});

const requireAdmin = (auditUser?: AuditUser) => {
  if (auditUser?.role !== 'Admin') throw new Error('Only Admin users can run the historical data migration.');
};

const isTier = (value: unknown): value is CustomerTier => (
  value === 'Tier 1' || value === 'Tier 2' || value === 'Tier 3' || value === 'Tier 4'
);

const asNumberOrUndefined = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const daysBetweenDateStrings = (fromDate: string, toDate: string) => {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};

const isOpeningBalanceData = (data: Record<string, unknown>) => (
  data.isOpeningBalance === true
  || String(data.invoiceType || '') === 'opening_balance'
  || String(data.invoiceNumber || '').startsWith('0000-OPENING')
);

const normalized = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');

const isValidBusinessInvoiceData = (data: Record<string, unknown>) => {
  if (isOpeningBalanceData(data)) return false;
  if (['draft', 'cancelled', 'canceled', 'deleted', 'void'].includes(normalized(data.status))) return false;
  return ![
    'sales return', 'sale return', 'return', 'credit note', 'inter shop',
    'quotation', 'quote', 'order', 'confirmed order', 'cogs', 'inventory'
  ].includes(normalized(data.invoiceType));
};

const getStatusRef = () => doc(db, 'migrationStatus', MIGRATION_ID);

export const getDerivedDataMigrationStatus = async () => {
  const snapshot = await getDoc(getStatusRef());
  return snapshot.exists()
    ? ({ ...emptyStatus(), ...snapshot.data() } as DerivedDataMigrationStatus)
    : undefined;
};

const writeInvoiceTermsBatch = async (status: DerivedDataMigrationStatus, auditUser: AuditUser) => {
  const pageQuery = status.invoiceCursor
    ? query(collection(db, 'invoices'), orderBy(documentId()), startAfter(status.invoiceCursor), limit(INVOICE_BATCH_SIZE))
    : query(collection(db, 'invoices'), orderBy(documentId()), limit(INVOICE_BATCH_SIZE));
  const page = await getDocs(pageQuery);
  const settings = await getAppSettings();
  const customerIds = [...new Set(page.docs
    .map((invoiceDoc) => String(invoiceDoc.data().customerId || ''))
    .filter(Boolean))];
  const customerSnapshots = await Promise.all(customerIds.map((customerId) => getDoc(doc(db, 'customers', customerId))));
  const tierByCustomerId = new Map(customerSnapshots.map((snapshot) => [
    snapshot.id,
    isTier(snapshot.data()?.tier) ? snapshot.data()?.tier as CustomerTier : 'Tier 4'
  ]));
  const batch = writeBatch(db);
  let updatedInvoices = 0;

  page.docs.forEach((invoiceDoc) => {
    const data = invoiceDoc.data() as Record<string, unknown>;
    if (isOpeningBalanceData(data)) return;
    const missingTerms = [
      data.tierAtInvoice,
      data.pcPercentageAtInvoice,
      data.creditDaysAtInvoice,
      data.bufferDaysAtInvoice,
      data.savedDueDate,
      data.finalPcCutoffDate
    ].some((value) => value === undefined || value === null || value === '');
    if (!missingTerms) return;

    const invoiceDate = String(data.date || data.invoiceDate || '');
    if (!invoiceDate) return;
    const savedDueDate = String(data.savedDueDate || data.dueDate || '');
    const existingFinalCutoff = String(data.finalPcCutoffDate || '');
    const invoiceTier = isTier(data.tierAtInvoice)
      ? data.tierAtInvoice
      : isTier(data.tier)
        ? data.tier
        : tierByCustomerId.get(String(data.customerId || '')) ?? 'Tier 4';
    const inferredCreditDays = savedDueDate
      ? Math.max(0, daysBetweenDateStrings(invoiceDate, savedDueDate))
      : undefined;
    const inferredBufferDays = savedDueDate && existingFinalCutoff
      ? Math.max(0, daysBetweenDateStrings(savedDueDate, existingFinalCutoff))
      : undefined;
    const terms = buildInvoiceTimeTerms(invoiceDate, savedDueDate, invoiceTier, settings, {
      tierAtInvoice: invoiceTier,
      pcPercentageAtInvoice: asNumberOrUndefined(data.pcPercentageAtInvoice ?? data.giftPercentage),
      creditDaysAtInvoice: asNumberOrUndefined(data.creditDaysAtInvoice) ?? inferredCreditDays,
      bufferDaysAtInvoice: asNumberOrUndefined(data.bufferDaysAtInvoice) ?? inferredBufferDays,
      savedDueDate: savedDueDate || undefined,
      termsEstimated: true
    });

    batch.update(invoiceDoc.ref, {
      dueDate: terms.savedDueDate,
      ...terms,
      termsEstimated: true
    });
    updatedInvoices += 1;
  });

  const timestamp = new Date().toISOString();
  const nextStatus: DerivedDataMigrationStatus = {
    ...status,
    phase: page.size < INVOICE_BATCH_SIZE ? 'customer_summaries' : 'invoice_terms',
    invoiceCursor: page.docs[page.docs.length - 1]?.id ?? status.invoiceCursor,
    processedInvoices: status.processedInvoices + page.size,
    updatedInvoices: status.updatedInvoices + updatedInvoices,
    updatedAt: timestamp,
    updatedBy: auditUser.userEmail || auditUser.userId || ''
  };
  batch.set(getStatusRef(), nextStatus);
  await batch.commit();
  return nextStatus;
};

const writeCustomerSummaryBatch = async (status: DerivedDataMigrationStatus, auditUser: AuditUser) => {
  const pageQuery = status.customerCursor
    ? query(collection(db, 'customers'), orderBy(documentId()), startAfter(status.customerCursor), limit(CUSTOMER_BATCH_SIZE))
    : query(collection(db, 'customers'), orderBy(documentId()), limit(CUSTOMER_BATCH_SIZE));
  const page = await getDocs(pageQuery);

  for (const customerDoc of page.docs) {
    await recalculateCustomerDerivedData(customerDoc.id, 'historical_backfill', { rebuildMonthlySnapshots: true });
  }

  const timestamp = new Date().toISOString();
  const nextStatus: DerivedDataMigrationStatus = {
    ...status,
    phase: page.size < CUSTOMER_BATCH_SIZE ? 'business_snapshots' : 'customer_summaries',
    customerCursor: page.docs[page.docs.length - 1]?.id ?? status.customerCursor,
    processedCustomers: status.processedCustomers + page.size,
    updatedAt: timestamp,
    updatedBy: auditUser.userEmail || auditUser.userId || ''
  };
  await writeBatchStatus(nextStatus);
  return nextStatus;
};

const addMonths = (month: string, count: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + count, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const monthEnd = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber, 0);
  return `${month}-${String(date.getDate()).padStart(2, '0')}`;
};

const getBusinessMonthBounds = async () => {
  const [firstInvoice, lastInvoice, firstPayment, lastPayment] = await Promise.all([
    getDocs(query(collection(db, 'invoices'), orderBy('date', 'asc'), limit(1))),
    getDocs(query(collection(db, 'invoices'), orderBy('date', 'desc'), limit(1))),
    getDocs(query(collection(db, 'payments'), orderBy('date', 'asc'), limit(1))),
    getDocs(query(collection(db, 'payments'), orderBy('date', 'desc'), limit(1)))
  ]);
  const dates = [
    firstInvoice.docs[0]?.data().date,
    lastInvoice.docs[0]?.data().date,
    firstPayment.docs[0]?.data().date,
    lastPayment.docs[0]?.data().date
  ].map((date) => String(date || '')).filter(Boolean).sort();
  return dates.length > 0 ? { start: dates[0].slice(0, 7), end: dates[dates.length - 1].slice(0, 7) } : undefined;
};

const writeBatchStatus = async (status: DerivedDataMigrationStatus) => {
  const batch = writeBatch(db);
  batch.set(getStatusRef(), status);
  await batch.commit();
};

const writeBusinessSnapshotBatch = async (status: DerivedDataMigrationStatus, auditUser: AuditUser) => {
  const bounds = status.businessMonthCursor && status.businessEndMonth
    ? { start: status.businessMonthCursor, end: status.businessEndMonth }
    : await getBusinessMonthBounds();
  const timestamp = new Date().toISOString();

  if (!bounds) {
    const completed = { ...status, phase: 'complete' as const, completedAt: timestamp, updatedAt: timestamp };
    await writeBatchStatus(completed);
    return completed;
  }

  const months: string[] = [];
  for (let month = bounds.start; month <= bounds.end && months.length < BUSINESS_MONTH_BATCH_SIZE; month = addMonths(month, 1)) {
    months.push(month);
  }
  const rows = await Promise.all(months.map(async (month) => {
    const [invoices, payments] = await Promise.all([
      getDocs(query(collection(db, 'invoices'), where('date', '>=', `${month}-01`), where('date', '<=', monthEnd(month)))),
      getDocs(query(collection(db, 'payments'), where('date', '>=', `${month}-01`), where('date', '<=', monthEnd(month))))
    ]);
    const validInvoices = invoices.docs.filter((invoiceDoc) => isValidBusinessInvoiceData(invoiceDoc.data()));
    return {
      month,
      totalSales: validInvoices.reduce((sum, invoiceDoc) => sum + Math.max(0, Number(invoiceDoc.data().totalSales ?? invoiceDoc.data().salesAmount) || 0), 0),
      totalProfit: validInvoices.reduce((sum, invoiceDoc) => sum + (Number(invoiceDoc.data().totalProfit) || 0), 0),
      invoiceCount: validInvoices.length,
      paymentsReceived: payments.docs.reduce((sum, paymentDoc) => sum + Math.max(0, Number(paymentDoc.data().amount ?? paymentDoc.data().amountReceived) || 0), 0)
    };
  }));
  const nextMonth = addMonths(months[months.length - 1], 1);
  const isComplete = nextMonth > bounds.end;
  const nextStatus: DerivedDataMigrationStatus = {
    ...status,
    phase: isComplete ? 'complete' : 'business_snapshots',
    businessMonthCursor: nextMonth,
    businessEndMonth: bounds.end,
    processedBusinessMonths: status.processedBusinessMonths + rows.length,
    completedAt: isComplete ? timestamp : '',
    updatedAt: timestamp,
    updatedBy: auditUser.userEmail || auditUser.userId || ''
  };
  const batch = writeBatch(db);
  rows.forEach((row) => batch.set(doc(db, 'businessMonthlySnapshots', row.month), {
    ...row,
    needsBackfill: false,
    updatedAt: timestamp
  }));
  batch.set(getStatusRef(), nextStatus);
  await batch.commit();
  return nextStatus;
};

export const runDerivedDataMigrationBatch = async (auditUser?: AuditUser) => {
  requireAdmin(auditUser);
  const status = await getDerivedDataMigrationStatus() ?? emptyStatus();
  if (status.phase === 'complete') return status;
  if (status.phase === 'invoice_terms') return writeInvoiceTermsBatch(status, auditUser!);
  if (status.phase === 'customer_summaries') return writeCustomerSummaryBatch(status, auditUser!);
  return writeBusinessSnapshotBatch(status, auditUser!);
};

export const runDerivedDataMigration = async (
  auditUser?: AuditUser,
  onProgress?: (status: DerivedDataMigrationStatus) => void
) => {
  requireAdmin(auditUser);
  let status = await getDerivedDataMigrationStatus() ?? emptyStatus();
  for (let batchNumber = 0; status.phase !== 'complete' && batchNumber < 1000; batchNumber += 1) {
    status = await runDerivedDataMigrationBatch(auditUser);
    onProgress?.(status);
  }
  if (status.phase !== 'complete') throw new Error('Migration stopped before completion. Run it again to resume from the saved cursor.');
  return status;
};
