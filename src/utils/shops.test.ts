import { describe, expect, it } from 'vitest';
import type { Payment } from '../types';
import {
  BRANCH_SYSTEM_VERSION,
  buildShopContributionRows,
  buildShopCashAdjustments,
  filterRecordsForShopScope,
  getContributionPercent,
  getShopName,
  getNextCashSyncedAmount,
  resolveNewRecordShopId
} from './shops';

const branchPayment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'payment-1',
  invoiceId: 'invoice-1',
  invoiceNumber: 'INV-1',
  customerId: 'customer-1',
  customerName: 'Customer One',
  date: '2026-08-10',
  amount: 5000,
  amountAppliedToInvoice: 5000,
  advanceCreatedAmount: 0,
  advanceAppliedAmount: 0,
  paymentKind: 'receipt',
  amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0,
  oldBalanceAfterPayment: 0,
  cashDiscount: 0,
  mode: 'Cash',
  notes: '',
  createdAt: '2026-08-17T10:00:00.000Z',
  shopId: 'SHOP_A',
  branchSystemVersion: BRANCH_SYSTEM_VERSION,
  affectsShopCash: true,
  cashSyncedAmount: 5000,
  ...overrides
});

describe('shop cash delta policy', () => {
  it('applies a new branch receipt even when its business date is backdated', () => {
    const payment = branchPayment({ cashSyncedAmount: undefined });

    expect(getNextCashSyncedAmount(payment)).toBe(5000);
    expect(buildShopCashAdjustments(undefined, payment)).toEqual([{ shopId: 'SHOP_A', amount: 5000 }]);
  });

  it('uses only the amount difference for an edit in the same shop', () => {
    expect(buildShopCashAdjustments(branchPayment(), branchPayment({ amount: 4000 })))
      .toEqual([{ shopId: 'SHOP_A', amount: -1000 }]);
    expect(buildShopCashAdjustments(branchPayment({ amount: 4000, cashSyncedAmount: 4000 }), branchPayment({ amount: 7000 })))
      .toEqual([{ shopId: 'SHOP_A', amount: 3000 }]);
    expect(buildShopCashAdjustments(branchPayment(), branchPayment())).toEqual([]);
  });

  it('reverses the old shop and applies the new shop independently', () => {
    expect(buildShopCashAdjustments(branchPayment(), branchPayment({ shopId: 'SHOP_S' }))).toEqual([
      { shopId: 'SHOP_A', amount: -5000 },
      { shopId: 'SHOP_S', amount: 5000 }
    ]);
    expect(buildShopCashAdjustments(branchPayment(), branchPayment({ shopId: 'SHOP_S', amount: 4000 }))).toEqual([
      { shopId: 'SHOP_A', amount: -5000 },
      { shopId: 'SHOP_S', amount: 4000 }
    ]);
  });

  it('reverses delete and true-to-false changes, then applies false-to-true once', () => {
    expect(buildShopCashAdjustments(branchPayment(), undefined)).toEqual([{ shopId: 'SHOP_A', amount: -5000 }]);
    expect(buildShopCashAdjustments(branchPayment(), branchPayment({ affectsShopCash: false })))
      .toEqual([{ shopId: 'SHOP_A', amount: -5000 }]);
    expect(buildShopCashAdjustments(
      branchPayment({ affectsShopCash: false, cashSyncedAmount: 0 }),
      branchPayment({ affectsShopCash: true })
    )).toEqual([{ shopId: 'SHOP_A', amount: 5000 }]);
  });

  it('never syncs legacy records, backfill receipts, or automatic advance applications', () => {
    expect(buildShopCashAdjustments(undefined, branchPayment({ branchSystemVersion: undefined, shopId: undefined }))).toEqual([]);
    expect(buildShopCashAdjustments(undefined, branchPayment({ affectsShopCash: false }))).toEqual([]);
    expect(buildShopCashAdjustments(undefined, branchPayment({ paymentKind: 'advance_application' }))).toEqual([]);
  });
});

describe('shop analytics helpers', () => {
  const records = [
    { id: 'legacy' },
    { id: 'a', branchSystemVersion: 1, shopId: 'SHOP_A' as const },
    { id: 's', branchSystemVersion: 1, shopId: 'SHOP_S' as const },
    { id: 'invalid', branchSystemVersion: 2, shopId: 'SHOP_A' as const }
  ];

  it('keeps every legacy and branch record in Overall but never guesses a legacy shop', () => {
    expect(filterRecordsForShopScope(records, 'overall').map((record) => record.id)).toEqual(['legacy', 'a', 's', 'invalid']);
    expect(filterRecordsForShopScope(records, 'SHOP_A').map((record) => record.id)).toEqual(['a']);
    expect(filterRecordsForShopScope(records, 'SHOP_S').map((record) => record.id)).toEqual(['s']);
  });

  it('returns no contribution percentage for a zero or invalid denominator', () => {
    expect(getContributionPercent(2500, 10000)).toBe(25);
    expect(getContributionPercent(0, 0)).toBeUndefined();
  });

  it('builds shop shares from branch-aware records only', () => {
    const rows = buildShopContributionRows([
      { shopId: 'SHOP_A', branchSystemVersion: 1, totalSales: 6_000, totalProfit: 1_200 },
      { shopId: 'SHOP_S', branchSystemVersion: 1, totalSales: 4_000, totalProfit: -200 },
      { totalSales: 9_000, totalProfit: 9_000 },
      { shopId: 'SHOP_A', branchSystemVersion: 2, totalSales: 8_000, totalProfit: 8_000 }
    ]);

    expect(rows).toEqual([
      { shopId: 'SHOP_A', name: 'ASHOKA', sales: 6_000, profit: 1_200, salesPercent: 60, profitPercent: 100 },
      { shopId: 'SHOP_S', name: 'SMPA', sales: 4_000, profit: -200, salesPercent: 40, profitPercent: 0 }
    ]);
  });
});

describe('new transaction shop resolution', () => {
  it('uses the business display names without changing stable shop IDs', () => {
    expect(getShopName('SHOP_A')).toBe('ASHOKA');
    expect(getShopName('SHOP_S')).toBe('SMPA');
  });

  it('always uses assigned Staff shops and never trusts a Staff-selected override', () => {
    expect(resolveNewRecordShopId('Staff', 'SHOP_A', 'SHOP_S')).toBe('SHOP_A');
    expect(resolveNewRecordShopId('Staff', 'SHOP_S', 'SHOP_A')).toBe('SHOP_S');
  });

  it('keeps shopless legacy Staff untagged and uses the explicit Admin selection', () => {
    expect(resolveNewRecordShopId('Staff', undefined, 'SHOP_A')).toBeUndefined();
    expect(resolveNewRecordShopId('Admin', undefined, 'SHOP_S')).toBe('SHOP_S');
    expect(resolveNewRecordShopId('Admin', undefined, undefined)).toBeUndefined();
  });
});
