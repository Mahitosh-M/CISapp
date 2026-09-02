import { describe, expect, it } from 'vitest';
import {
  applyCustomerOutstandingDelta,
  buildInvoiceBalanceCheckpoints,
  combineCustomerOutstandingDeltas
} from './customerOutstanding';

describe('atomic customer outstanding', () => {
  it('stores only the unpaid part after an invoice and same-day payment', () => {
    const afterInvoice = applyCustomerOutstandingDelta({ totalOutstandingAmount: 0 }, { invoice: 100 });
    const afterPayment = applyCustomerOutstandingDelta(afterInvoice, { invoice: -80 });

    expect(afterInvoice.totalOutstandingAmount).toBe(100);
    expect(afterPayment.totalOutstandingAmount).toBe(20);
    expect(afterPayment.invoiceOutstandingAmount).toBe(20);
  });

  it('adds the full invoice when no payment is made', () => {
    expect(applyCustomerOutstandingDelta(
      { totalOutstandingAmount: 250, invoiceOutstandingAmount: 250 },
      { invoice: 100 }
    )).toMatchObject({
      totalOutstandingAmount: 350,
      invoiceOutstandingAmount: 350
    });
  });

  it('combines split-payment parts into one net outstanding reduction', () => {
    const splitPaymentDelta = combineCustomerOutstandingDeltas(
      { invoice: -50 },
      { invoice: -30 }
    );

    expect(applyCustomerOutstandingDelta(
      { totalOutstandingAmount: 100, invoiceOutstandingAmount: 100 },
      splitPaymentDelta
    ).totalOutstandingAmount).toBe(20);
  });

  it('never stores a negative outstanding balance', () => {
    expect(applyCustomerOutstandingDelta(
      { totalOutstandingAmount: 20, invoiceOutstandingAmount: 20 },
      { invoice: -50 }
    )).toMatchObject({
      totalOutstandingAmount: 0,
      invoiceOutstandingAmount: 0
    });
  });

  it('builds a running invoice ledger and keeps historical checkpoints distinct', () => {
    const ledger = buildInvoiceBalanceCheckpoints(
      [
        { id: 'invoice-1', totalSales: 100, date: '2026-09-01', createdAt: '2026-09-01T09:00:00.000Z' },
        { id: 'invoice-2', totalSales: 200, date: '2026-09-03', createdAt: '2026-09-03T09:00:00.000Z' }
      ],
      [
        {
          id: 'payment-1',
          amount: 40,
          amountAppliedToInvoice: 40,
          date: '2026-09-02',
          createdAt: '2026-09-02T09:00:00.000Z'
        },
        {
          id: 'payment-2',
          amount: 60,
          amountAppliedToInvoice: 60,
          date: '2026-09-04',
          createdAt: '2026-09-04T09:00:00.000Z'
        }
      ]
    );

    expect(ledger.balanceByInvoiceId).toEqual({
      'invoice-1': 60,
      'invoice-2': 200
    });
    expect(ledger.latestInvoiceId).toBe('invoice-2');
    expect(ledger.totalOutstandingAmount).toBe(200);
  });

  it('reduces the latest ledger balance for every part of a split payment', () => {
    const ledger = buildInvoiceBalanceCheckpoints(
      [{ id: 'invoice-1', totalSales: 1000, date: '2026-09-01', createdAt: '2026-09-01T09:00:00.000Z' }],
      [
        { id: 'part-1', amount: 500, date: '2026-09-02', createdAt: '2026-09-02T09:00:00.000Z' },
        { id: 'part-2', amount: 400, date: '2026-09-02', createdAt: '2026-09-02T09:01:00.000Z' },
        { id: 'part-3', amount: 100, date: '2026-09-02', createdAt: '2026-09-02T09:02:00.000Z' }
      ]
    );

    expect(ledger.balanceByInvoiceId['invoice-1']).toBe(0);
  });
});
