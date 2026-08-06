import { describe, expect, it } from 'vitest';
import { calculateCustomerCredit, type CreditDocumentData } from './creditCalculation';
import { DEFAULT_SETTINGS } from './settings';

const invoice = (
  id: string,
  total: number,
  date: string,
  dueDate: string,
  creditDays: number,
  extra: CreditDocumentData = {}
) => ({
  id,
  data: {
    invoiceNumber: id,
    customerId: 'customer-1',
    totalSales: total,
    date,
    dueDate,
    savedDueDate: dueDate,
    creditDaysAtInvoice: creditDays,
    ...extra
  }
});

const payment = (invoiceId: string, amount: number, date: string) => ({
  id: `${invoiceId}-${date}`,
  data: {
    invoiceId,
    amount,
    amountAppliedToInvoice: amount,
    cashDiscount: 0,
    date
  }
});

const calculate = (
  invoices: ReturnType<typeof invoice>[],
  payments: ReturnType<typeof payment>[],
  customer: CreditDocumentData = { name: 'Customer One', tier: 'Tier 1' },
  existingProfile: CreditDocumentData = {}
) => calculateCustomerCredit({
  customerId: 'customer-1',
  customer,
  invoices,
  payments,
  settings: DEFAULT_SETTINGS as unknown as CreditDocumentData,
  existingProfile,
  reviewReason: 'test',
  now: new Date('2026-08-01T00:00:00.000Z')
});

describe('advisory credit calculation', () => {
  it('uses the requested starter ladder', () => {
    expect(calculate([], []).summary.suggestedCreditLimit).toBe(0);

    const one = invoice('one', 10_000, '2026-07-01', '2026-07-11', 10);
    expect(calculate([one], [payment('one', 10_000, '2026-07-08')]).summary.suggestedCreditLimit).toBe(6_000);

    const two = invoice('two', 20_000, '2026-07-10', '2026-07-20', 10);
    expect(calculate(
      [one, two],
      [payment('one', 10_000, '2026-07-08'), payment('two', 20_000, '2026-07-18')]
    ).summary.suggestedCreditLimit).toBe(10_000);
  });

  it('does not use current tier credit days in the rupee limit', () => {
    const invoices = [
      invoice('a', 9_000, '2026-05-01', '2026-05-11', 10),
      invoice('b', 12_000, '2026-06-01', '2026-06-11', 10),
      invoice('c', 15_000, '2026-07-01', '2026-07-11', 10)
    ];
    const payments = [
      payment('a', 9_000, '2026-05-08'),
      payment('b', 12_000, '2026-06-08'),
      payment('c', 15_000, '2026-07-08')
    ];
    const tier1 = calculate(invoices, payments, { name: 'Customer One', tier: 'Tier 1' });
    const tier4 = calculate(invoices, payments, { name: 'Customer One', tier: 'Tier 4' });

    expect(tier1.summary.calculatedCreditLimit).toBe(tier4.summary.calculatedCreditLimit);
    expect(tier1.summary.creditDays).not.toBe(tier4.summary.creditDays);
  });

  it('caps an automatic increase at 20 percent', () => {
    const invoices = [
      invoice('a', 30_000, '2026-05-01', '2026-05-11', 10),
      invoice('b', 30_000, '2026-06-01', '2026-06-11', 10),
      invoice('c', 30_000, '2026-07-01', '2026-07-11', 10)
    ];
    const payments = invoices.map((row) => payment(row.id, 30_000, row.data.dueDate));
    const result = calculate(invoices, payments, undefined, { calculatedCreditLimit: 5_000 });
    expect(result.summary.calculatedCreditLimit).toBe(6_000);
  });

  it('excludes drafts, cancelled records, returns, and uninvoiced orders from used credit', () => {
    const valid = invoice('valid', 1_000, '2026-07-20', '2026-07-30', 10);
    const draft = invoice('draft', 3_000, '2026-07-20', '2026-07-30', 10, { status: 'draft' });
    const order = invoice('order', 4_000, '2026-07-20', '2026-07-30', 10, { invoiceType: 'confirmed_order' });
    const result = calculate([valid, draft, order], []);
    expect(result.summary.usedCredit).toBe(1_000);
  });

  it('reports over-limit exposure without increasing the normal suggestion', () => {
    const open = invoice('open', 12_000, '2026-07-25', '2026-08-10', 10);
    const result = calculate([open], [], undefined, { manualStarterLimit: 5_000 });
    expect(result.summary.suggestedCreditLimit).toBe(5_000);
    expect(result.summary.usedCredit).toBe(12_000);
    expect(result.summary.overLimitAmount).toBe(7_000);
  });

  it('does not penalize payment behaviour for an unpaid amount that is not due yet', () => {
    const completed = invoice('completed', 5_000, '2026-07-01', '2026-07-11', 10);
    const futureDue = invoice('future', 20_000, '2026-07-25', '2026-08-10', 16);
    const result = calculate([completed, futureDue], [payment('completed', 5_000, '2026-07-10')]);

    expect(result.profile.creditPaymentScore).toBe(100);
  });
});
