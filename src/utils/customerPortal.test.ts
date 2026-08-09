import { describe, expect, it } from 'vitest';
import type { Invoice, Payment } from '../types';
import { calculateInvoiceApcInfo, getInvoiceFullPaymentEvent } from './customerPortal';
import { DEFAULT_SETTINGS } from './settings';

const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'invoice-1',
  invoiceNumber: 'INV-0001',
  customerId: 'customer-1',
  customerName: 'Test Customer',
  date: '2026-07-01',
  dueDate: '2026-07-11',
  savedDueDate: '2026-07-11',
  finalPcCutoffDate: '2026-07-21',
  tierAtInvoice: 'Tier 1',
  pcPercentageAtInvoice: 4,
  creditDaysAtInvoice: 10,
  bufferDaysAtInvoice: 10,
  salesAmount: 10000,
  costAmount: 0,
  transportAmount: 0,
  totalSales: 10000,
  totalCost: 0,
  totalProfit: 10000,
  notes: '',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides
});

const payment = (id: string, amount: number, date: string, cashDiscount = 0): Payment => ({
  id,
  invoiceId: 'invoice-1',
  invoiceNumber: 'INV-0001',
  customerId: 'customer-1',
  customerName: 'Test Customer',
  date,
  amount,
  amountAppliedToInvoice: amount,
  advanceCreatedAmount: 0,
  advanceAppliedAmount: 0,
  amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0,
  oldBalanceAfterPayment: 0,
  cashDiscount,
  mode: 'Cash',
  notes: '',
  createdAt: `${date}T00:00:00.000Z`
});

describe('hybrid invoice PC', () => {
  it('awards full PC when fully paid by the saved due date', () => {
    expect(calculateInvoiceApcInfo(invoice(), [payment('p1', 10000, '2026-07-11')], 'Tier 4', DEFAULT_SETTINGS).earnedApc).toBe(400);
  });

  it('weights payment portions by lateness and loses the ten-percent pool when not settled by due date', () => {
    const result = calculateInvoiceApcInfo(invoice(), [
      payment('p1', 5000, '2026-07-10'),
      payment('p2', 5000, '2026-07-16')
    ], 'Tier 4', DEFAULT_SETTINGS);

    expect(result.earnedApc).toBe(270);
  });

  it('gives zero retention to a payment after the final cutoff', () => {
    const result = calculateInvoiceApcInfo(invoice(), [
      payment('p1', 5000, '2026-07-10'),
      payment('p2', 5000, '2026-07-22')
    ], 'Tier 4', DEFAULT_SETTINGS);

    expect(result.earnedApc).toBe(180);
  });

  it('does not post PC before full settlement', () => {
    expect(calculateInvoiceApcInfo(invoice(), [payment('p1', 9000, '2026-07-10')], 'Tier 4', DEFAULT_SETTINGS).earnedApc).toBe(0);
  });

  it('handles zero buffer without dividing by zero', () => {
    const zeroBufferInvoice = invoice({ bufferDaysAtInvoice: 0, finalPcCutoffDate: '2026-07-11' });
    expect(calculateInvoiceApcInfo(zeroBufferInvoice, [payment('p1', 10000, '2026-07-12')], 'Tier 4', DEFAULT_SETTINGS).earnedApc).toBe(0);
  });

  it('uses net collectible amount after approved cash discount', () => {
    const result = calculateInvoiceApcInfo(invoice(), [payment('p1', 9000, '2026-07-11', 1000)], 'Tier 4', DEFAULT_SETTINGS);
    expect(result.earnedApc).toBe(400);
  });

  it('uses the invoice-time tier rate after the customer tier changes', () => {
    const result = calculateInvoiceApcInfo(invoice({ tierAtInvoice: 'Tier 1', pcPercentageAtInvoice: 4 }), [payment('p1', 10000, '2026-07-11')], 'Tier 4', DEFAULT_SETTINGS);
    expect(result.earnedApc).toBe(400);
  });

  it('identifies the payment document that first fully settles the invoice', () => {
    const firstPayment = payment('p1', 4000, '2026-07-08');
    const settlementPayment = payment('p2', 6000, '2026-07-10');

    expect(getInvoiceFullPaymentEvent(invoice(), [settlementPayment, firstPayment])?.id).toBe('p2');
  });

  it('uses creation order to identify same-day settlement payments', () => {
    const laterCreated = {
      ...payment('p2', 6000, '2026-07-10'),
      createdAt: '2026-07-10T11:00:00.000Z'
    };
    const earlierCreated = {
      ...payment('p1', 4000, '2026-07-10'),
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: '2026-08-10T10:00:00.000Z'
    };

    expect(getInvoiceFullPaymentEvent(invoice(), [laterCreated, earlierCreated])?.id).toBe('p2');
  });
});
