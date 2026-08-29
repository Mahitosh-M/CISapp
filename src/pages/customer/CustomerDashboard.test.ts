import { describe, expect, it } from 'vitest';
import type { Invoice, Payment } from '../../types';
import { buildOutstandingHistory } from './CustomerDashboard';

const invoice: Invoice = {
  id: 'invoice-1',
  invoiceNumber: 'INV-1',
  customerId: 'customer-1',
  customerName: 'Test Customer',
  date: '2026-08-01',
  dueDate: '2026-08-31',
  salesAmount: 2_000,
  costAmount: 0,
  transportAmount: 0,
  totalSales: 2_000,
  totalCost: 0,
  totalProfit: 2_000,
  notes: '',
  createdAt: '2026-08-01T09:00:00.000Z'
};

const splitPayment = (id: string, amount: number, part: number): Payment => ({
  id,
  invoiceId: `invoice-${part}`,
  invoiceNumber: `INV-${part}`,
  customerId: 'customer-1',
  customerName: 'Test Customer',
  date: '2026-08-10',
  amount,
  amountAppliedToInvoice: amount,
  advanceCreatedAmount: 0,
  advanceAppliedAmount: 0,
  paymentKind: 'receipt',
  amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0,
  oldBalanceAfterPayment: 0,
  splitPaymentGroupId: 'split-1',
  splitPaymentTotalAmount: 1_000,
  splitPaymentPart: part,
  splitPaymentCount: 3,
  cashDiscount: 0,
  mode: 'Cash',
  notes: `Split payment ${part}/3`,
  createdAt: `2026-08-10T10:00:0${part}.000Z`
});

describe('customer outstanding history', () => {
  it('shows a split receipt as one fully reduced payment', () => {
    const history = buildOutstandingHistory(
      [invoice],
      [splitPayment('payment-1', 500, 1), splitPayment('payment-2', 400, 2), splitPayment('payment-3', 100, 3)],
      1_000
    );

    expect(history).toEqual([{
      id: 'split:split-1',
      date: '2026-08-10',
      paymentAmount: 1_000,
      previousOutstanding: 2_000,
      currentOutstanding: 1_000
    }]);
  });

  it('does not show an advance receipt until it reduces outstanding', () => {
    const advancePayment = {
      ...splitPayment('advance-1', 1_000, 1),
      splitPaymentGroupId: undefined,
      splitPaymentTotalAmount: undefined,
      splitPaymentPart: undefined,
      splitPaymentCount: undefined,
      invoiceId: '',
      invoiceNumber: '',
      amountAppliedToInvoice: 0,
      advanceCreatedAmount: 1_000,
      notes: 'Advance payment'
    };

    expect(buildOutstandingHistory([invoice], [advancePayment], 2_000)).toEqual([]);
  });
});
