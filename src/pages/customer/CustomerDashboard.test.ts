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
  it('shows a split receipt as one payment with its invoice addition', () => {
    const history = buildOutstandingHistory(
      [invoice],
      [splitPayment('payment-1', 500, 1), splitPayment('payment-2', 400, 2), splitPayment('payment-3', 100, 3)],
      1_000
    );

    expect(history).toEqual([
      {
        id: 'split:split-1',
        type: 'payment',
        date: '2026-08-10',
        transactionAmount: 1_000,
        transactionCount: 1,
        previousOutstanding: 2_000,
        currentOutstanding: 1_000
      },
      {
        id: 'invoices:invoice-1',
        type: 'invoice',
        date: '2026-08-01',
        transactionAmount: 2_000,
        transactionCount: 1,
        previousOutstanding: 0,
        currentOutstanding: 2_000
      }
    ]);
  });

  it('does not add an advance receipt as an outstanding reduction', () => {
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

    expect(buildOutstandingHistory([invoice], [advancePayment], 2_000)).toEqual([{
      id: 'invoices:invoice-1',
      type: 'invoice',
      date: '2026-08-01',
      transactionAmount: 2_000,
      transactionCount: 1,
      previousOutstanding: 0,
      currentOutstanding: 2_000
    }]);
  });

  it('groups consecutive invoices above the next payment', () => {
    const openingBalance: Invoice = {
      ...invoice,
      id: 'opening-balance',
      invoiceNumber: '0000-OPENING-CUSTOMER',
      invoiceType: 'opening_balance',
      isOpeningBalance: true,
      date: '2026-07-01',
      dueDate: '2026-07-01',
      salesAmount: 100,
      totalSales: 100,
      totalProfit: 0,
      createdAt: '2026-07-01T09:00:00.000Z'
    };
    const firstInvoice: Invoice = {
      ...invoice,
      id: 'invoice-200',
      date: '2026-08-01',
      salesAmount: 200,
      totalSales: 200,
      totalProfit: 200,
      createdAt: '2026-08-01T09:00:00.000Z'
    };
    const secondInvoice: Invoice = {
      ...invoice,
      id: 'invoice-300',
      date: '2026-08-02',
      salesAmount: 300,
      totalSales: 300,
      totalProfit: 300,
      createdAt: '2026-08-02T09:00:00.000Z'
    };
    const payment = {
      ...splitPayment('payment-300', 300, 1),
      splitPaymentGroupId: undefined,
      splitPaymentTotalAmount: undefined,
      splitPaymentPart: undefined,
      splitPaymentCount: undefined,
      invoiceId: secondInvoice.id,
      invoiceNumber: secondInvoice.invoiceNumber,
      date: '2026-08-03',
      notes: '',
      createdAt: '2026-08-03T10:00:00.000Z'
    };

    expect(buildOutstandingHistory([openingBalance, firstInvoice, secondInvoice], [payment], 300)).toEqual([
      {
        id: 'payment:payment-300',
        type: 'payment',
        date: '2026-08-03',
        transactionAmount: 300,
        transactionCount: 1,
        previousOutstanding: 600,
        currentOutstanding: 300
      },
      {
        id: 'invoices:invoice-300:invoice-200',
        type: 'invoice',
        date: '2026-08-02',
        transactionAmount: 500,
        transactionCount: 2,
        previousOutstanding: 100,
        currentOutstanding: 600
      }
    ]);
  });

  it('includes invoice additions needed to explain the latest three payments', () => {
    const transactionInvoices = [100, 200, 300, 400].map((amount, index): Invoice => ({
      ...invoice,
      id: `invoice-${index + 1}`,
      invoiceNumber: `INV-${index + 1}`,
      date: `2026-08-0${index * 2 + 1}`,
      salesAmount: amount,
      totalSales: amount,
      totalProfit: amount,
      createdAt: `2026-08-0${index * 2 + 1}T09:00:00.000Z`
    }));
    const transactionPayments = [1, 2, 3, 4].map((number): Payment => ({
      ...splitPayment(`receipt-${number}`, 50, number),
      invoiceId: `invoice-${number}`,
      invoiceNumber: `INV-${number}`,
      date: `2026-08-0${number * 2}`,
      splitPaymentGroupId: undefined,
      splitPaymentTotalAmount: undefined,
      splitPaymentPart: undefined,
      splitPaymentCount: undefined,
      notes: '',
      createdAt: `2026-08-0${number * 2}T10:00:00.000Z`
    }));

    const history = buildOutstandingHistory(transactionInvoices, transactionPayments, 800);

    expect(history).toHaveLength(6);
    expect(history.filter((item) => item.type === 'payment').map((item) => item.id)).toEqual([
      'payment:receipt-4',
      'payment:receipt-3',
      'payment:receipt-2'
    ]);
    expect(history[0]).toMatchObject({
      id: 'payment:receipt-4',
      previousOutstanding: 850,
      transactionAmount: 50,
      currentOutstanding: 800
    });
    expect(history[5]).toMatchObject({
      id: 'invoices:invoice-2',
      previousOutstanding: 50,
      transactionAmount: 200,
      currentOutstanding: 250
    });
  });
});
