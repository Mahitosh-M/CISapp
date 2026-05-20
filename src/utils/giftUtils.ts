import type { AppSettings, Customer, CustomerScore, GiftHistory, GiftItem, GiftPeriod, Invoice } from '../types';
import { getGiftPercentageForTier } from './settings';

export const getGiftPeriodLabel = (period: GiftPeriod) => {
  if (period === '3_months') return '3 months';
  if (period === '6_months') return '6 months';
  if (period === 'custom') return 'Custom';
  return '1 year';
};

export const getGiftPeriodStart = (period: GiftPeriod, periodEnd: string) => {
  const [year, month, day] = periodEnd.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const monthsBack = period === '3_months' ? 3 : period === '6_months' ? 6 : 12;
  date.setMonth(date.getMonth() - monthsBack);
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const doPeriodsOverlap = (startA: string, endA: string, startB: string, endB: string) => {
  return startA <= endB && startB <= endA;
};

export const calculateCustomerGiftBudget = (profitConsidered: number, customer: Customer, settings: AppSettings) => {
  // Gift budget is based on profit percentage from Admin Settings, not sales.
  return Math.round(Math.max(0, profitConsidered) * (getGiftPercentageForTier(customer.tier, settings) / 100));
};

export const isGiftBudgetInRange = (giftBudget: number, giftItem: GiftItem) => {
  return giftBudget >= giftItem.minBudget && giftBudget <= giftItem.maxBudget;
};

export const hasAlreadyGiftedForPeriod = (
  customerId: string,
  giftHistory: GiftHistory[],
  periodStart: string,
  periodEnd: string
) => {
  // Duplicate prevention: a Given gift for any overlapping period blocks suggestions for that customer.
  return giftHistory.some(
    (gift) =>
      gift.customerId === customerId &&
      gift.status === 'Given' &&
      doPeriodsOverlap(periodStart, periodEnd, gift.periodStart, gift.periodEnd)
  );
};

export const getEligibleGiftItemsForCustomer = (
  customer: Customer,
  giftItems: GiftItem[],
  metrics: { sales: number; profit: number; score: number; giftBudget: number }
) => {
  return giftItems.filter((giftItem) => {
    if (!giftItem.isActive) return false;
    if (giftItem.eligibleTier !== 'All' && giftItem.eligibleTier !== customer.tier) return false;
    if (!isGiftBudgetInRange(metrics.giftBudget, giftItem)) return false;

    // Target type tells the engine which customer metric must reach the admin-defined target.
    const targetMetric =
      giftItem.targetType === 'sales' ? metrics.sales : giftItem.targetType === 'score' ? metrics.score : metrics.profit;

    return targetMetric >= giftItem.targetValue;
  });
};

export const suggestGiftItem = (budget: number, tier: Customer['tier']) => {
  if (budget <= 0) return 'No gift suggested';
  if (budget < 500) return 'sweet box';
  if (budget < 1500) return tier === 'Tier 1' ? 'dry fruits' : 'sweet box';
  if (budget < 4000) return tier === 'Tier 1' ? 'dinner set' : 'dry fruits';
  if (budget < 10000) return tier === 'Tier 1' ? 'cashback' : 'dinner set';
  return 'premium gift';
};

export const buildGiftEligibilityRows = (
  customers: Customer[],
  invoices: Invoice[],
  giftHistory: GiftHistory[],
  settings: AppSettings,
  periodType: GiftPeriod,
  periodStart: string,
  periodEnd: string
) => {
  return customers.map((customer) => {
    const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id && invoice.date >= periodStart && invoice.date <= periodEnd);
    const salesAmount = customerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const profitConsidered = customerInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const giftPercentage = getGiftPercentageForTier(customer.tier, settings);
    const giftBudget = calculateCustomerGiftBudget(profitConsidered, customer, settings);
    const overlappingGifts = giftHistory.filter(
      (gift) =>
        gift.customerId === customer.id &&
        gift.status === 'Given' &&
        doPeriodsOverlap(periodStart, periodEnd, gift.periodStart, gift.periodEnd)
    );
    const pendingApproval = giftHistory.find(
      (gift) =>
        gift.customerId === customer.id &&
        gift.status !== 'Given' &&
        gift.periodStart === periodStart &&
        gift.periodEnd === periodEnd
    );
    const alreadyGiftedAmount = overlappingGifts.reduce((sum, gift) => sum + gift.giftAmount, 0);
    const remainingEligibility = Math.max(0, giftBudget - alreadyGiftedAmount);
    const isDuplicatePeriod = overlappingGifts.length > 0;

    return {
      customer,
      periodType,
      periodStart,
      periodEnd,
      salesAmount,
      profitConsidered,
      giftPercentage,
      giftBudget,
      suggestedGiftItem: suggestGiftItem(giftBudget, customer.tier),
      alreadyGiftedAmount,
      remainingEligibility,
      isDuplicatePeriod,
      pendingApproval
    };
  });
};

export const buildSuggestedGiftRows = (
  customers: Customer[],
  invoices: Invoice[],
  giftHistory: GiftHistory[],
  giftItems: GiftItem[],
  settings: AppSettings,
  periodType: GiftPeriod,
  periodStart: string,
  periodEnd: string,
  customerScores: CustomerScore[]
) => {
  const scoreByCustomerId = new Map(customerScores.map((score) => [score.customerId, score]));

  return customers.map((customer) => {
    const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id && invoice.date >= periodStart && invoice.date <= periodEnd);
    const salesAmount = customerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const profitConsidered = customerInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const giftBudget = calculateCustomerGiftBudget(profitConsidered, customer, settings);
    const score = scoreByCustomerId.get(customer.id)?.intelligenceScore ?? 0;
    const alreadyGifted = hasAlreadyGiftedForPeriod(customer.id, giftHistory, periodStart, periodEnd);
    const pendingApproval = giftHistory.find(
      (gift) =>
        gift.customerId === customer.id &&
        gift.status !== 'Given' &&
        gift.periodStart === periodStart &&
        gift.periodEnd === periodEnd
    );
    const matchedGiftItems = alreadyGifted
      ? []
      : getEligibleGiftItemsForCustomer(customer, giftItems, {
          sales: salesAmount,
          profit: profitConsidered,
          score,
          giftBudget
        });

    const status = alreadyGifted ? 'Already Gifted' : matchedGiftItems.length > 0 ? 'Eligible' : 'Not Eligible';
    const eligibilityReason = alreadyGifted
      ? 'Gift already given for an overlapping period.'
      : matchedGiftItems.length > 0
        ? 'Target, tier, and budget range matched.'
        : 'No active gift item matched target, tier, and budget range.';

    return {
      customer,
      periodType,
      periodStart,
      periodEnd,
      salesAmount,
      profitConsidered,
      giftBudget,
      score,
      matchedGiftItems,
      suggestedGiftNames: matchedGiftItems.map((giftItem) => giftItem.giftItemName),
      status,
      eligibilityReason,
      alreadyGifted,
      pendingApproval
    };
  });
};
