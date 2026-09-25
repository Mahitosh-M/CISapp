import { describe, expect, it } from 'vitest';
import type { Invoice, Payment } from '../types';
import { buildCollectionHealth } from './collectionHealth';

const invoice = (id: string, shopId: 'SHOP_A' | 'SHOP_S', dueDate: string, totalSales: number): Invoice => ({
  id, invoiceNumber: id, customerId: `customer-${id}`, customerName: `Customer ${id}`, date: '2026-08-01', dueDate, savedDueDate: dueDate,
  salesAmount: totalSales, costAmount: 0, transportAmount: 0, totalSales, totalCost: 0, totalProfit: 0, notes: '', createdAt: '2026-08-01T00:00:00Z', shopId, branchSystemVersion: 1
});

const payment = (id: string, invoiceId: string, date: string, amount: number, shopId: 'SHOP_A' | 'SHOP_S' = 'SHOP_A'): Payment => ({
  id, invoiceId, invoiceNumber: invoiceId, customerId: `customer-${invoiceId}`, customerName: `Customer ${invoiceId}`, date,
  amount, amountAppliedToInvoice: amount, advanceCreatedAmount: 0, advanceAppliedAmount: 0, amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0, oldBalanceAfterPayment: 0, cashDiscount: 0, mode: 'Cash', notes: '', createdAt: `${date}T10:00:00Z`, shopId, branchSystemVersion: 1
});

describe('collection health', () => {
  it('attributes cross-branch allocations to the invoice shop, not receipt shop', () => {
    const result = buildCollectionHealth(
      [invoice('A101', 'SHOP_A', '2026-08-20', 20000), invoice('B205', 'SHOP_S', '2026-08-20', 30000)],
      [payment('payment-a', 'A101', '2026-09-08', 20000, 'SHOP_A'), payment('payment-b', 'B205', '2026-09-08', 20000, 'SHOP_A')],
      '2026-09-01', '2026-09-30'
    );
    expect(result.byShop.SHOP_A.dueCollectedCash).toBe(20000);
    expect(result.byShop.SHOP_S.dueCollectedCash).toBe(20000);
    expect(result.byShop.SHOP_S.closingOverdue).toBe(10000);
  });

  it('does not count a future invoice allocation as collection of due debt', () => {
    const result = buildCollectionHealth(
      [invoice('old', 'SHOP_A', '2026-08-20', 20000), invoice('future', 'SHOP_A', '2026-10-20', 30000)],
      [payment('old-payment', 'old', '2026-09-08', 20000), payment('future-payment', 'future', '2026-09-08', 20000)],
      '2026-09-01', '2026-09-30'
    );
    expect(result.period.dueCollectedCash).toBe(20000);
    expect(result.period.closingOverdue).toBe(0);
  });

  it('reconstructs opening overdue using payments made before the period', () => {
    const result = buildCollectionHealth(
      [invoice('historic', 'SHOP_S', '2026-08-20', 30000)],
      [payment('august', 'historic', '2026-08-25', 10000, 'SHOP_S'), payment('september', 'historic', '2026-09-12', 20000, 'SHOP_S')],
      '2026-09-01', '2026-09-30'
    );
    expect(result.period.openingOverdue).toBe(20000);
    expect(result.period.oldOverdueRecovered).toBe(20000);
    expect(result.period.closingOverdue).toBe(0);
  });

  it('keeps an approved discount out of cash collected while settling the due balance', () => {
    const discountedPayment = { ...payment('discounted', 'discount', '2026-09-05', 9000), cashDiscount: 1000 };
    const result = buildCollectionHealth(
      [invoice('discount', 'SHOP_A', '2026-08-20', 10000)],
      [discountedPayment],
      '2026-09-01', '2026-09-30'
    );
    expect(result.period.dueCollectedCash).toBe(9000);
    expect(result.period.dueSettledDiscount).toBe(1000);
    expect(result.period.uncollectedDue).toBe(0);
  });
});
