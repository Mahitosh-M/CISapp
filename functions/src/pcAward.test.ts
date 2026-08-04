import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePaymentPcAward } from './pcAward';

const settings = {
  giftPercentages: { 'Tier 1': 3 },
  creditDays: { 'Tier 1': 15 },
  paymentBuffers: { 'Tier 1': 3 },
  loyaltySettings: { onTimePaymentBonus: 5 }
};
const customer = { tier: 'Tier 1' };
const invoice = { date: '2026-08-01', dueDate: '2026-08-16', totalSales: 1000, totalProfit: 200 };

test('awards PC when cumulative payments complete an invoice by its deadline', () => {
  const result = calculatePaymentPcAward(invoice, [
    { amountAppliedToInvoice: 400, cashDiscount: 0, date: '2026-08-10' },
    { amountAppliedToInvoice: 590, cashDiscount: 10, date: '2026-08-18' }
  ], customer, settings);

  assert.equal(result.eligible, true);
  assert.equal(result.points, 11);
  assert.equal(result.fullPaymentDate, '2026-08-18');
});

test('does not award PC before full payment or after the buffered deadline', () => {
  assert.equal(calculatePaymentPcAward(invoice, [
    { amountAppliedToInvoice: 900, date: '2026-08-10' }
  ], customer, settings).points, 0);

  assert.equal(calculatePaymentPcAward(invoice, [
    { amountAppliedToInvoice: 1000, date: '2026-08-20' }
  ], customer, settings).points, 0);
});
