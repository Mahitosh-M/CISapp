import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { calculateCustomerCredit } from './creditCalculation';

initializeApp();

const db = getFirestore();
const REGION = 'asia-south1';
const DEFAULT_SETTINGS_ID = 'appSettings';

type ProfileOverrides = Record<string, unknown>;

const getLookbackDays = (value: unknown): 60 | 90 | undefined => {
  const parsed = Number(value);
  return parsed === 60 || parsed === 90 ? parsed : undefined;
};

const getAdmin = async (uid?: string) => {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in before managing customer credit.');
  const profile = await db.doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.active !== true || profile.data()?.role !== 'Admin') {
    throw new HttpsError('permission-denied', 'Only an active Admin can perform this credit action.');
  }
  return profile.data()!;
};

const getSettings = async (): Promise<FirebaseFirestore.DocumentData> => {
  const preferred = await db.doc(`settings/${DEFAULT_SETTINGS_ID}`).get();
  if (preferred.exists) return { ...preferred.data()!, __docId: preferred.id };
  const fallback = await db.collection('settings').where('key', '==', 'erpSettings').limit(1).get();
  return fallback.docs[0] ? { ...fallback.docs[0].data(), __docId: fallback.docs[0].id } : { __docId: DEFAULT_SETTINGS_ID };
};

const buildCustomerCredit = async (customerId: string, reason: string, overrides: ProfileOverrides = {}, lookbackDays?: 60 | 90) => {
  const customerRef = db.doc(`customers/${customerId}`);
  const profileRef = db.doc(`customerCreditProfiles/${customerId}`);
  const [customer, invoices, payments, settings, existingProfile] = await Promise.all([
    customerRef.get(),
    db.collection('invoices').where('customerId', '==', customerId).get(),
    db.collection('payments').where('customerId', '==', customerId).get(),
    getSettings(),
    profileRef.get()
  ]);

  if (!customer.exists) return undefined;

  return calculateCustomerCredit({
    customerId,
    customer: customer.data()!,
    invoices: invoices.docs.map((invoice) => ({ id: invoice.id, data: invoice.data() })),
    payments: payments.docs.map((payment) => ({ id: payment.id, data: payment.data() })),
    settings,
    existingProfile: { ...(existingProfile.data() ?? {}), ...overrides },
    reviewReason: reason,
    lookbackDays
  });
};

const writeCreditResult = async (customerId: string, result: Awaited<ReturnType<typeof buildCustomerCredit>>) => {
  if (!result) return;
  const batch = db.batch();
  batch.set(db.doc(`customerCreditProfiles/${customerId}`), result.profile, { merge: false });
  batch.set(db.doc(`customerCreditSummaries/${customerId}`), result.summary, { merge: false });
  await batch.commit();
};

const recalculateCustomer = async (customerId: string, reason: string, overrides: ProfileOverrides = {}, lookbackDays?: 60 | 90) => {
  if (!customerId) return;
  const result = await buildCustomerCredit(customerId, reason, overrides, lookbackDays);
  await writeCreditResult(customerId, result);
};

const recalculateCustomers = async (customerIds: string[], reason: string, lookbackDays?: 60 | 90) => {
  const uniqueIds = [...new Set(customerIds.filter(Boolean))];
  for (let index = 0; index < uniqueIds.length; index += 20) {
    await Promise.all(uniqueIds.slice(index, index + 20).map((customerId) => recalculateCustomer(customerId, reason, {}, lookbackDays)));
  }
};

const recalculateAll = async (reason: string, lookbackDays?: 60 | 90) => {
  const customers = await db.collection('customers').select().get();
  await recalculateCustomers(customers.docs.map((customer) => customer.id), reason, lookbackDays);
  return customers.size;
};

const changedCustomerIds = (before: FirebaseFirestore.DocumentSnapshot | undefined, after: FirebaseFirestore.DocumentSnapshot | undefined) => {
  return [before?.data()?.customerId, after?.data()?.customerId].filter((value): value is string => typeof value === 'string' && value.length > 0);
};

export const recalculateCreditAfterInvoiceWrite = onDocumentWritten(
  { document: 'invoices/{invoiceId}', region: REGION, retry: true },
  async (event) => {
    await recalculateCustomers(changedCustomerIds(event.data?.before, event.data?.after), 'invoice_write');
  }
);

export const recalculateCreditAfterPaymentWrite = onDocumentWritten(
  { document: 'payments/{paymentId}', region: REGION, retry: true },
  async (event) => {
    await recalculateCustomers(changedCustomerIds(event.data?.before, event.data?.after), 'payment_write');
  }
);

