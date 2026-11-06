// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Customer, Invoice, Payment } from '../types';
import { DEFAULT_SETTINGS } from '../utils/settings';

const reads = vi.hoisted(() => ({ customers: vi.fn(), invoices: vi.fn(), payments: vi.fn(), count: vi.fn(), snapshots: vi.fn() }));
vi.mock('../services/firestoreService', () => ({
  getCustomers: reads.customers, getInvoices: reads.invoices, getPayments: reads.payments,
  getCustomerCount: reads.count, getBusinessMonthlySnapshots: reads.snapshots,
  getAppSettings: async () => ({ ...DEFAULT_SETTINGS, fixedMonthlyCosts: 0 })
}));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: { role: 'Admin' } }) }));
vi.mock('../utils/dateUtils', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/dateUtils')>(),
  getCurrentMonthRange: () => ({ fromDate: '2026-11-01', toDate: '2026-11-06' }),
  getTodayDateString: () => '2026-11-06'
}));
vi.mock('recharts', () => Object.fromEntries(['Bar','BarChart','CartesianGrid','Cell','Line','LineChart','Pie','PieChart','ResponsiveContainer','Tooltip','XAxis','YAxis'].map(name => [name, () => null])));
import Analytics from './Analytics';

const customers = [
  { id: 'customer', customerType: 'customer' }, { id: 'legacy' },
  { id: 'medical', customerType: 'medical' }, { id: 'inactive-medical', customerType: 'medical' }
] as Customer[];
const invoice = (customerId: string, sales: number, shopId: 'SHOP_A' | 'SHOP_S', old = false): Invoice => ({
  id: customerId + (old ? '-old' : ''), invoiceNumber: customerId + (old ? '-old' : ''), customerId, customerName: customerId + ' business',
  date: old ? '2026-10-01' : '2026-11-02', dueDate: old ? '2026-10-15' : '2026-11-04', savedDueDate: old ? '2026-10-15' : '2026-11-04',
  salesAmount: sales, totalSales: sales, costAmount: 0, totalCost: 0, transportAmount: 0, totalProfit: sales / 10,
  notes: '', createdAt: '', shopId, branchSystemVersion: 1
});
const payment = (customerId: string, amount: number, shopId: 'SHOP_A' | 'SHOP_S', old = false): Payment => ({
  id: customerId + (old ? '-old' : ''), invoiceId: customerId + (old ? '-old' : ''), invoiceNumber: customerId, customerId, customerName: customerId + ' business',
  date: old ? '2026-10-20' : '2026-11-05', amount, amountAppliedToInvoice: amount, advanceCreatedAmount: 0, advanceAppliedAmount: 0,
  amountUsedForOldBalance: 0, oldBalanceBeforePayment: 0, oldBalanceAfterPayment: 0, cashDiscount: 0, mode: 'Cash', notes: '', createdAt: '', shopId, branchSystemVersion: 1
});
const invoices = [invoice('customer',1000,'SHOP_A'), invoice('legacy',500,'SHOP_S'), invoice('medical',2000,'SHOP_A'), invoice('orphan',300,'SHOP_S'), invoice('customer',700,'SHOP_A',true), invoice('medical',900,'SHOP_A',true)];
const payments = [payment('customer',100,'SHOP_A'), payment('legacy',50,'SHOP_S'), payment('medical',400,'SHOP_A'), payment('orphan',20,'SHOP_S'), payment('customer',100,'SHOP_A',true), payment('medical',100,'SHOP_A',true)];
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const metric = (label: string) => screen.getByText(label, { exact: true }).parentElement!.textContent;
async function loaded() { await screen.findByRole('button', { name: 'Performance Overview' }); }

beforeEach(() => {
  vi.clearAllMocks();
  reads.customers.mockResolvedValue(customers);
  reads.count.mockResolvedValue(customers.length);
  reads.snapshots.mockResolvedValue([{ id:'2026-11', month:'2026-11', totalSales:99999, totalProfit:9999, paymentsReceived:999, invoiceCount:99, needsBackfill:false }]);
  const inRange = <T extends { date: string }>(rows: T[], options: { fromDate?: string; toDate?: string }) => rows.filter(row => (!options.fromDate || row.date >= options.fromDate) && (!options.toDate || row.date <= options.toDate));
  reads.invoices.mockImplementation(async options => inRange(invoices, options));
  reads.payments.mockImplementation(async options => inRange(payments, options));
});
afterEach(cleanup);

