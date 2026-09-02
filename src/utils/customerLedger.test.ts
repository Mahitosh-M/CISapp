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
  it('shows invoice additions and every split payment with a running balance', () => {
    const rows = buildCustomerLedger(
      [
        invoice('invoice-1', 100, '2026-09-01', '2026-09-01T09:00:00.000Z'),
        invoice('invoice-2', 200, '2026-09-03', '2026-09-03T09:00:00.000Z')
      ],
      [
        payment('payment-1', 40, '2026-09-02', '2026-09-02T09:00:00.000Z'),
        payment('split-1', 50, '2026-09-04', '2026-09-04T09:00:00.000Z'),
        payment('split-2', 10, '2026-09-04', '2026-09-04T09:01:00.000Z')
      ]
    );

    expect(rows.map((row) => row.runningBalance)).toEqual([100, 60, 260, 210, 200]);
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