export const recalculateCreditAfterCustomerWrite = onDocumentWritten(
  { document: 'customers/{customerId}', region: REGION, retry: true },
  async (event) => {
    if (!event.data?.after.exists) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    const relevantChange = !event.data.before.exists
      || before?.tier !== after?.tier
      || before?.totalOutstandingAmount !== after?.totalOutstandingAmount
      || before?.updatedAt !== after?.updatedAt;
    if (relevantChange) await recalculateCustomer(event.params.customerId, 'customer_write');
  }
);

export const recalculateCreditAfterSettingsWrite = onDocumentWritten(
  { document: 'settings/{settingsId}', region: REGION, retry: true },
  async (event) => {
    if (!event.data?.after.exists) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (
      JSON.stringify(before?.creditDays ?? {}) !== JSON.stringify(after?.creditDays ?? {})
      || JSON.stringify(before?.creditPolicy ?? {}) !== JSON.stringify(after?.creditPolicy ?? {})
    ) {
      await recalculateAll('credit_policy_write');
    }
  }
);

const requiredString = (value: unknown, label: string, maxLength = 500) => {
  const clean = String(value || '').trim();
  if (!clean) throw new HttpsError('invalid-argument', `${label} is required.`);
  if (clean.length > maxLength) throw new HttpsError('invalid-argument', `${label} is too long.`);
  return clean;
};

const finiteAmount = (value: unknown, label: string) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
    throw new HttpsError('invalid-argument', `${label} must be a valid non-negative amount.`);
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const writeAdminAction = async (
  customerId: string,
  adminUid: string,
  action: string,
  reason: string,
  oldValue: unknown,
  newValue: unknown,
  profile: FirebaseFirestore.DocumentData,
  summary: FirebaseFirestore.DocumentData
) => {
  const batch = db.batch();
  batch.set(db.doc(`customerCreditProfiles/${customerId}`), profile, { merge: false });
  batch.set(db.doc(`customerCreditSummaries/${customerId}`), summary, { merge: false });
  batch.create(db.collection('creditAuditLogs').doc(), {
    customerId,
    customerName: String(profile.customerName || ''),
    action,
    adminUid,
    timestamp: new Date().toISOString(),
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    reason
  });
  await batch.commit();
};