describe('Admin Analytics customer type selection', () => {
  it('defaults to Both and filters sales, receipts, legacy customers, and shop views without repeated reads', async () => {
    render(<Analytics />); await loaded();
    expect(screen.getByRole('button',{name:'Both'}).getAttribute('aria-pressed')).toBe('true');
    expect(reads.customers).not.toHaveBeenCalled();
    expect(reads.invoices).not.toHaveBeenCalled();
    click('Customer'); await loaded(); click('Performance Overview');
    await waitFor(() => expect(metric('Sales')).toContain('Rs. 1,500'));
    expect(metric('Collection-to-Sales')).toContain('Rs. 150');
    expect(metric('Sales')).toContain('2 invoice(s)');
    click('Medical'); await loaded();
    expect(metric('Sales')).toContain('Rs. 2,000');
    expect(metric('Collection-to-Sales')).toContain('Rs. 400');
    expect(metric('Sales')).toContain('1 invoice(s)');
    click('Both');
    expect(metric('Sales')).toContain('Rs. 3,800');
    expect(metric('Collection-to-Sales')).toContain('Rs. 570');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SHOP_S' } });
    click('Customer'); await loaded();
    expect(metric('Sales')).toContain('Rs. 500');
    click('Medical');
    expect(metric('Sales')).toContain('Rs. 0');
    expect(reads.customers).toHaveBeenCalledTimes(1);
    expect(reads.invoices).toHaveBeenCalledTimes(1);
    expect(reads.payments).toHaveBeenCalledTimes(1);
  });

  it('filters monthly breakeven, collection history, capital exposure, and activity counts using the same group', async () => {
    render(<Analytics />); await loaded();
    click('Medical'); await loaded(); click('Breakeven Analysis');
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')[1].textContent).toContain('Rs. 2,000'));
    expect(table.textContent).not.toContain('99,999');
    click('Collection Health');
    await waitFor(() => expect(metric('Total Due for Collection')).toContain('Rs. 2,800'));
    expect(metric('Due Actually Collected')).toContain('Rs. 400');
    expect(metric('Closing Overdue')).toContain('Rs. 2,400');
    click('Credit Capital Impact');
    expect(screen.getByRole('table').textContent).toContain('medical business');
    expect(screen.getByRole('table').textContent).not.toContain('customer business');
    click('Customer');
    expect(screen.getByRole('table').textContent).toContain('legacy business');
    expect(screen.getByRole('table').textContent).not.toContain('medical business');
    click('Medical'); click('Business Insights');
    expect(metric('Customer Activity')).toContain('1 of 2 customers bought');
    expect(reads.customers).toHaveBeenCalledTimes(1);
    expect(reads.invoices).toHaveBeenCalledTimes(2);
    expect(reads.payments).toHaveBeenCalledTimes(2);
  });

  it('returns to Both while group details are still loading without leaving the page stuck', async () => {
    let finishInvoices!: (rows: Invoice[]) => void;
    reads.invoices.mockImplementationOnce(() => new Promise<Invoice[]>(resolve => { finishInvoices = resolve; }));
    render(<Analytics />); await loaded(); click('Customer');
    expect(screen.getByRole('status').textContent).toContain('Loading');
    click('Both'); await loaded();
    finishInvoices(invoices);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: 'Both' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps Both available when customer type loading fails and allows a later retry', async () => {
    reads.customers.mockRejectedValueOnce(new Error('Fixture customer lookup failed'));
    render(<Analytics />); await loaded(); click('Medical');
    expect((await screen.findByRole('alert')).textContent).toContain('Fixture customer lookup failed');
    expect(screen.queryByText('Sales',{exact:true})).toBeNull();
    click('Both'); await loaded(); click('Customer'); await loaded(); click('Performance Overview');
    await waitFor(() => expect(metric('Sales')).toContain('Rs. 1,500'));
    expect(reads.customers).toHaveBeenCalledTimes(2);
  });
});


