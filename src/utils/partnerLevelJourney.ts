import type { AppSettings, Customer, CustomerTier, Invoice, Payment } from '../types';
import { getPartnerUpgradeReasons, PARTNER_PURCHASE_MINIMUMS, PARTNER_REVIEW_DAYS, type PartnerUpgradeContext } from './customerAnalytics';
import { addDaysToDateString, getTodayDateString } from './dateUtils';
import { calculateDueStatus } from './customerPortal';
import { getBusinessInvoices, getPreviousOutstandingFallback } from './openingBalance';
import { getCreditDaysForTierFromSettings, getGiftPercentageForTier } from './settings';
import { getTierDisplayName } from './tiers';

const TIERS: CustomerTier[] = ['Tier 4', 'Tier 3', 'Tier 2', 'Tier 1'];
const money = (value: number) => Math.round(value * 100) / 100;
const positive = (value: number) => Math.max(0, money(value));

export interface PartnerLevelTile {
  tier: CustomerTier;
  name: string;
  state: 'current' | 'included' | 'next' | 'higher';
  monthlyTarget: number;
  remaining: number;
  progress: number;
  purchaseMet: boolean;
  startingLevel: boolean;
  historyMessage?: string;
  paymentMessage?: string;
  unlockDate?: string;
  upgradeReasons: string[];
  creditDays: number;
  earnsCoins: boolean;
  higherCoinRate: boolean;
  coinComparison: { tier: CustomerTier; name: string; coins: number }[];
}

export interface PartnerLevelJourney {
  monthName: string;
  asOf: string;
  windowStart: string;
  currentName: string;
  thisMonthPurchases: number;
  earlierPurchases: number;
  overdue: number;
  dueToday: number;
  dueNow: number;
  futureDue: number;
  nextDueDate?: string;
  nextDueAmount: number;
  undatedBalance: number;
  levels: PartnerLevelTile[];
}

