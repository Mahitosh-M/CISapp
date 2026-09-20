import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { Customer, Invoice, Payment } from '../types';
import { DEFAULT_SETTINGS } from './settings';
import { buildCustomerScores, type PartnerUpgradeContext } from './customerAnalytics';
import { buildPartnerLevelJourney } from './partnerLevelJourney';
import CustomerLevelJourney from '../components/CustomerLevelJourney';

const customer: Customer = {
  id: 'customer-1', name: 'Customer', mobile: '', area: '', tier: 'Tier 4',
  previousOutstandingAmount: 0, advanceBalance: 0, paymentTerms: '', notes: '', createdAt: '2026-01-01'
};
const internal: PartnerUpgradeContext = {
  tier: 'Tier 4', onboardingStage: 'Stage D', isOnboarding: false, paymentDisciplineScore: 100,
  customerMonthlySales: 0, totalSales: 0, outstanding: 0, intelligenceScore: 20
};
const invoice = (id: string, date: string, totalSales: number, extra: Partial<Invoice> = {}): Invoice => ({
  id, invoiceNumber: id, customerId: customer.id, customerName: customer.name, date,
  dueDate: '2026-10-01', savedDueDate: '2026-10-01', salesAmount: totalSales,
  costAmount: 0, transportAmount: 0, totalSales, totalCost: 0, totalProfit: 0,
  notes: '', createdAt: `${date}T09:00:00Z`, ...extra
});
const payment = (invoiceId: string, amount: number, date = '2026-09-13'): Payment => ({
  id: 'p-' + invoiceId, invoiceId, invoiceNumber: invoiceId, customerId: customer.id,
  customerName: customer.name, date, amount, amountAppliedToInvoice: amount, advanceCreatedAmount: 0, advanceAppliedAmount: 0, amountUsedForOldBalance: 0, oldBalanceBeforePayment: 0, oldBalanceAfterPayment: 0, cashDiscount: 0, mode: 'Cash', notes: '', createdAt: `${date}T10:00:00Z`
});
const build = (invoices: Invoice[], payments: Payment[] = [], at = '2026-09-14') =>
  buildPartnerLevelJourney(customer, invoices, payments, DEFAULT_SETTINGS, internal, at);

