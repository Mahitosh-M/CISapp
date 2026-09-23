import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as policy from './notificationPolicy';

// Exercise the exported handlers against a small in-memory Firestore/FCM boundary.
// No Firebase project, credentials, or external sends are used by these tests.
function harness(initial: Record<string, Record<string, unknown>>) {
  const rows = new Map(Object.entries(initial));
  const sent: Record<string, unknown>[] = [];
  const topicCalls: string[] = [];
  const snapshot = (path: string) => ({ id: path.split('/').pop(), exists: rows.has(path), data: () => rows.get(path), ref: doc(path) });
  const doc = (path: string) => ({
    id: path.split('/').pop(), path, get: async () => snapshot(path),
    create: async (data: Record<string, unknown>) => { if (rows.has(path)) throw { code: 6 }; rows.set(path, data); }
  });
  const collection = (path: string, filters: [string, unknown][] = [], max = Infinity): any => ({
    doc: (id: string) => doc(`${path}/${id}`),
    where: (key: string, _operator: string, value: unknown) => collection(path, [...filters, [key, value]], max),
    limit: (count: number) => collection(path, filters, count),
    get: async () => {
      const docs = [...rows.keys()].filter(key => key.startsWith(`${path}/`) && key.slice(path.length + 1).indexOf('/') < 0)
        .filter(key => filters.every(([field, value]) => rows.get(key)?.[field] === value)).slice(0, max).map(snapshot);
      return { docs, size: docs.length, empty: !docs.length };
    }
  });
  const db = { doc, collection, runTransaction: async (callback: (transaction: any) => Promise<unknown>) => callback({
    get: async (ref: { path: string }) => snapshot(ref.path),
    set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge: boolean }) => rows.set(ref.path, options?.merge ? { ...rows.get(ref.path), ...data } : data),
    update: (ref: { path: string }, data: Record<string, unknown>) => rows.set(ref.path, { ...rows.get(ref.path), ...data }),
    delete: (ref: { path: string }) => rows.delete(ref.path)
  }) };
  const messaging = {
    sendEachForMulticast: async (message: Record<string, unknown>) => { sent.push(message); return { responses: (message.tokens as string[]).map(() => ({ success: true })), failureCount: 0 }; },
    send: async (message: Record<string, unknown>) => { sent.push(message); return 'message'; },
    unsubscribeFromTopic: async (_token: string, topic: string) => { topicCalls.push(`remove:${topic}`); return { failureCount: 0 }; },
    subscribeToTopic: async (_token: string, topic: string) => { topicCalls.push(`add:${topic}`); return { failureCount: 0 }; }
  };
  class HttpsError extends Error { constructor(public code: string, message: string) { super(message); } }
  const functions = { onCall: (_options: unknown, handler: unknown) => handler, onRequest: (_options: unknown, handler: unknown) => handler, HttpsError };
  const exports: Record<string, any> = {};
  runInNewContext(readFileSync(resolve(__dirname, 'notifications.js'), 'utf8'), {
    exports, console, Buffer, require: (name: string) => {
      if (name === 'firebase-admin/firestore') return { getFirestore: () => db, FieldValue: { serverTimestamp: () => 1 } };
      if (name === 'firebase-admin/messaging') return { getMessaging: () => messaging };
      if (name === 'firebase-functions/v2/https') return functions;
      if (name === 'firebase-functions/v2/firestore') return { onDocumentCreated: functions.onCall, onDocumentWritten: functions.onCall };
      if (name === 'firebase-functions') return { logger: { warn: () => undefined } };
      if (name === './notificationPolicy') return policy;
      return require(name);
    }
  });
  return { handlers: exports, rows, sent, topicCalls, messaging };
}
const user = (uid: string, role: string, customerId = 'customer-1') => ({ uid, role, active: true, customerId });
const event = (data: object, params: object) => ({ data: { data: () => data }, params });

test('broadcast handler denies unauthenticated, staff and customers even when called directly', async () => {
  const h = harness({ 'users/staff': user('staff', 'Staff'), 'users/customer': user('customer', 'customer'), 'users/admin': user('admin', 'Admin') });
  const data = { audience: 'customers_all', title: 'Hello', body: 'Notice', requestId: 'abcdefgh-12345678' };
  for (const uid of [undefined, 'staff', 'customer']) {
    await assert.rejects(h.handlers.sendNotificationBroadcast({ auth: uid ? { uid } : undefined, data }), (error: any) => ['unauthenticated', 'permission-denied'].includes(error.code));
  }
  assert.equal(h.sent.length, 0);
  await h.handlers.sendNotificationBroadcast({ auth: { uid: 'admin' }, data });
  await h.handlers.sendNotificationBroadcast({ auth: { uid: 'admin' }, data });
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].topic, 'customers_all');
});

test('invoice targets only linked customer devices and ignores repeated event deliveries', async () => {
  const h = harness({
    'users/a': user('a', 'customer'), 'users/b': user('b', 'Medical', 'customer-2'), 'users/staff': user('staff', 'Staff'),
    'users/a/notificationDevices/d1': { token: 'token-a', active: true }, 'users/b/notificationDevices/d2': { token: 'token-b', active: true },
    'users/staff/notificationDevices/d3': { token: 'token-staff', active: true }
  });
  const invoice = event({ customerId: 'customer-1', invoiceNumber: 'INV-1' }, { invoiceId: 'invoice-1' });
  await h.handlers.notifyInvoiceCreated(invoice); await h.handlers.notifyInvoiceCreated(invoice);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(Array.from(h.sent[0].tokens as string[]), ['token-a']);
  assert.equal((h.sent[0].data as any).recipientUid, 'a');
  assert.equal(h.sent[0].topic, undefined);
});

