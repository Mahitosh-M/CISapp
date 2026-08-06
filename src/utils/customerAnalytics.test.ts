import { describe, expect, it } from 'vitest';
import type { AppSettings, Customer, Invoice, Payment } from '../types';
import {
  buildCustomerScores,
  calculateInvoiceMarginProfitScore,
  calculateProfitScore,
  calculateWeightedPaymentDisciplineScore
} from './customerAnalytics';
import { DEFAULT_SETTINGS, mergeWithDefaultSettings } from './settings';

const REFERENCE_DATE = new Date(2026, 7, 6);

const createCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'customer-1',
  name: 'Test Customer',
  mobile: '9999999999',
  area: 'Test Area',
  tier: 'Tier 1',
  previousOutstandingAmount: 0,
  advanceBalance: 0,
  paymentTerms: '',
  notes: '',
  createdAt: '2025-01-01',
  ...overrides
});

const createInvoice = (
  id: string,
  date: string,
  totalSales: number,
  marginPercent: number
): Invoice => {
  const totalProfit = totalSales * (marginPercent / 100);

  return {
    id,
    invoiceNumber: id,
    customerId: 'customer-1',
    customerName: 'Test Customer',
    date,
    dueDate: date,
    salesAmount: totalSales,
    costAmount: totalSales - totalProfit,
    transportAmount: 0,
    totalSales,
    totalCost: totalSales - totalProfit,
    totalProfit,
    notes: '',
    createdAt: `${date}T00:00:00.000Z`
  };
};

const createPayment = (invoice: Invoice): Payment => ({
  id: `payment-${invoice.id}`,
  invoiceId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  customerId: invoice.customerId,
  customerName: invoice.customerName,
  date: invoice.date,
  amount: invoice.totalSales,
  amountAppliedToInvoice: invoice.totalSales,
  advanceCreatedAmount: 0,
  advanceAppliedAmount: 0,
  amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0,
  oldBalanceAfterPayment: 0,
  cashDiscount: 0,
  mode: 'Cash',
  notes: '',
  createdAt: `${invoice.date}T00:00:00.000Z`
});

const liveScoringSettings = mergeWithDefaultSettings({
  scoringWeights: {
    profit: 32.5,
    paymentDiscipline: 32.5,
    frequency: 15,
    sales: 15,
    loyalty: 5
  },
  targetSettings: {
    ...DEFAULT_SETTINGS.targetSettings,
    tier1: { monthlySalesTarget: 25000, monthlyOrderTarget: 2 }
  }
});

const createEstablishedInvoices = (totalSales: number, marginPercent = 20) => {
  const invoiceSales = totalSales / 4;
  return [
    createInvoice('INV-HISTORY', '2026-05-01', 1000, marginPercent),
    createInvoice('INV-1', '2026-07-01', invoiceSales, marginPercent),
    createInvoice('INV-2', '2026-07-15', invoiceSales, marginPercent),
    createInvoice('INV-3', '2026-08-01', invoiceSales, marginPercent),
    createInvoice('INV-4', '2026-08-05', invoiceSales, marginPercent)
  ];
};

describe('invoice margin profit scoring', () => {
  it.each([
    [-10, 0],
    [0, 0],
    [5, 20],
    [10, 40],
    [15, 60],
    [20, 80],
    [25, 90],
    [30, 100],
    [40, 100]
  ])('scores %s%% margin as %s', (margin, expected) => {
    expect(calculateProfitScore(margin)).toBe(expected);
  });

  it('weights mixed invoice margins by invoice sales and caps each invoice at 100', () => {
    const invoices = [
      createInvoice('INV-1', '2026-08-01', 40000, 10),
      createInvoice('INV-2', '2026-08-02', 10000, 60)
    ];

    expect(calculateInvoiceMarginProfitScore(invoices)).toBe(52);
  });

  it('gives losses zero points without allowing them to be hidden by excess margin', () => {
    const invoices = [
      createInvoice('INV-1', '2026-08-01', 10000, -10),
      createInvoice('INV-2', '2026-08-02', 10000, 40)
    ];

    expect(calculateInvoiceMarginProfitScore(invoices)).toBe(50);
  });
});