// This return value contains customer-facing guidance only. Internal scores and
// margins stay out of the component props and rendered content.
export function buildPartnerLevelJourney(
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings,
  internal: PartnerUpgradeContext,
  today = getTodayDateString()
): PartnerLevelJourney {
  const windowStart = addDaysToDateString(today, 1 - PARTNER_REVIEW_DAYS);
  const monthStart = `${today.slice(0, 7)}-01`;
  const ownInvoices = invoices.filter((invoice) => invoice.customerId === customer.id && invoice.date <= today);
  const invoiceIds = new Set(ownInvoices.map((invoice) => invoice.id));
  const ownPayments = payments.filter((payment) => invoiceIds.has(payment.invoiceId) && payment.date <= today);
  const recent = getBusinessInvoices(ownInvoices).filter((invoice) => invoice.date >= windowStart);
  // Signed totals preserve the existing qualification treatment of corrections.
  const thisMonthPurchases = money(recent.filter((invoice) => invoice.date >= monthStart).reduce((sum, invoice) => sum + invoice.totalSales, 0));
  const earlierPurchases = money(recent.filter((invoice) => invoice.date < monthStart).reduce((sum, invoice) => sum + invoice.totalSales, 0));
  const views = ownInvoices.map((invoice) => calculateDueStatus(invoice, ownPayments, today, customer.tier, settings));
  const unpaid = views.filter((view) => view.outstandingAmount > 0);
  const dated = unpaid.filter((view) => view.status !== 'Due date not set');
  const overdue = positive(dated.filter((view) => view.daysRemaining < 0).reduce((sum, view) => sum + view.outstandingAmount, 0));
  const dueToday = positive(dated.filter((view) => view.daysRemaining === 0).reduce((sum, view) => sum + view.outstandingAmount, 0));
  const future = dated.filter((view) => view.daysRemaining > 0).sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate));
  const nextDueDate = future[0]?.invoice.dueDate;
  const nextDueAmount = positive(future
    .filter((view) => view.invoice.dueDate === nextDueDate)
    .reduce((sum, view) => sum + view.outstandingAmount, 0));
  const undatedBalance = positive(getPreviousOutstandingFallback(customer, ownInvoices)
    + unpaid.filter((view) => view.status === 'Due date not set').reduce((sum, view) => sum + view.outstandingAmount, 0));
  const currentIndex = TIERS.indexOf(internal.tier);
  const activityStart = [...ownInvoices]
    .map((invoice) => invoice.date.slice(0, 10))
    .filter(Boolean)
    .sort()[0] || customer.createdAt?.slice(0, 10) || '';
  // Compare the same eligible invoice, normalized to 10 PC at Active's rate.
  // Only example coin amounts reach the view; no invoice margin is exposed.
  const activeCoinRate = getGiftPercentageForTier('Tier 4', settings);
  const coinExamples = TIERS.map((tier) => ({
    tier, name: getTierDisplayName(tier),
    coins: activeCoinRate > 0 ? money(10 * getGiftPercentageForTier(tier, settings) / activeCoinRate) : 0
  }));
  const levels = TIERS.map((tier, index): PartnerLevelTile => {
    const startingLevel = index === 0;
    // A net reversal this month first offsets older purchases. Never let it
    // produce a negative target or pretend that a reversed purchase is progress.
    const monthlyTarget = startingLevel ? 0 : positive(PARTNER_PURCHASE_MINIMUMS[tier] * (PARTNER_REVIEW_DAYS / 30) - earlierPurchases - Math.min(0, thisMonthPurchases));
    const remaining = startingLevel ? 0 : positive(monthlyTarget - Math.max(0, thisMonthPurchases));
    const state = index === currentIndex ? 'current' : index < currentIndex ? 'included' : index === currentIndex + 1 ? 'next' : 'higher';
    let historyMessage: string | undefined;
    if (index > currentIndex && internal.isOnboarding) {
      if (internal.onboardingStage === 'Stage A') historyMessage = 'You are just getting started. Build your purchase history with more than one order.';
      else if (internal.onboardingStage === 'Stage B' && index >= 2) historyMessage = 'Keep ordering and paying on time. Your account needs more than 30 days of purchase history for this level.';
      else if (internal.onboardingStage === 'Stage C' && index === 3) historyMessage = 'Build at least 60 days of purchase history, with orders in two months, to reach Platinum.';
    }
    const earliestUnlockDate = index > currentIndex && activityStart
      ? tier === 'Tier 1' && internal.onboardingStage !== 'Stage D'
        ? addDaysToDateString(activityStart, 60)
        : (tier === 'Tier 2' || tier === 'Tier 1') && (internal.onboardingStage === 'Stage A' || internal.onboardingStage === 'Stage B')
          ? addDaysToDateString(activityStart, 31)
          : undefined
      : undefined;
    const unlockDate = earliestUnlockDate && earliestUnlockDate > today ? earliestUnlockDate : undefined;
    return {
      tier, name: getTierDisplayName(tier), state, monthlyTarget, remaining,
      progress: monthlyTarget > 0 ? Math.min(100, Math.max(0, Math.floor(Math.max(0, thisMonthPurchases) / monthlyTarget * 100))) : 100,
      purchaseMet: remaining === 0, startingLevel, historyMessage, unlockDate,
      upgradeReasons: remaining === 0 && index > currentIndex
        ? getPartnerUpgradeReasons(tier, customer, invoices, payments, settings, internal, new Date(`${today}T12:00:00`))
        : [],
      paymentMessage: tier === 'Tier 1' && internal.paymentDisciplineScore < 90
        ? 'Platinum needs a strong record of paying on time. Pay each upcoming bill by its due date.'
        : undefined,
      creditDays: Math.max(0, getCreditDaysForTierFromSettings(tier, settings)),
      earnsCoins: getGiftPercentageForTier(tier, settings) > 0,
      coinComparison: activeCoinRate > 0 ? coinExamples.slice(0, index + 1) : [],
      higherCoinRate: index > 0 && getGiftPercentageForTier(tier, settings) > getGiftPercentageForTier('Tier 4', settings)
    };
  });
  return {
    monthName: new Date(`${monthStart}T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    asOf: today, windowStart, currentName: getTierDisplayName(internal.tier), thisMonthPurchases, earlierPurchases,
    overdue, dueToday, dueNow: positive(overdue + dueToday),
    futureDue: positive(future.reduce((sum, view) => sum + view.outstandingAmount, 0)),
    nextDueDate, nextDueAmount, undatedBalance, levels
  };
}
