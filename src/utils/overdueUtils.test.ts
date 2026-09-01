import { describe, expect, it } from 'vitest';
import type { Customer, Invoice, Payment } from '../types';
import { buildDueCustomerRows } from './overdueUtils';

const customer = (id: string, name: string): Customer => ({
  id,
  name,
  mobile: '',
  area: '',
  tier: 'Tier 4',
  previousOutstandingAmount: 0,
  advanceBalance: 0,
  paymentTerms: '',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z'
});

const invoice = (
  id: string,
  customerId: string,
  customerName: string,
  dueDate: string,
  totalSales: number
): Invoice => ({
  id,
  invoiceNumber: id,
  customerId,
  customerName,
  date: '2026-08-01',
  dueDate,
  salesAmount: totalSales,
  costAmount: 0,
  transportAmount: 0,
  totalSales,
  totalCost: 0,
  totalProfit: totalSales,
  notes: '',
  createdAt: '2026-08-01T00:00:00.000Z'
});

const payment = (invoiceRow: Invoice, amount: number): Payment => ({
  id: `PAY-${invoiceRow.id}`,
  invoiceId: invoiceRow.id,
  invoiceNumber: invoiceRow.invoiceNumber,
  customerId: invoiceRow.customerId,
  customerName: invoiceRow.customerName,
  date: '2026-08-25',
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
  createdAt: '2026-08-25T00:00:00.000Z'
});

describe('buildDueCustomerRows', () => {
  it('aggregates pending invoice amounts only when they are more than seven days overdue', () => {
    const customers = [customer('C-1', 'Alpha Medical'), customer('C-2', 'Boundary Medical')];
    const alphaFirst = invoice('INV-1', 'C-1', 'Alpha Medical', '2026-08-20', 1000);
    const alphaSecond = invoice('INV-2', 'C-1', 'Alpha Medical', '2026-08-22', 500);
    const exactlySevenDays = invoice('INV-3', 'C-2', 'Boundary Medical', '2026-08-25', 800);

    const rows = buildDueCustomerRows(
      customers,
      [alphaFirst, alphaSecond, exactlySevenDays],
      [payment(alphaFirst, 300)],
      undefined,
      '2026-09-01'
    );

    expect(rows).toEqual([
      {
        customerId: 'C-1',
        customerName: 'Alpha Medical',
        overdueDays: 12,
        amount: 1200,
        invoices: [
          { invoiceId: 'INV-1', invoiceNumber: 'INV-1', overdueDays: 12, amount: 700 },
          { invoiceId: 'INV-2', invoiceNumber: 'INV-2', overdueDays: 10, amount: 500 }
        ]
      }
    ]);
  });

  it('excludes invoices that have been fully paid', () => {
    const customerRow = customer('C-1', 'Alpha Medical');
    const invoiceRow = invoice('INV-1', customerRow.id, customerRow.name, '2026-08-01', 1000);

    expect(buildDueCustomerRows(
      [customerRow],
      [invoiceRow],
      [payment(invoiceRow, 1000)],
      undefined,
      '2026-09-01'
    )).toEqual([]);
  });
});
