import type { AppSettings, Customer, GiftHistory, GiftItem, GiftPeriod, Invoice } from '../types';
import { getGiftPercentageForTier } from './settings';

export const getGiftPeriodLabel = (period: GiftPeriod) => {
  if (period === '1_month') return '1 month';
  if (period === '3_months') return '3 months';
  if (period === '6_months') return '6 months';
  if (period === 'custom') return 'Custom';
  return '1 year';
};

const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getMonthEndDateString = (dateString: string) => {
  const [year, month] = dateString.split('-').map(Number);
  // Gift period end is always normalized to the last day of the selected month.
  return formatDateInputValue(new Date(year, month, 0));
};

export const getGiftPeriodStart = (period: GiftPeriod, periodEnd: string) => {
  const [year, month] = periodEnd.split('-').map(Number);
  const monthsInPeriod = period === '1_month' ? 1 : period === '3_months' ? 3 : period === '6_months' ? 6 : 12;
  // Minimum gift cycle is one full month. For multi-month periods, start on the
  // first day of the earliest month and end on the month-end date.
  return formatDateInputValue(new Date(year, month - monthsInPeriod, 1));
};

export const doPeriodsOverlap = (startA: string, endA: string, startB: string, endB: string) => {
  return startA <= endB && startB <= endA;
};

export const calculateCustomerGiftBudget = (profitConsidered: number, customer: Customer, settings: AppSettings) => {
  // Gift budget is based on profit percentage from Admin Settings, not sales.
  return Math.round(Math.max(0, profitConsidered) * (getGiftPercentageForTier(customer.tier, settings) / 100));
};

export const calculateGiftDifference = (customerGiftBudget: number, giftItem: GiftItem) => {
  return Math.max(0, customerGiftBudget - giftItem.targetValue);
};

export const getNearestGiftOptions = (giftItems: GiftItem[], customerGiftBudget: number) => {
  // customerGiftBudget comes from the Gifts page calculation: profit considered x tier gift percentage.
  // A gift item targetValue means "suggest this item only when the customer's budget reaches this value".
  const activeWithinBudget = giftItems
    .filter((giftItem) => giftItem.isActive && giftItem.targetValue <= customerGiftBudget)
    .sort((a, b) => b.targetValue - a.targetValue || a.giftItemName.localeCompare(b.giftItemName));

  // Pick the nearest top 3 distinct target values, then include every item sharing those values.
  // This keeps low-value noise out while still showing alternatives like Dinner Set A/B at the same value.
  const nearestTargetValues = Array.from(new Set(activeWithinBudget.map((giftItem) => giftItem.targetValue))).slice(0, 3);
  return activeWithinBudget.filter((giftItem) => nearestTargetValues.includes(giftItem.targetValue));
};

export const getSuggestedGiftItems = (giftItems: GiftItem[], customerGiftBudget: number) => {
  return getNearestGiftOptions(giftItems, customerGiftBudget);
};

export const getGiftHistoryRecordForPeriod = (
  customerId: string,
  giftHistory: GiftHistory[],
  periodStart: string,
  periodEnd: string
) => {
  // Duplicate prevention is based on the same customer and the exact same sales/profit period.
  // Approved or Given records both block another reward for that period.
  return giftHistory.find(
    (gift) =>
      gift.customerId === customerId &&
      gift.periodStart === periodStart &&
      gift.periodEnd === periodEnd &&
      (gift.status === 'Approved' || gift.status === 'Given')
  );
};

export const hasAlreadyGiftedForPeriod = (
  customerId: string,
  giftHistory: GiftHistory[],
  periodStart: string,
  periodEnd: string
) => {
  return Boolean(getGiftHistoryRecordForPeriod(customerId, giftHistory, periodStart, periodEnd));
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
    const periodGiftRecord = getGiftHistoryRecordForPeriod(customer.id, giftHistory, periodStart, periodEnd);
    const overlappingGifts = giftHistory.filter(
      (gift) =>
        gift.customerId === customer.id &&
        gift.status === 'Given' &&
        doPeriodsOverlap(periodStart, periodEnd, gift.periodStart, gift.periodEnd)
    );
    const pendingApproval = periodGiftRecord?.status === 'Approved' ? periodGiftRecord : undefined;
    const alreadyGiftedAmount = overlappingGifts.reduce((sum, gift) => sum + gift.giftAmount, 0);
    const remainingEligibility = Math.max(0, giftBudget - alreadyGiftedAmount);
    const isDuplicatePeriod = Boolean(periodGiftRecord);

    return {
      customer,
      periodType,
      periodStart,
      periodEnd,
      salesAmount,
      profitConsidered,
      giftPercentage,
      giftBudget,
      suggestedGiftItem: suggestGiftItem(remainingEligibility, customer.tier),
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
  periodEnd: string
) => {
  const giftBudgetRows = buildGiftEligibilityRows(customers, invoices, giftHistory, settings, periodType, periodStart, periodEnd);

  return giftBudgetRows.map((giftBudgetRow) => {
    const periodGiftRecord = getGiftHistoryRecordForPeriod(giftBudgetRow.customer.id, giftHistory, periodStart, periodEnd);
    // Approved gifts are still editable until they are marked Given, so keep the
    // same eligible options visible. Given gifts stay locked to prevent duplicates.
    const customerGiftBudget =
      periodGiftRecord?.status === 'Approved'
        ? periodGiftRecord.giftBudget ?? periodGiftRecord.suggestedGiftBudget ?? giftBudgetRow.remainingEligibility
        : giftBudgetRow.remainingEligibility;
    const matchedGiftItems = periodGiftRecord?.status === 'Given' ? [] : getSuggestedGiftItems(giftItems, customerGiftBudget);
    const status = periodGiftRecord?.status === 'Given'
      ? 'Already Gifted'
      : periodGiftRecord?.status === 'Approved'
        ? 'Approved'
        : matchedGiftItems.length > 0
          ? 'Eligible'
          : 'Not Eligible';
    const eligibilityReason = periodGiftRecord?.status === 'Given'
      ? 'Gift already marked as given for this exact period.'
      : periodGiftRecord?.status === 'Approved'
        ? 'Gift already approved for this exact period.'
        : matchedGiftItems.length > 0
          ? 'Gift item target value is within the customer gift budget.'
          : 'No active gift item target value is within the customer gift budget.';

    return {
      ...giftBudgetRow,
      // Suggested Gifts works with remaining gift budget after subtracting older
      // overlapping Given records. Example: 1-month gift already given, then a
      // 6-month review only suggests gifts for the unpaid balance.
      giftBudget: customerGiftBudget,
      customer: giftBudgetRow.customer,
      periodType,
      periodStart,
      periodEnd,
      matchedGiftItems,
      suggestedGiftNames: matchedGiftItems.map((giftItem) => giftItem.giftItemName),
      status,
      eligibilityReason,
      alreadyGifted: periodGiftRecord?.status === 'Given',
      pendingApproval: periodGiftRecord?.status === 'Approved' ? periodGiftRecord : undefined
    };
  });
};
