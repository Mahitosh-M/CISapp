import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicsFor, isAdmin, validInvoice, validPayment, completedReceipt, shopForBranch, safeId, notificationEventExpired } from './notificationPolicy';

test('audiences reuse role and customer type, with no staff marketing membership', () => {
  assert.deepEqual(topicsFor({ role: 'customer', active: true }, { customerType: 'customer' }), ['customers_all', 'customers_general']);
  assert.deepEqual(topicsFor({ role: 'customer', active: true }, { customerType: 'medical' }), ['customers_all', 'customers_medicals']);
  assert.deepEqual(topicsFor({ role: 'Medical', active: true }, {}), ['customers_all', 'customers_medicals']);
  assert.deepEqual(topicsFor({ role: 'Staff', active: true }, { customerType: 'medical' }), ['staff_announcements']);
  assert.deepEqual(topicsFor({ role: 'Admin', active: true }, {}), []);
  assert.deepEqual(topicsFor({ role: 'customer', active: false }, {}), []);
  assert.deepEqual(topicsFor({ role: 'customer', active: true }), []);
});
test('only active Admin passes broadcast authority', () => {
  for (const role of ['Staff', 'customer', 'Medical', 'admin', undefined]) assert.equal(isAdmin({ role, active: true }), false);
  assert.equal(isAdmin({ role: 'Admin', active: false }), false);
  assert.equal(isAdmin({ role: 'Admin', active: true }), true);
});
test('saved invoice eligibility excludes existing non-sale and draft statuses', () => {
  assert.equal(validInvoice({ customerId: 'c1', totalSales: 2000 }), true);
  for (const recordStatus of ['draft', 'cancelled', 'canceled', 'void', 'deleted']) assert.equal(validInvoice({ customerId: 'c1', recordStatus }), false);
  for (const invoiceType of ['quotation', 'quote', 'credit_note', 'opening-balance', 'sales return', 'order', 'inter shop']) assert.equal(validInvoice({ customerId: 'c1', invoiceType }), false);
  assert.equal(validInvoice({ customerId: 'c1', isOpeningBalance: true }), false);
});
test('split receipts notify only when all persisted parts are valid and complete', () => {
  const part = { customerId: 'c1', amount: 100, splitPaymentGroupId: 'g1', splitPaymentCount: 2, splitPaymentPart: 1 };
  assert.equal(completedReceipt([part]), null);
  assert.equal(completedReceipt([part, { ...part, splitPaymentPart: 2, amount: 250 }]), 350);
  assert.equal(completedReceipt([part, part]), null);
  assert.equal(completedReceipt([part, { ...part, splitPaymentPart: 2, customerId: 'other' }]), null);
  assert.equal(validPayment({ customerId: 'c1', amount: 0 }), false);
  assert.equal(validPayment({ customerId: 'c1', amount: 100, paymentKind: 'advance_application' }), false);
  assert.equal(validPayment({ customerId: 'c1', amount: Infinity }), false);
});
test('branch mappings and document identifiers are constrained', () => {
  assert.equal(shopForBranch('SINDHANUR'), 'SHOP_S');
  assert.equal(shopForBranch('MASKI'), 'SHOP_A');
  assert.equal(shopForBranch('unknown'), undefined);
  for (const value of ['', '..', 'users/another', 'a'.repeat(161)]) assert.equal(safeId(value), false);
});

test('notification event retries stop after fifteen minutes', () => {
  const now = Date.parse('2026-09-16T10:00:00Z');
  assert.equal(notificationEventExpired('2026-09-16T09:40:00Z', now), true);
  assert.equal(notificationEventExpired('2026-09-16T09:59:00Z', now), false);
  assert.equal(notificationEventExpired('bad-date', now), true);
});
