import { createHash, randomUUID } from 'node:crypto';
import { getFirestore, FieldValue, DocumentReference } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { TOPICS, Topic, Row, topicsFor, isCustomer, isAdmin, validInvoice, validPayment, completedReceipt, shopForBranch, safeId, notificationEventExpired } from './notificationPolicy';

const options = { region: 'asia-south1', minInstances: 0, maxInstances: 2, memory: '256MiB' as const, cpu: 'gcf_gen1' as const, concurrency: 1, timeoutSeconds: 120 };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const devices = (uid: string) => getFirestore().collection(`users/${uid}/notificationDevices`);
const permanent = (code?: string) => ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code || '');

async function profileFor(uid: string): Promise<Row> {
  const direct = await getFirestore().doc(`users/${uid}`).get();
  if (direct.exists) return direct.data()?.uid === uid ? direct.data()! : {};
  const legacy = await getFirestore().collection('users').where('uid', '==', uid).limit(1).get();
  return legacy.docs[0]?.data() || {};
}
async function membership(uid: string): Promise<Topic[]> {
  const profile = await profileFor(uid);
  const customer = isCustomer(profile) && safeId(profile.customerId)
    ? (await getFirestore().doc(`customers/${profile.customerId}`).get()).data() : undefined;
  return topicsFor(profile, customer);
}
function fields(data: unknown, allowed: string[]): asserts data is Row {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key))) {
    throw new HttpsError('invalid-argument', 'Invalid notification request.');
  }
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new HttpsError('invalid-argument', 'Notification text is empty, malformed or too long.');
  }
  return value.trim();
}

// A token has one owner, including on shared browsers. Serialize topic changes using a short lease.
async function syncDevice(uid: string, token: string, remove: boolean, existingOnly = false) {
  const db = getFirestore();
  const id = hash(token);
  const ownerRef = db.doc(`notificationTokenOwners/${id}`);
  const lease = randomUUID();
  const previous = await db.runTransaction(async transaction => {
    const owner = (await transaction.get(ownerRef)).data();
    if ((remove || existingOnly) && owner?.uid !== uid) return null;
    if (Number(owner?.leaseUntil) > Date.now()) throw new HttpsError('aborted', 'Notification registration is busy. Please retry.');
    transaction.set(ownerRef, { uid, lease, leaseUntil: Date.now() + 150_000 });
    if (safeId(owner?.uid)) {
      if (owner.uid === uid) transaction.set(devices(uid).doc(id), { token, active: false }, { merge: true });
      else transaction.delete(devices(owner.uid).doc(id));
    }
    return owner?.uid || uid;
  });
  if (previous === null) return [];
  const rejectExpired = async (code?: string) => {
    if (!permanent(code)) return;
    await db.runTransaction(async transaction => {
      const owner = (await transaction.get(ownerRef)).data();
      if (owner?.lease === lease) {
        transaction.delete(ownerRef);
        transaction.delete(devices(uid).doc(id));
      }
    });
    throw new HttpsError('not-found', 'Notification token expired. Please enable alerts again.');
  };
  try {
    for (const topic of TOPICS) {
      const result = await getMessaging().unsubscribeFromTopic(token, topic);
      if (result.failureCount) {
        await rejectExpired(result.errors[0]?.error.code);
        throw new Error('Unable to remove notification topic.');
      }
    }
    const topics = remove ? [] : await membership(uid);
    for (const topic of topics) {
      const result = await getMessaging().subscribeToTopic(token, topic);
      if (result.failureCount) {
        await rejectExpired(result.errors[0]?.error.code);
        throw new Error('Unable to register notification topic.');
      }
    }
    await db.runTransaction(async transaction => {
      const owner = (await transaction.get(ownerRef)).data();
      if (owner?.lease !== lease) throw new Error('Notification registration lease changed.');
      if (remove) {
        transaction.delete(ownerRef);
        transaction.delete(devices(uid).doc(id));
      }
      else {
        transaction.set(devices(uid).doc(id), { token, active: true, platform: 'web', topics, updatedAt: FieldValue.serverTimestamp() });
        transaction.set(ownerRef, { uid, leaseUntil: 0 });
      }
    });
    return topics;
  } catch (error) {
    // Keep a failed registration inactive. Retrying can safely repair its topics.
    await db.runTransaction(async transaction => {
      const owner = (await transaction.get(ownerRef)).data();
      if (owner?.lease === lease) transaction.update(ownerRef, { leaseUntil: 0 });
    });
    throw error;
  }
}