test('split receipt waits for all parts and sends the saved sum once', async () => {
  const first = { customerId: 'customer-1', amount: 200, splitPaymentCount: 2, splitPaymentPart: 1, splitPaymentGroupId: 'group-1' };
  const second = { ...first, amount: 300, splitPaymentPart: 2 };
  const h = harness({ 'users/a': user('a', 'Medical'), 'users/a/notificationDevices/d1': { token: 'token-a', active: true }, 'payments/p1': first });
  await h.handlers.notifyPaymentCreated(event(first, { paymentId: 'p1' }));
  assert.equal(h.sent.length, 0);
  h.rows.set('payments/p2', second);
  await h.handlers.notifyPaymentCreated(event(second, { paymentId: 'p2' }));
  await h.handlers.notifyPaymentCreated(event(first, { paymentId: 'p1' }));
  assert.equal(h.sent.length, 1);
  assert.match((h.sent[0].data as any).body, /500/);
});

test('registration replaces all old topics and logout removes the device', async () => {
  const h = harness({ 'users/a': user('a', 'customer'), 'customers/customer-1': { customerType: 'medical' } });
  const data = { token: 'long-test-device-token-123456', remove: false };
  await h.handlers.syncNotificationDevice({ auth: { uid: 'a' }, data });
  assert.equal(h.topicCalls.filter(call => call.startsWith('remove:')).length, 4);
  assert.deepEqual(h.topicCalls.filter(call => call.startsWith('add:')), ['add:customers_all', 'add:customers_medicals']);
  await h.handlers.syncNotificationDevice({ auth: { uid: 'a' }, data: { ...data, remove: true } });
  assert.equal([...h.rows.keys()].some(key => key.includes('/notificationDevices/')), false);
});

test('order notification maps SINDHANUR only to active SHOP_S staff', async () => {
  const h = harness({
    'customers/customer-1': { branchId: 'SINDHANUR' },
    'users/s': { ...user('s', 'Staff'), shopId: 'SHOP_S' }, 'users/a': { ...user('a', 'Staff'), shopId: 'SHOP_A' },
    'users/s/notificationDevices/d1': { token: 'sindhanur', active: true }, 'users/a/notificationDevices/d2': { token: 'maski', active: true }
  });
  const response = { status: () => response, json: () => undefined, end: () => undefined, send: () => undefined };
  await h.handlers.notifyStaffOfCustomerOrder({ method: 'POST', body: { orderId: 'order-1', customerId: 'customer-1' }, rawBody: Buffer.from('{}') }, response);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(Array.from(h.sent[0].tokens as string[]), ['sindhanur']);
});


test('customer type changes replace the previous marketing audience', async () => {
  const h = harness({ 'users/a': user('a', 'customer'), 'customers/customer-1': { customerType: 'customer' } });
  await h.handlers.syncNotificationDevice({ auth: { uid: 'a' }, data: { token: 'long-test-device-token-123456', remove: false } });
  h.topicCalls.length = 0;
  h.rows.set('customers/customer-1', { customerType: 'medical' });
  await h.handlers.notificationCustomerGroupChanged({
    params: { customerId: 'customer-1' }, data: {
      before: { exists: true, data: () => ({ customerType: 'customer' }) },
      after: { exists: true, data: () => ({ customerType: 'medical' }) }
    }
  });
  assert.ok(h.topicCalls.includes('remove:customers_general'));
  assert.deepEqual(h.topicCalls.filter(call => call.startsWith('add:')), ['add:customers_all', 'add:customers_medicals']);
});

test('permanently expired tokens are removed instead of retrying membership forever', async () => {
  const h = harness({ 'users/a': user('a', 'customer'), 'customers/customer-1': { customerType: 'customer' } });
  const data = { token: 'long-test-device-token-123456', remove: false };
  await h.handlers.syncNotificationDevice({ auth: { uid: 'a' }, data });
  h.rows.set('customers/customer-1', { customerType: 'medical' });
  h.messaging.unsubscribeFromTopic = async () => ({ failureCount: 1, errors: [{ error: { code: 'messaging/registration-token-not-registered' } }] });
  await assert.rejects(h.handlers.syncNotificationDevice({ auth: { uid: 'a' }, data }), (error: any) => error.code === 'not-found');
  assert.equal([...h.rows.keys()].some(key => key.includes('/notificationDevices/') || key.startsWith('notificationTokenOwners/')), false);
});

test('repeat registration performs no repeated topic subscriptions', async () => {
  const h = harness({ 'users/a': user('a', 'customer'), 'customers/customer-1': { customerType: 'customer' } });
  const request = { auth: { uid: 'a' }, data: { token: 'long-test-device-token-123456', remove: false } };
  await h.handlers.syncNotificationDevice(request);
  h.topicCalls.length = 0;
  await h.handlers.syncNotificationDevice(request);
  assert.equal(h.topicCalls.length, 0);
});