export const manageCustomerCredit = onCall({ region: REGION }, async (request) => {
  await getAdmin(request.auth?.uid);
  const customerId = requiredString(request.data?.customerId, 'Customer', 160);
  const action = requiredString(request.data?.action, 'Action', 60);
  const reason = action === 'recalculate'
    ? String(request.data?.reason || 'Admin-triggered review').slice(0, 500)
    : requiredString(request.data?.reason, 'Reason');
  const lookbackDays = getLookbackDays(request.data?.lookbackDays);

  if (action === 'recalculate') {
    await recalculateCustomer(customerId, 'admin_review', {}, lookbackDays);
    return { ok: true };
  }

  const currentSnapshot = await db.doc(`customerCreditProfiles/${customerId}`).get();
  if (!currentSnapshot.exists) await recalculateCustomer(customerId, 'admin_initial_review', {}, lookbackDays);
  const refreshedSnapshot = await db.doc(`customerCreditProfiles/${customerId}`).get();
  if (!refreshedSnapshot.exists) throw new HttpsError('not-found', 'Customer credit profile was not found.');
  const current = refreshedSnapshot.data()!;
  let overrides: ProfileOverrides = {};
  let auditOld: unknown = null;
  let auditNew: unknown = null;

  if (action === 'hold' || action === 'remove_hold') {
    const nextHold = action === 'hold';
    overrides = { manualHold: nextHold };
    auditOld = { manualHold: current.manualHold === true, creditStatus: current.creditStatus };
    auditNew = { manualHold: nextHold };
  } else if (action === 'override') {
    const amount = finiteAmount(request.data?.amount, 'Override amount');
    const expiresAt = requiredString(request.data?.expiresAt, 'Expiry date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || expiresAt < new Date().toISOString().slice(0, 10)) {
      throw new HttpsError('invalid-argument', 'Override expiry must be today or a future date.');
    }
    const creditOverride = {
      amount,
      reason,
      expiresAt,
      createdAt: new Date().toISOString(),
      createdBy: request.auth!.uid
    };
    overrides = { creditOverride };
    auditOld = current.creditOverride ?? null;
    auditNew = creditOverride;
  } else if (action === 'remove_override') {
    overrides = { creditOverride: null };
    auditOld = current.creditOverride ?? null;
    auditNew = null;
  } else if (action === 'approve' || action === 'manual_starter' || action === 'reject') {
    auditOld = {
      approvedCreditLimit: current.approvedCreditLimit,
      creditLimitApprovalStatus: current.creditLimitApprovalStatus
    };
  } else {
    throw new HttpsError('invalid-argument', 'Unsupported credit action.');
  }

  const calculated = await buildCustomerCredit(customerId, `admin_${action}`, overrides, lookbackDays);
  if (!calculated) throw new HttpsError('not-found', 'Customer was not found.');

  if (action === 'approve' || action === 'manual_starter') {
    const amount = finiteAmount(request.data?.amount, 'Approved amount');
    if (action === 'approve' && amount > Number(calculated.profile.calculatedCreditLimit) + 0.01) {
      throw new HttpsError('failed-precondition', 'Use an override to approve above the calculated recommendation.');
    }
    if (action === 'manual_starter') {
      const settings = await getSettings();
      const starterCap = Number(settings.creditPolicy?.starterLimitCap ?? 25000);
      if (amount > starterCap + 0.01) {
        throw new HttpsError('failed-precondition', 'The starter limit cannot exceed the configured starter cap.');
      }
      calculated.profile.manualStarterLimit = amount;
    }
    calculated.profile.approvedCreditLimit = amount;
    calculated.profile.creditLimitApprovalStatus = 'approved';
    calculated.profile.availableCredit = calculated.profile.creditStatus === 'hold' || calculated.profile.creditStatus === 'disabled'
      ? 0
      : Math.max(0, amount - Number(calculated.profile.currentOutstanding) - Number(calculated.profile.confirmedUninvoicedCreditOrders));
    calculated.summary.availableCredit = calculated.profile.availableCredit;
    auditNew = { approvedCreditLimit: amount, creditLimitApprovalStatus: 'approved' };
  } else if (action === 'reject') {
    calculated.profile.approvedCreditLimit = Math.min(
      Number(current.approvedCreditLimit || 0),
      Number(calculated.profile.approvedCreditLimit || 0)
    );
    calculated.profile.creditLimitApprovalStatus = 'rejected';
    calculated.profile.availableCredit = calculated.profile.creditStatus === 'hold' || calculated.profile.creditStatus === 'disabled'
      ? 0
      : Math.max(0, Number(calculated.profile.approvedCreditLimit || 0) - Number(calculated.profile.currentOutstanding) - Number(calculated.profile.confirmedUninvoicedCreditOrders));
    calculated.summary.availableCredit = calculated.profile.availableCredit;
    auditNew = { approvedCreditLimit: calculated.profile.approvedCreditLimit, creditLimitApprovalStatus: 'rejected' };
  }

  await writeAdminAction(
    customerId,
    request.auth!.uid,
    action,
    reason,
    auditOld,
    auditNew,
    calculated.profile,
    calculated.summary
  );
  return { ok: true, profile: calculated.profile };
});

export const updateCreditPolicy = onCall({ region: REGION }, async (request) => {
  await getAdmin(request.auth?.uid);
  const starterLimitCap = finiteAmount(request.data?.starterLimitCap, 'Starter limit cap');
  const overdueGraceDays = Number(request.data?.overdueGraceDays);
  if (!Number.isInteger(overdueGraceDays) || overdueGraceDays < 0 || overdueGraceDays > 365) {
    throw new HttpsError('invalid-argument', 'Overdue grace days must be a whole number from 0 to 365.');
  }
  const settings = await getSettings();
  const lookbackDays = getLookbackDays(request.data?.lookbackDays ?? settings.creditPolicy?.lookbackDays) ?? 90;
  const settingsId = String(settings.__docId || DEFAULT_SETTINGS_ID);
  await db.doc(`settings/${settingsId}`).set({
    creditPolicy: { starterLimitCap, overdueGraceDays, lookbackDays },
    updatedAt: new Date().toISOString()
  }, { merge: true });
  return { ok: true };
});

export const recalculateAllCustomerCredit = onCall({ region: REGION, timeoutSeconds: 540 }, async (request) => {
  await getAdmin(request.auth?.uid);
  const count = await recalculateAll('admin_bulk_review', getLookbackDays(request.data?.lookbackDays));
  logger.info('Bulk credit review complete', { count, adminUid: request.auth!.uid });
  return { ok: true, count };
});

export const removeCreditDataAfterCustomerDelete = onDocumentWritten(
  { document: 'customers/{customerId}', region: REGION, retry: true },
  async (event) => {
    if (event.data?.after.exists || !event.data?.before.exists) return;
    const batch = db.batch();
    batch.delete(db.doc(`customerCreditProfiles/${event.params.customerId}`));
    batch.delete(db.doc(`customerCreditSummaries/${event.params.customerId}`));
    await batch.commit();
  }
);
