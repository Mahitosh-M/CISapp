import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { calculatePaymentPcAward, type PcDocumentData } from './pcAward';

initializeApp();

const db = getFirestore();
const adminAuth = getAuth();
const REGION = 'asia-south1';

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const creditProtectedPcOnPayment = onDocumentWritten(
  { document: 'payments/{paymentId}', region: REGION },
  async (event) => {
    const change = event.data;
    if (!change?.after.exists) return;

    const paymentId = event.params.paymentId;
    const afterPayment = change.after.data() as PcDocumentData;
    const invoiceId = String(afterPayment.invoiceId || '');
    if (!invoiceId) return;

    const invoiceRef = db.collection('invoices').doc(invoiceId);
    const [invoiceSnapshot, paymentSnapshots, settingsSnapshot] = await Promise.all([
      invoiceRef.get(),
      db.collection('payments').where('invoiceId', '==', invoiceId).get(),
      db.collection('settings').doc('appSettings').get()
    ]);
    if (!invoiceSnapshot.exists) return;

    const invoice = invoiceSnapshot.data() as PcDocumentData;
    const customerId = String(invoice.customerId || afterPayment.customerId || '');
    if (!customerId) return;
    const customerSnapshot = await db.collection('customers').doc(customerId).get();
    if (!customerSnapshot.exists) return;

    const afterPayments = paymentSnapshots.docs.map((snapshot) => snapshot.data() as PcDocumentData);
    const beforePayments = paymentSnapshots.docs
      .filter((snapshot) => snapshot.id !== paymentId)
      .map((snapshot) => snapshot.data() as PcDocumentData);
    if (change.before.exists && String(change.before.data()?.invoiceId || '') === invoiceId) {
      beforePayments.push(change.before.data() as PcDocumentData);
    }

    const settings = (settingsSnapshot.data() || {}) as PcDocumentData;
    const customer = customerSnapshot.data() as PcDocumentData;
    const beforeAward = calculatePaymentPcAward(invoice, beforePayments, customer, settings);
    const afterAward = calculatePaymentPcAward(invoice, afterPayments, customer, settings);
    if (!afterAward.eligible || beforeAward.eligible || afterAward.points <= 0) return;

    const timestamp = new Date().toISOString();
    const balanceRef = db.collection('pcBalances').doc(customerId);
    const ledgerRef = db.collection('loyaltyLedger').doc(`${customerId}_${invoiceId}_invoice_pc`);

    await db.runTransaction(async (transaction) => {
      const [ledgerSnapshot, balanceSnapshot] = await Promise.all([
        transaction.get(ledgerRef),
        transaction.get(balanceRef)
      ]);
      if (ledgerSnapshot.exists) return;

      if (balanceSnapshot.exists) {
        const balance = balanceSnapshot.data() || {};
        transaction.update(balanceRef, {
          availablePc: Math.max(0, numberOrZero(balance.availablePc)) + afterAward.points,
          incomingPc: Math.max(0, numberOrZero(balance.incomingPc)) + afterAward.points,
          updatedAt: timestamp
        });
      } else {
        transaction.set(balanceRef, {
          customerId,
          availablePc: afterAward.points,
          incomingPc: afterAward.points,
          redeemedPc: 0,
          protectedAt: timestamp,
          updatedAt: timestamp
        });
      }

      transaction.set(ledgerRef, {
        customerId,
        type: 'on_time_payment',
        points: afterAward.points,
        reason: `Invoice ${String(invoice.invoiceNumber || invoiceId)} paid on time`,
        referenceId: invoiceId,
        month: afterAward.fullPaymentDate.slice(0, 7),
        createdAt: timestamp
      });
    });

    logger.info('Credited protected PC after invoice payment.', {
      customerId,
      invoiceId,
      points: afterAward.points
    });
  }
);

const getAdmin = async (uid?: string) => {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in before performing this Admin action.');
  const profile = await db.doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.active !== true || profile.data()?.role !== 'Admin') {
    throw new HttpsError('permission-denied', 'Only an active Admin can perform this action.');
  }
};

const requiredString = (value: unknown, label: string, maxLength = 500) => {
  const clean = String(value || '').trim();
  if (!clean) throw new HttpsError('invalid-argument', `${label} is required.`);
  if (clean.length > maxLength) throw new HttpsError('invalid-argument', `${label} is too long.`);
  return clean;
};

export const deleteManagedUser = onCall({ region: REGION }, async (request) => {
  await getAdmin(request.auth?.uid);

  const profileId = requiredString(request.data?.profileId, 'User profile', 160);
  const uid = requiredString(request.data?.uid, 'User UID', 160);

  if (profileId.includes('/') || uid.includes('/')) {
    throw new HttpsError('invalid-argument', 'User identifiers are invalid.');
  }

  if (uid === request.auth?.uid) {
    throw new HttpsError('failed-precondition', 'You cannot delete your own active Admin account.');
  }

  const profileRef = db.collection('users').doc(profileId);
  const profile = await profileRef.get();

  if (!profile.exists || profile.data()?.uid !== uid) {
    throw new HttpsError('not-found', 'The selected user profile was not found.');
  }

  await profileRef.update({
    active: false,
    updatedAt: new Date().toISOString()
  });

  try {
    await adminAuth.deleteUser(uid);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

    if (code !== 'auth/user-not-found') {
      logger.error('Unable to delete Firebase Auth user.', { uid, error });
      throw new HttpsError('internal', 'Unable to delete the login credentials. Please retry.');
    }
  }

  await profileRef.delete();
  return { ok: true };
});