describe('customer scoring integration', () => {
  it('keeps the fixed production scoring weights during onboarding', () => {
    const settings: AppSettings = mergeWithDefaultSettings({
      scoringWeights: {
        profit: 50,
        paymentDiscipline: 20,
        frequency: 10,
        sales: 10,
        loyalty: 10
      }
    });
    const customer = createCustomer({ tier: 'Tier 4', createdAt: '2026-07-25' });
    const profitableInvoices = [
      createInvoice('INV-1', '2026-08-01', 5000, 20),
      createInvoice('INV-2', '2026-08-03', 5000, 20)
    ];
    const lossInvoices = profitableInvoices.map((invoice) => ({
      ...invoice,
      totalCost: invoice.totalSales + 500,
      totalProfit: -500
    }));

    const profitableScore = buildCustomerScores(customer ? [customer] : [], profitableInvoices, profitableInvoices.map(createPayment), REFERENCE_DATE, settings)[0];
    const lossScore = buildCustomerScores([customer], lossInvoices, lossInvoices.map(createPayment), REFERENCE_DATE, settings)[0];

    expect(profitableScore.onboardingStage).toBe('Stage B');
    expect(profitableScore.scoreBreakdown.find((item) => item.key === 'profit')?.weight).toBe(0.3);
    expect(profitableScore.scoreBreakdown.find((item) => item.key === 'sales')?.weight).toBe(0.2);
    expect(profitableScore.scoreBreakdown.find((item) => item.key === 'frequency')?.weight).toBe(0.15);
    expect(profitableScore.intelligenceScore).toBeGreaterThan(lossScore.intelligenceScore);
    expect(lossScore.profitScore).toBe(0);
  });

  it('allows Platinum at the new 25000 monthly sales gate', () => {
    const invoices = createEstablishedInvoices(50000);
    const score = buildCustomerScores([createCustomer()], invoices, invoices.map(createPayment), REFERENCE_DATE, liveScoringSettings)[0];

    expect(score.customerMonthlySales).toBe(25000);
    expect(score.intelligenceScore).toBeGreaterThanOrEqual(81);
    expect(score.paymentDisciplineScore).toBeGreaterThanOrEqual(90);
    expect(score.tier).toBe('Tier 1');
  });

  it('keeps a qualifying score below Platinum when monthly sales are under 25000', () => {
    const invoices = createEstablishedInvoices(48000);
    const score = buildCustomerScores([createCustomer()], invoices, invoices.map(createPayment), REFERENCE_DATE, liveScoringSettings)[0];

    expect(score.customerMonthlySales).toBe(24000);
    expect(score.intelligenceScore).toBeGreaterThanOrEqual(81);
    expect(score.tier).toBe('Tier 2');
  });

  it('keeps the existing overdue gate that caps an otherwise qualifying customer at Tier 4', () => {
    const invoices = createEstablishedInvoices(50000);
    const payments = invoices.slice(0, -1).map(createPayment);
    const score = buildCustomerScores([createCustomer()], invoices, payments, REFERENCE_DATE, liveScoringSettings)[0];

    expect(score.intelligenceScore).toBeGreaterThanOrEqual(81);
    expect(score.overdueStatus).toBe('Overdue');
    expect(score.tier).toBe('Tier 4');
  });

  it('does not force Tier 4 for one small isolated overdue amount', () => {
    const invoices = [
      ...createEstablishedInvoices(50000),
      createInvoice('INV-SMALL-LATE', '2026-08-01', 100, 30)
    ];
    const payments = invoices
      .filter((invoice) => invoice.id !== 'INV-SMALL-LATE')
      .map(createPayment);
    const score = buildCustomerScores([createCustomer()], invoices, payments, REFERENCE_DATE, liveScoringSettings)[0];

    expect(score.overdueStatus).toBe('Overdue');
    expect(score.tier).not.toBe('Tier 4');
  });
});

describe('rupee-weighted payment scoring', () => {
  it('gives a small late balance only a proportionately small effect', () => {
    const largeInvoice = createInvoice('INV-LARGE', '2026-08-01', 10000, 20);
    const smallInvoice = createInvoice('INV-SMALL', '2026-07-20', 100, 20);
    const payments = [
      createPayment(largeInvoice),
      { ...createPayment(smallInvoice), date: '2026-07-30' }
    ];

    expect(calculateWeightedPaymentDisciplineScore([largeInvoice, smallInvoice], payments, REFERENCE_DATE)).toBe(100);
  });

  it('applies four score points per weighted late day with a floor of 20', () => {
    const invoice = createInvoice('INV-LATE', '2026-07-20', 1000, 20);
    const latePayment = { ...createPayment(invoice), date: '2026-07-25' };

    expect(calculateWeightedPaymentDisciplineScore([invoice], [latePayment], REFERENCE_DATE)).toBe(80);
  });
});
