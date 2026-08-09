import { describe, expect, it } from 'vitest';
import { allocateReceiptOldestFirst, getUnpaidInvoicesAfterPayment } from './paymentAllocation';

const pendingInvoices = [
  { id: 'oldest', pendingAmount: 100 },
  { id: 'newest', pendingAmount: 50 }
];

describe('oldest-first payment allocation', () => {
  it('does not create advance while any pending invoice remains unpaid', () => {
    const result = allocateReceiptOldestFirst(pendingInvoices, 120, 0);

    expect(result.allocations.map((row) => row.amountAppliedToInvoice)).toEqual([100, 20]);
    expect(result.allPendingInvoicesPaid).toBe(false);
    expect(result.advanceAmount).toBe(0);
  });

  it('stores only cash remaining after every pending invoice is fully paid', () => {
    const result = allocateReceiptOldestFirst(pendingInvoices, 175, 0);

    expect(result.allocations.map((row) => row.amountAppliedToInvoice)).toEqual([100, 50]);
    expect(result.allocations.map((row) => row.amount)).toEqual([100, 75]);
    expect(result.allPendingInvoicesPaid).toBe(true);
    expect(result.advanceAmount).toBe(25);
  });

  it('uses cash discount to settle invoices without treating it as advance cash', () => {
    const result = allocateReceiptOldestFirst(pendingInvoices, 140, 10);

    expect(result.appliedTotal).toBe(150);
    expect(result.appliedCashAmount).toBe(140);
    expect(result.advanceAmount).toBe(0);
  });

  it('treats the full receipt as advance only when there are no pending invoices', () => {
    const result = allocateReceiptOldestFirst([], 75, 0);

    expect(result.allPendingInvoicesPaid).toBe(true);
    expect(result.advanceAmount).toBe(75);
  });
});

describe('advance validation', () => {
  it('finds another invoice that would remain unpaid', () => {
    const unpaid = getUnpaidInvoicesAfterPayment(
      [{ id: 'one', totalSales: 100 }, { id: 'two', totalSales: 50 }],
      [{ id: 'existing', invoiceId: 'one', amount: 100, amountAppliedToInvoice: 100 }],
      { invoiceId: '', amount: 25, amountAppliedToInvoice: 0 }
    );

    expect(unpaid.map((invoice) => invoice.id)).toEqual(['two']);
  });

  it('allows excess only when existing and candidate payments settle every invoice', () => {
    const unpaid = getUnpaidInvoicesAfterPayment(
      [{ id: 'one', totalSales: 100 }, { id: 'two', totalSales: 50 }],
      [{ id: 'existing', invoiceId: 'one', amount: 100, amountAppliedToInvoice: 100 }],
      { invoiceId: 'two', amount: 75, amountAppliedToInvoice: 50 }
    );

    expect(unpaid).toEqual([]);
  });
});
