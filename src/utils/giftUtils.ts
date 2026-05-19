import type { AppSettings, Customer, GiftHistory, GiftPeriod, Invoice } from '../types';
import { getGiftPercentageForTier } from './settings';

export const getGiftPeriodLabel = (period: GiftPeriod) => {
  if (period === '3_months') return '3 months';
  if (period === '6_months') return '6 months';
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
    const salesAmount = invoices
      .filter((invoice) => invoice.customerId === customer.id && invoice.date >= periodStart && invoice.date <= periodEnd)
      .reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const giftPercentage = getGiftPercentageForTier(customer.tier, settings);
    const giftBudget = Math.round(salesAmount * (giftPercentage / 100));
    const overlappingGifts = giftHistory.filter(
      (gift) =>
        gift.customerId === customer.id &&
        doPeriodsOverlap(periodStart, periodEnd, gift.periodStart, gift.periodEnd)
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
      giftPercentage,
      giftBudget,
      alreadyGiftedAmount,
      remainingEligibility,
      isDuplicatePeriod
    };
  });
};
