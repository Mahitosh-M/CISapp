import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCustomerCredit } from './creditCalculation';

const settings = {
  creditDays: { 'Tier 1': 30, 'Tier 2': 15, 'Tier 3': 0, 'Tier 4': 0 },
  creditPolicy: { starterLimitCap: 600, overdueGraceDays: 3 }
};

const invoice = (id: string, total: number, date: string, dueDate: string, extra = {}) => ({
  id,
  data: { customerId: 'customer-1', totalSales: total, date, dueDate, ...extra }
});

const payment = (id: string, invoiceId: string, amount: number, date: string) => ({
  id,
  data: { customerId: 'customer-1', invoiceId, amount, amountAppliedToInvoice: amount, cashDiscount: 0, date }
});

const calculate = (
  invoices: ReturnType<typeof invoice>[],
  payments: ReturnType<typeof payment>[],
  existingProfile = {},
  lookbackDays?: 60 | 90
) => calculateCustomerCredit({
  customerId: 'customer-1',
  customer: { name: 'Test Customer', tier: 'Tier 1' },
  invoices,
  payments,
  settings,
  existingProfile,
  reviewReason: 'test',
  now: new Date('2026-07-30T12:00:00.000Z'),
  lookbackDays
});

test('calculates established limit and caps an increase at 20 percent', () => {
  const invoices = [
    invoice('i1', 1000, '2026-07-01', '2026-07-20'),
    invoice('i2', 1000, '2026-06-15', '2026-07-15'),
    invoice('i3', 1000, '2026-05-15', '2026-06-15')
  ];
  const payments = [
    payment('p1', 'i1', 1000, '2026-07-20'),
    payment('p2', 'i2', 1000, '2026-07-10'),
    payment('p3', 'i3', 1000, '2026-06-15')
  ];
  const result = calculate(invoices, payments, { approvedCreditLimit: 400 });

  assert.equal(result.profile.paymentFactor, 1.1);
  assert.equal(result.profile.historyFactor, 0.5);
  assert.equal(result.profile.calculatedCreditLimit, 480);
  assert.equal(result.profile.creditLimitApprovalStatus, 'pending_calculated');
});

test('uses the starter formula and configured cap with fewer than three paid invoices', () => {
  const invoices = [
    invoice('i1', 1000, '2026-07-01', '2026-07-20'),
    invoice('i2', 2000, '2026-06-01', '2026-07-01')
  ];
  const payments = [
    payment('p1', 'i1', 1000, '2026-07-20'),
    payment('p2', 'i2', 2000, '2026-07-01')
  ];
  const result = calculate(invoices, payments);

  assert.equal(result.profile.calculatedCreditLimit, 600);
  assert.equal(result.profile.creditStatus, 'starter');
  assert.equal(result.profile.creditLimitApprovalStatus, 'pending_starter');
});

test('places overdue accounts on hold after grace and excludes sales returns', () => {
  const invoices = [
    invoice('overdue', 500, '2026-06-01', '2026-06-30'),
    invoice('return', 900, '2026-07-01', '2026-07-20', { invoiceType: 'sales return' })
  ];
  const result = calculate(invoices, [], { approvedCreditLimit: 2000 });

  assert.equal(result.profile.currentOutstanding, 500);
  assert.equal(result.profile.overdueAmount, 500);
  assert.equal(result.profile.creditStatus, 'hold');
  assert.equal(result.profile.availableCredit, 0);
});

test('keeps an approved manual starter limit when payment history is unavailable', () => {
  const result = calculate([], [], {
    approvedCreditLimit: 500,
    manualStarterLimit: 500,
    creditLimitApprovalStatus: 'approved'
  });

  assert.equal(result.profile.calculatedCreditLimit, 500);
  assert.equal(result.profile.approvedCreditLimit, 500);
  assert.equal(result.profile.availableCredit, 500);
});

test('uses the selected 60 or 90 day history window', () => {
  const invoices = [
    invoice('i1', 1000, '2026-07-01', '2026-07-20'),
    invoice('i2', 1000, '2026-06-15', '2026-07-15'),
    invoice('i3', 1000, '2026-06-01', '2026-06-20'),
    invoice('i4', 3000, '2026-05-15', '2026-06-15')
  ];
  const payments = invoices.map((row, index) => payment(`p${index + 1}`, row.id, Number(row.data.totalSales), String(row.data.dueDate)));

  const twoMonthResult = calculate(invoices, payments, {}, 60);
  const threeMonthResult = calculate(invoices, payments, {}, 90);

  assert.equal(twoMonthResult.profile.creditHistoryDays, 60);
  assert.equal(twoMonthResult.profile.totalCreditInvoiceAmountInLookback, 3000);
  assert.equal(twoMonthResult.profile.averageMonthlyCreditSales, 1500);
  assert.equal(threeMonthResult.profile.creditHistoryDays, 90);
  assert.equal(threeMonthResult.profile.totalCreditInvoiceAmountInLookback, 6000);
  assert.equal(threeMonthResult.profile.averageMonthlyCreditSales, 2000);
});
