import type { Customer, Invoice } from '../types';
import { getBusinessInvoices } from './openingBalance';

export interface CustomerContributionRow {
  customerId: string;
  customerName: string;
  sales: number;
  profit: number;
  invoiceCount: number;
  salesPercent: number;
  profitPercent: number;
}

export interface PieContributionRow {
  name: string;
  value: number;
  percent: number;
}

const roundPercent = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;

export const buildCustomerContributionRows = (customers: Customer[], invoices: Invoice[]): CustomerContributionRow[] => {
  const customerNameById = new Map(customers.map((customer) => [customer.id, customer.name]));
  const rows = new Map<string, CustomerContributionRow>();

  getBusinessInvoices(invoices).forEach((invoice) => {
    const current = rows.get(invoice.customerId) || {
      customerId: invoice.customerId,
      customerName: customerNameById.get(invoice.customerId) || invoice.customerName || 'Unknown Customer',
      sales: 0,
      profit: 0,
      invoiceCount: 0,
      salesPercent: 0,
      profitPercent: 0
    };

    rows.set(invoice.customerId, {
      ...current,
      sales: current.sales + invoice.totalSales,
      profit: current.profit + invoice.totalProfit,
      invoiceCount: current.invoiceCount + 1
    });
  });

  const values = [...rows.values()];
  const totalSales = values.reduce((sum, row) => sum + Math.max(0, row.sales), 0);
  const totalPositiveProfit = values.reduce((sum, row) => sum + Math.max(0, row.profit), 0);

  return values.map((row) => ({
    ...row,
    salesPercent: totalSales > 0 ? roundPercent((Math.max(0, row.sales) / totalSales) * 100) : 0,
    profitPercent: totalPositiveProfit > 0 ? roundPercent((Math.max(0, row.profit) / totalPositiveProfit) * 100) : 0
  }));
};

export const buildTopFivePieRows = (
  rows: CustomerContributionRow[],
  metric: 'sales' | 'profit'
): PieContributionRow[] => {
  const sortedRows = [...rows].sort((left, right) => right[metric] - left[metric]);
  const totalValue = sortedRows.reduce((sum, row) => sum + Math.max(0, row[metric]), 0);
  const topRows = sortedRows.slice(0, 5);
  const topValue = topRows.reduce((sum, row) => sum + Math.max(0, row[metric]), 0);
  const otherValue = Math.max(0, totalValue - topValue);
  const pieRows = topRows
    .filter((row) => Math.max(0, row[metric]) > 0)
    .map((row) => ({
      name: row.customerName,
      value: Math.max(0, row[metric]),
      percent: totalValue > 0 ? roundPercent((Math.max(0, row[metric]) / totalValue) * 100) : 0
    }));

  if (otherValue > 0) {
    pieRows.push({
      name: 'Others',
      value: otherValue,
      percent: totalValue > 0 ? roundPercent((otherValue / totalValue) * 100) : 0
    });
  }

  return pieRows;
};