export const syncNotificationDevice = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to enable notifications.');
  fields(request.data, ['token', 'remove']);
  const token = text(request.data.token, 4096);
  if (token.length < 20 || /\s/.test(token) || typeof request.data.remove !== 'boolean') throw new HttpsError('invalid-argument', 'Invalid device registration.');
  const uid = request.auth.uid;
  if (!request.data.remove) {
    const profile = await profileFor(uid);
    if (profile.active !== true || !['Admin', 'Staff', 'customer', 'Medical'].includes(String(profile.role))) throw new HttpsError('permission-denied', 'An active app account is required.');
    const existing = await devices(uid).limit(11).get();
    const currentDevice = existing.docs.find(doc => doc.id === hash(token));
    if (currentDevice?.data().active === true) {
      const topics = await membership(uid);
      const owner = (await getFirestore().doc(`notificationTokenOwners/${hash(token)}`).get()).data();
      if (owner?.uid === uid && !owner.leaseUntil && JSON.stringify(currentDevice.data().topics) === JSON.stringify(topics)) {
        return { topics }; // No topic churn or writes on an unchanged installation.
      }
    }
    if (existing.size >= 10 && !existing.docs.some(doc => doc.id === hash(token))) throw new HttpsError('resource-exhausted', 'Ten devices are already registered for this account.');
  }
  return { topics: await syncDevice(uid, token, request.data.remove) };
});

async function refreshDevices(uid: string) {
  if (!safeId(uid)) return;
  const rows = await devices(uid).get();
  const active = (await profileFor(uid)).active === true;
  for (const device of rows.docs) {
    try { await syncDevice(uid, device.data().token, !active, true); }
    catch (error) {
      if (!(error instanceof HttpsError) || error.code !== 'not-found') throw error;
      // Permanently expired devices have already been removed; do not retry them.
    }
  }
}
export const notificationUserChanged = onDocumentWritten({ ...options, document: 'users/{userId}', retry: true }, async event => {
  if (notificationEventExpired(event.time)) return;
  const before = event.data?.before.data() || {};
  const after = event.data?.after.data() || {};
  if (['uid', 'role', 'active', 'customerId'].every(key => before[key] === after[key])) return;
  for (const uid of new Set([before.uid, after.uid].filter(safeId))) await refreshDevices(uid);
});
export const notificationCustomerGroupChanged = onDocumentWritten({ ...options, document: 'customers/{customerId}', retry: true }, async event => {
  if (notificationEventExpired(event.time)) return;
  if (event.data?.before.exists === event.data?.after.exists && event.data?.before.data()?.customerType === event.data?.after.data()?.customerType) return;
  const users = await getFirestore().collection('users').where('customerId', '==', event.params.customerId).get();
  for (const user of users.docs) if (safeId(user.data().uid)) await refreshDevices(user.data().uid);
});

// Claim BEFORE sending: suppress duplicate event deliveries. A crash after this claim may lose a push;
// FCM and Firestore cannot be committed atomically. Business records are never changed.
async function claim(key: string): Promise<boolean> {
  try {
    await getFirestore().doc(`notificationEvents/${hash(key)}`).create({ createdAt: FieldValue.serverTimestamp() });
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 6) return false;
    throw error;
  }
}
async function removeInvalid(ref: DocumentReference, uid: string) {
  const index = getFirestore().doc(`notificationTokenOwners/${ref.id}`);
  await getFirestore().runTransaction(async transaction => {
    const owner = (await transaction.get(index)).data();
    // Do not delete a registration that moved to another user while the send was running.
    if (owner?.uid === uid && !owner.leaseUntil) {
      transaction.delete(ref);
      transaction.delete(index);
    }
  });
}
async function sendPrivate(uid: string, data: Record<string, string>) {
  const registrations = await devices(uid).where('active', '==', true).get();
  for (let start = 0; start < registrations.size; start += 500) {
    const chunk = registrations.docs.slice(start, start + 500);
    const result = await getMessaging().sendEachForMulticast({
      tokens: chunk.map(doc => doc.data().token), data: { ...data, recipientUid: uid },
      webpush: { headers: { TTL: '3600', Urgency: 'normal' } }
    });
    for (let i = 0; i < result.responses.length; i++) {
      if (permanent(result.responses[i].error?.code)) await removeInvalid(chunk[i].ref, uid);
    }
    if (result.failureCount) logger.warn('Some notification devices could not be reached.', { failed: result.failureCount });
  }
}
async function customerRecipients(customerId: string): Promise<string[]> {
  if (!safeId(customerId)) return [];
  const users = await getFirestore().collection('users').where('customerId', '==', customerId).get();
  const ids = new Set<string>();
  for (const row of users.docs) {
    const uid = row.data().uid;
    if (!safeId(uid) || !isCustomer(row.data())) continue;
    // Recheck canonical identity; a legacy duplicate profile must not expand private access.
    const profile = await profileFor(uid);
    if (isCustomer(profile) && profile.customerId === customerId) ids.add(uid);
  }
  return [...ids];
}
export const notifyInvoiceCreated = onDocumentCreated({ ...options, document: 'invoices/{invoiceId}', retry: true }, async event => {
  if (notificationEventExpired(event.time)) return;
  const invoice = event.data?.data();
  if (!invoice || !validInvoice(invoice)) return;
  const recipients = await customerRecipients(invoice.customerId);
  if (!recipients.length || !await claim(`invoice:${event.params.invoiceId}`)) return;
  const number = String(invoice.invoiceNumber || '').slice(0, 80);
  for (const uid of recipients) await sendPrivate(uid, { title: 'New Invoice Created', body: number ? `Invoice ${number} has been created.` : 'A new invoice has been created.', type: 'invoice', entityId: event.params.invoiceId });
});
export const notifyPaymentCreated = onDocumentCreated({ ...options, document: 'payments/{paymentId}', retry: true }, async event => {
  if (notificationEventExpired(event.time)) return;
  const payment = event.data?.data();
  if (!payment || !validPayment(payment)) return;
  let amount = payment.amount as number;
  let key = `payment:${event.params.paymentId}`;
  if (payment.splitPaymentGroupId) {
    if (!safeId(payment.splitPaymentGroupId)) return;
    // Payments.tsx persists split parts sequentially. Only the final committed part needs
    // to read the group, avoiding N repeated N-document queries for a single receipt.
    if (!Number.isInteger(payment.splitPaymentCount) || payment.splitPaymentCount < 1 ||
        payment.splitPaymentCount > 500 || payment.splitPaymentPart !== payment.splitPaymentCount) return;
    const parts = await getFirestore().collection('payments').where('splitPaymentGroupId', '==', payment.splitPaymentGroupId).limit(501).get();
    const total = completedReceipt(parts.docs.map(doc => doc.data()));
    if (total === null) return;
    amount = total;
    key = `receipt:${payment.splitPaymentGroupId}`;
  }
  const recipients = await customerRecipients(payment.customerId);
  if (!recipients.length || !await claim(key)) return;
  for (const uid of recipients) await sendPrivate(uid, { title: 'Payment Received', body: `Payment of ₹${amount.toLocaleString('en-IN')} has been received.`, type: 'payment', entityId: event.params.paymentId });
});

