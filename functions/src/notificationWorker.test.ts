import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

test('existing worker gates private notifications by account and role, and rejects logged-out devices', () => {
  const context = { self: { addEventListener: () => undefined }, result: false };
  runInNewContext(readFileSync(resolve(process.cwd(), '../public/sw.js'), 'utf8'), context);
  const allowed = (data: object, session: object | null) => runInNewContext(`notificationAllowed(${JSON.stringify(data)}, ${JSON.stringify(session)})`, context);
  const invoice = { type: 'invoice', title: 'Invoice', body: 'Saved', recipientUid: 'customer-a' };
  assert.equal(allowed(invoice, { uid: 'customer-a', role: 'customer' }), true);
  assert.equal(allowed(invoice, { uid: 'customer-b', role: 'customer' }), false);
  assert.equal(allowed(invoice, { uid: 'customer-a', role: 'Staff' }), false);
  assert.equal(allowed(invoice, null), false);
  const order = { ...invoice, type: 'order', recipientUid: 'staff-a' };
  assert.equal(allowed(order, { uid: 'staff-a', role: 'Staff' }), true);
  assert.equal(allowed(order, { uid: 'other-staff', role: 'Staff' }), false);
  const broadcast = { type: 'broadcast', title: 'Hello', body: 'Offer', topic: 'customers_all' };
  assert.equal(allowed(broadcast, { uid: 'staff-a', role: 'Staff' }), false);
  assert.equal(allowed(broadcast, { uid: 'customer-a', role: 'Medical' }), true);
  assert.equal(allowed({ ...broadcast, topic: 'staff_announcements' }, { uid: 'customer-a', role: 'customer' }), false);
});
