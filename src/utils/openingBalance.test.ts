import { describe, expect, it } from 'vitest';
import type { Invoice, InvoiceFormData } from '../types';
import { isOpeningBalanceInvoice, prepareOpeningBalanceInvoiceEdit } from './openingBalance';

const openingInvoice: Invoice = {
  id: 'openingBalance_customer-1',
  invoiceNumber: '0000-OPENING-CUSTOM',
  customerId: 'customer-1',
  customerName: 'Customer One',
  invoiceType: 'opening_balance',
  isOpeningBalance: true,
  date: '2026-05-20',
  dueDate: '2026-05-20',
  salesAmount: 1000,
  costAmount: 0,
  transportAmount: 0,
  totalSales: 1000,
  totalCost: 0,
  totalProfit: 0,
  notes: 'Opening balance from previous outstanding',
  createdAt: '2026-05-20T10:00:00.000Z'
};

describe('opening balance invoices', () => {
  it('recognizes explicit and legacy-prefix opening balance records', () => {
    expect(isOpeningBalanceInvoice(openingInvoice)).toBe(true);
    expect(isOpeningBalanceInvoice({ invoiceNumber: '0000-OPENING-LEGACY' })).toBe(true);
    expect(isOpeningBalanceInvoice({ invoiceNumber: 'INV-0001' })).toBe(false);
  });

  it('keeps an edit attached to the original customer and out of cost and profit totals', () => {
    const attemptedEdit: InvoiceFormData = {
      customerId: 'different-customer',
      customerName: 'Different Customer',
      date: '2026-05-21',
      dueDate: '2026-06-30',
      salesAmount: 1250,
      costAmount: 900,
      transportAmount: 50,
      totalSales: 1250,
      totalCost: 950,
      totalProfit: 300,
      notes: 'Corrected opening balance',
      shopId: 'SHOP_A',
      branchSystemVersion: 1
    };

    expect(prepareOpeningBalanceInvoiceEdit(openingInvoice, attemptedEdit)).toEqual({
      customerId: 'customer-1',
      customerName: 'Customer One',
      date: '2026-05-21',
      dueDate: '2026-05-21',
      salesAmount: 1250,
      costAmount: 0,
      transportAmount: 0,
      totalSales: 1250,
      totalCost: 0,
      totalProfit: 0,
      notes: 'Corrected opening balance'
    });
  });
});