export const sendNotificationBroadcast = onCall(options, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!isAdmin(await profileFor(request.auth.uid))) throw new HttpsError('permission-denied', 'Only an active Admin can send announcements.');
  fields(request.data, ['audience', 'title', 'body', 'requestId']);
  if (!TOPICS.includes(request.data.audience as Topic)) throw new HttpsError('invalid-argument', 'Select a valid audience.');
  const title = text(request.data.title, 120);
  const body = text(request.data.body, 500);
  if (Buffer.byteLength(JSON.stringify({ title, body, type: 'broadcast', topic: request.data.audience }), 'utf8') > 1900) throw new HttpsError('invalid-argument', 'Message is too large for a topic notification. Please shorten it.');
  const requestId = text(request.data.requestId, 80);
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw new HttpsError('invalid-argument', 'Invalid send identifier.');
  if (!await claim(`broadcast:${request.auth.uid}:${requestId}`)) return { accepted: true, duplicate: true };
  await getMessaging().send({ topic: request.data.audience as Topic, data: { title, body, type: 'broadcast', topic: request.data.audience as string }, webpush: { headers: { TTL: '3600' } } });
  return { accepted: true };
});

// IAM-private: only the Orderapp trigger service account receives Cloud Run Invoker on this function.
// No public client credential or cross-project Firestore read access is needed.
export const notifyStaffOfCustomerOrder = onRequest({ ...options, invoker: 'private', cors: false }, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).end(); return; }
  try {
    fields(request.body, ['orderId', 'customerId']);
    if (!safeId(request.body.orderId) || !safeId(request.body.customerId) || request.rawBody.length > 2048) throw new Error('Invalid order event.');
  } catch { response.status(400).send('Invalid order event.'); return; }
  const customer = (await getFirestore().doc(`customers/${request.body.customerId}`).get()).data();
  const shop = shopForBranch(customer?.branchId);
  const users = await getFirestore().collection('users').where('role', '==', 'Staff').get();
  const recipients = new Set<string>();
  for (const row of users.docs) {
    const uid = row.data().uid;
    if (!safeId(uid)) continue;
    const profile = await profileFor(uid);
    if (profile.active === true && profile.role === 'Staff' && (!shop || profile.shopId === shop)) recipients.add(uid);
  }
  if (recipients.size && await claim(`order:${request.body.orderId}`)) {
    for (const uid of recipients) await sendPrivate(uid, { title: 'New Customer Order', body: 'A new customer order has been received. Open Orderapp to view.', type: 'order', entityId: request.body.orderId });
  }
  response.status(200).json({ accepted: true });
});