describe('customer-facing partner-level goals', () => {
  it('deducts earlier purchases from this month’s requirement for every level', () => {
    const journey = build([invoice('old', '2026-08-10', 10000), invoice('new', '2026-09-05', 4000)]);
    expect(journey.windowStart).toBe('2026-07-17');
    expect(journey.thisMonthPurchases).toBe(4000);
    expect(journey.levels.map((level) => level.remaining)).toEqual([0, 0, 16000, 36000]);
    expect(journey.levels[2].monthlyTarget).toBe(20000);
    expect(journey.levels[2].progress).toBe(20);
    expect(journey.levels[1].state).toBe('next');
    expect(journey.levels.map((level) => level.coinComparison.map((item) => item.coins)))
      .toEqual([[10], [10, 20], [10, 20, 30], [10, 20, 30, 40]]);
  });

  it('excludes old, future, opening balance and other-customer invoices from purchases', () => {
    const journey = build([
      invoice('in', '2026-07-17', 1000), invoice('out', '2026-07-16', 9000),
      invoice('future', '2026-09-15', 9000), invoice('opening', '2026-09-01', 9000, { invoiceType: 'opening_balance' }),
      invoice('other', '2026-09-01', 9000, { customerId: 'other' })
    ]);
    expect(journey.earlierPurchases).toBe(1000);
    expect(journey.thisMonthPurchases).toBe(0);
    expect(journey.levels[1].remaining).toBe(9000);
  });

  it('moves the window and the month without keeping an old completed bar', () => {
    const rows = [invoice('aug', '2026-08-01', 10000), invoice('sep', '2026-09-10', 2000)];
    expect(build(rows).levels[1].purchaseMet).toBe(true);
    const nextMonth = build(rows, [], '2026-10-01');
    expect(nextMonth.thisMonthPurchases).toBe(0);
    expect(nextMonth.earlierPurchases).toBe(2000);
    expect(nextMonth.levels[1].remaining).toBe(8000);
  });

  it('recalculates after invoice corrections, deletion and net purchase reversals', () => {
    expect(build([invoice('a', '2026-09-02', 10000)]).levels[1].remaining).toBe(0);
    expect(build([invoice('a', '2026-09-02', 6000)]).levels[1].remaining).toBe(4000);
    expect(build([]).levels[1].remaining).toBe(10000);
    const reversed = build([invoice('a', '2026-08-02', 15000), invoice('b', '2026-09-02', -10000)]);
    expect(reversed.levels[1].remaining).toBe(5000);
    expect(reversed.levels[1].progress).toBe(0);
  });

  it('separates partially unpaid overdue bills, today’s bills, future bills and undated balances', () => {
    const rows = [
      invoice('late', '2026-09-01', 2000, { savedDueDate: '2026-09-10' }),
      invoice('today', '2026-09-02', 500, { savedDueDate: '2026-09-14' }),
      invoice('future', '2026-09-03', 700),
      invoice('undated', '2026-09-04', 300, { savedDueDate: 'invalid', dueDate: 'invalid' })
    ];
    const journey = build(rows, [payment('late', 700), payment('late', 1000, '2026-09-15')]);
    expect(journey.overdue).toBe(1300);
    expect(journey.dueToday).toBe(500);
    expect(journey.dueNow).toBe(1800);
    expect(journey.futureDue).toBe(700);
    expect(journey.undatedBalance).toBe(300);
    expect(build(rows, [payment('late', 2000), payment('today', 500)]).dueNow).toBe(0);
  });

  it('does not mark a higher level as granted just because purchases are complete', () => {
    const journey = buildPartnerLevelJourney(customer, [invoice('a', '2026-09-01', 60000)], [], DEFAULT_SETTINGS,
      { ...internal, isOnboarding: true, onboardingStage: 'Stage A', paymentDisciplineScore: 50 }, '2026-09-14');
    expect(journey.levels[3].purchaseMet).toBe(true);
    expect(journey.levels[3].state).toBe('higher');
    expect(journey.levels[3].historyMessage).toContain('more than one order');
    expect(journey.levels[3].paymentMessage).toContain('paying on time');
  });

  it('uses effective credit settings and fixed coin rates for Platinum maintenance', () => {
    const journey = buildPartnerLevelJourney(customer, [], [], {
      ...DEFAULT_SETTINGS, creditDays: { ...DEFAULT_SETTINGS.creditDays, 'Tier 1': 12 },
      giftPercentages: { ...DEFAULT_SETTINGS.giftPercentages, 'Tier 1': 0 }
    }, { ...internal, tier: 'Tier 1' }, '2026-09-14');
    expect(journey.levels[3]).toMatchObject({ state: 'current', creditDays: 12, earnsCoins: true, higherCoinRate: true, remaining: 50000 });
    expect(journey.levels.slice(0, 3).every((level) => level.state === 'included')).toBe(true);
  });

  it('renders four goals, payment guidance and benefits without internal scores or profit details', () => {
    const journey = build([invoice('due', '2026-09-01', 3000, { savedDueDate: '2026-09-10' })]);
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/', children:
      createElement(CustomerLevelJourney, { journey, loading: false, onRefresh: () => undefined })
    }));
    expect(html).toContain('Benefits at every level');
    expect(html).toContain('Partner Coins · Same invoice');
    expect(html).toContain('40');
    expect(html).not.toContain('Met today');
    expect(html).not.toContain('Last 60 days counted');
    expect(html).not.toMatch(/\bPC\b/);
    expect(html.match(/class="partner-coin-comparison"/g)).toHaveLength(4);
    expect(html.match(/class="partner-purchase-amounts"/g)).toHaveLength(4);
    expect(html).not.toContain('How is my target worked out?');
    expect(html).not.toContain('Coin example: eligible invoice paid on time.');
    expect(html).not.toContain('Build your partnership. Enjoy the benefits.');
    expect(html).toContain('₹3,000 to pay now');
    expect(html).toContain('Silver Partner');
    expect(html).toContain('Gold Partner');
    expect(html).toContain('Platinum Partner');
    expect(html.match(/role="progressbar"/g)).toHaveLength(3);
    expect(html).not.toMatch(/score|profit|margin/i);
    expect(JSON.stringify(journey)).not.toMatch(/score|profit|margin/i);
    expect(html).toContain('/customer/invoices');
  });

  it('shows a new-account blocker on completed higher targets but never on current or incomplete levels', () => {
    const rows = [invoice('first', '2026-09-01', 12000)];
    const score = buildCustomerScores([customer], rows, [], new Date('2026-09-14T12:00:00'), DEFAULT_SETTINGS)[0];
    const journey = buildPartnerLevelJourney(customer, rows, [], DEFAULT_SETTINGS, score, '2026-09-14');
    expect(score.tier).toBe('Tier 4');
    expect(journey.levels[1].purchaseMet).toBe(true);
    expect(journey.levels[1].upgradeReasons[0]).toContain('More than one order');
    expect(journey.levels[0].upgradeReasons).toEqual([]);
    expect(journey.levels[2].upgradeReasons).toEqual([]);
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/', children:
      createElement(CustomerLevelJourney, { journey, loading: false, onRefresh: () => undefined })
    }));
    expect(html).toContain('Upgrade not unlocked');
    expect(html.match(/class="partner-notice-pin"/g)).toHaveLength(1);
    expect(html.match(/class="partner-purchase-slot"/g)).toHaveLength(4);
    expect(html.match(/class="partner-purchase-amounts"/g)).toHaveLength(3);
    expect(html).toContain('More than one order');
    expect(html).toContain('COMPLETED');
    expect(html).not.toMatch(/score|profit|margin/i);
    expect(JSON.stringify(journey)).not.toMatch(/score|profit|margin/i);
  });

  it('does not blame a Silver onboarding cap for a blocked Silver upgrade', () => {
    const rows = [invoice('first', '2026-09-01', 5000, { savedDueDate: '2026-09-01' }),
      invoice('second', '2026-09-02', 5000, { savedDueDate: '2026-09-02' })];
    const score = buildCustomerScores([customer], rows, [], new Date('2026-09-14T12:00:00'), DEFAULT_SETTINGS)[0];
    expect(score.onboardingStage).toBe('Stage B');
    const journey = buildPartnerLevelJourney(customer, rows, [], DEFAULT_SETTINGS, score, '2026-09-14');
    expect(journey.levels[1].upgradeReasons[0]).toContain('Overdue bills');
    expect(journey.levels[1].upgradeReasons.join(' ')).not.toContain('30 days');
  });

  it('clears the notice after payment and qualification, without changing the target calculation', () => {
    const rows = [invoice('older', '2026-07-10', 10000, { totalProfit: 3000, savedDueDate: '2026-07-20' }),
      invoice('recent', '2026-09-01', 30000, { totalProfit: 9000, savedDueDate: '2026-09-10' })];
    const paid = [payment('older', 10000, '2026-07-10'), payment('recent', 30000, '2026-09-01')];
    const evaluate = (payments: Payment[]) => {
      const score = buildCustomerScores([customer], rows, payments, new Date('2026-09-14T12:00:00'), DEFAULT_SETTINGS)[0];
      return buildPartnerLevelJourney(customer, rows, payments, DEFAULT_SETTINGS, score, '2026-09-14');
    };
    const before = evaluate([]);
    expect(before.levels[1].upgradeReasons[0]).toContain('Overdue bills');
    const after = evaluate(paid);
    expect(after.levels[1].upgradeReasons).toEqual([]);
    expect(after.levels[1].purchaseMet).toBe(true);
    expect(after.levels[1].monthlyTarget).toBe(before.levels[1].monthlyTarget);
  });

  it('explains payment history and high unpaid balance for completed Gold or Platinum targets', () => {
    const rows = [invoice('recent', '2026-09-01', 60000)];
    const journey = buildPartnerLevelJourney(customer, rows, [], DEFAULT_SETTINGS,
      { ...internal, tier: 'Tier 3', intelligenceScore: 90, totalSales: 60000, customerMonthlySales: 30000,
        outstanding: 40000, paymentDisciplineScore: 50 }, '2026-09-14');
    expect(journey.levels[2].upgradeReasons.join(' ')).toContain('Recent late payments');
    expect(journey.levels[2].upgradeReasons.join(' ')).toContain('unpaid balance');
    expect(journey.levels[1].upgradeReasons).toEqual([]);
  });

  it('uses a private eligibility explanation when buying is complete without another blocking gate', () => {
    const journey = build([invoice('recent', '2026-09-01', 10000)]);
    expect(journey.levels[1].upgradeReasons[0]).toContain('overall account history');
    expect(JSON.stringify(journey)).not.toMatch(/score|profit|margin/i);
  });

});
