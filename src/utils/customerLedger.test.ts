import { describe, expect, it } from 'vitest';
import type { Invoice, Payment } from '../types';
import { buildCustomerLedger } from './customerLedger';

const invoice = (id: string, totalSales: number, date: string, createdAt: string): Invoice => ({
  id,
  invoiceNumber: id.toUpperCase(),
  customerId: 'customer-1',
  customerName: 'Customer One',
  date,
  dueDate: date,
  salesAmount: totalSales,
  costAmount: 0,
  transportAmount: 0,
  totalSales,
  totalCost: 0,
  totalProfit: totalSales,
  notes: '',
  createdAt
});

const payment = (
  id: string,
  amount: number,
  date: string,
  createdAt: string,
  overrides: Partial<Payment> = {}
): Payment => ({
  id,
  invoiceId: 'invoice-1',
  invoiceNumber: 'INVOICE-1',
  customerId: 'customer-1',
  customerName: 'Customer One',
  date,
  amount,
  amountAppliedToInvoice: amount,
  advanceCreatedAmount: 0,
  advanceAppliedAmount: 0,
  amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0,
  oldBalanceAfterPayment: 0,
  cashDiscount: 0,
  mode: 'Cash',
  notes: '',
  createdAt,
  ...overrides
});

describe('customer ledger', () => {
  it('combines split allocations into one payment transaction and running-balance change', () => {
    const rows = buildCustomerLedger(
      [
        invoice('invoice-1', 100, '2026-09-01', '2026-09-01T09:00:00.000Z'),
        invoice('invoice-2', 200, '2026-09-03', '2026-09-03T09:00:00.000Z')
      ],
      [
        payment('payment-1', 40, '2026-09-02', '2026-09-02T09:00:00.000Z'),
        payment('split-1', 50, '2026-09-04', '2026-09-04T09:00:00.000Z', {
          invoiceId: 'invoice-1',
          splitPaymentGroupId: 'group-1',
          splitPaymentTotalAmount: 60,
          splitPaymentPart: 1,
          splitPaymentCount: 2
        }),
        payment('split-2', 10, '2026-09-04', '2026-09-04T09:01:00.000Z', {
          invoiceId: 'invoice-2',
          splitPaymentGroupId: 'group-1',
          splitPaymentTotalAmount: 60,
          splitPaymentPart: 2,
          splitPaymentCount: 2
        })
      ]
    );

    expect(rows.map((row) => row.id)).toEqual([
      'invoice:invoice-1',
      'payment:payment-1',
      'invoice:invoice-2',
      'split:group-1'
    ]);
    expect(rows.map((row) => row.runningBalance)).toEqual([100, 60, 260, 200]);
    expect(rows[3]).toMatchObject({ paymentAmount: 60, paymentReceived: 60 });
    expect(rows[3].payments?.map((part) => part.id)).toEqual(['split-1', 'split-2']);
  });

  it('combines legacy split allocations that only have split markers in their notes', () => {
    const rows = buildCustomerLedger(
      [invoice('invoice-1', 100, '2026-09-01', '2026-09-01T09:00:00.000Z')],
      [
        payment('split-1', 40, '2026-09-02', '2026-09-02T09:00:00.000Z', {
          invoiceId: 'invoice-1',
          notes: 'Counter receipt | Split payment 1/2'
        }),
        payment('split-2', 30, '2026-09-02', '2026-09-02T09:01:00.000Z', {
          invoiceId: 'invoice-2',
          notes: 'Counter receipt | Split payment 2/2'
        })
      ]
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ paymentAmount: 70, paymentReceived: 70, runningBalance: 30 });
    expect(rows[1].payments?.map((part) => part.id)).toEqual(['split-1', 'split-2']);
  });

  it('keeps ordinary payments entered on the same day as separate transactions', () => {
    const rows = buildCustomerLedger(
      [invoice('invoice-1', 100, '2026-09-01', '2026-09-01T09:00:00.000Z')],
      [
        payment('payment-1', 20, '2026-09-02', '2026-09-02T09:00:00.000Z'),
        payment('payment-2', 30, '2026-09-02', '2026-09-02T10:00:00.000Z')
      ]
    );

    expect(rows.map((row) => row.id)).toEqual([
      'invoice:invoice-1',
      'payment:payment-1',
      'payment:payment-2'
    ]);
    expect(rows.map((row) => row.runningBalance)).toEqual([100, 80, 50]);
  });

  it('includes cash discounts but excludes payment advances from the due reduction', () => {
    const rows = buildCustomerLedger(
      [invoice('invoice-1', 100, '2026-09-01', '2026-09-01T09:00:00.000Z')],
      [payment('payment-1', 100, '2026-09-02', '2026-09-02T09:00:00.000Z', {
        amountAppliedToInvoice: 80,
        advanceCreatedAmount: 20,
        cashDiscount: 20
      })]
    );

    expect(rows[1]).toMatchObject({ paymentAmount: 100, paymentReceived: 100, runningBalance: 0 });
  });

  it('reorders later-created backdated invoices and recalculates subsequent balances', () => {
    const rows = buildCustomerLedger(
      [
        invoice('invoice-2', 200, '2026-09-03', '2026-09-03T09:00:00.000Z'),
        invoice('invoice-1', 100, '2026-09-02', '2026-09-04T09:00:00.000Z')
      ],
      [payment('payment-1', 50, '2026-09-03', '2026-09-03T10:00:00.000Z')]
    );

    expect(rows.map((row) => row.id)).toEqual(['invoice:invoice-1', 'invoice:invoice-2', 'payment:payment-1']);
    expect(rows.map((row) => row.runningBalance)).toEqual([100, 300, 250]);
  });

  it('reconstructs the brought-forward balance for a limited range', () => {
    const rows = buildCustomerLedger(
      [invoice('invoice-2', 200, '2026-09-03', '2026-09-03T09:00:00.000Z')],
      [payment('payment-2', 50, '2026-09-04', '2026-09-04T09:00:00.000Z')],
      { endingBalance: 300 }
    );

    expect(rows.map((row) => row.runningBalance)).toEqual([350, 300]);
  });
});
