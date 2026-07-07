import type { AppSettings, BonusPcRequest, Customer, GiftHistory, GiftItem, GiftPeriod, Invoice, OverduePcRequest, Payment } from '../types';
import { calculateInvoiceApcInfo } from './customerPortal';
import { getBusinessInvoices } from './openingBalance';
import { getGiftPercentageForTier } from './settings';
import { getTierTargetSettings } from './settings';

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
  // Reward period end is always normalized to the last day of the selected month.
  return formatDateInputValue(new Date(year, month, 0));
};

export const getGiftPeriodStart = (period: GiftPeriod, periodEnd: string) => {
  const [year, month] = periodEnd.split('-').map(Number);
  const monthsInPeriod = period === '1_month' ? 1 : period === '3_months' ? 3 : period === '6_months' ? 6 : 12;
  // Minimum reward cycle is one full month. For multi-month periods, start on the
  // first day of the earliest month and end on the month-end date.
  return formatDateInputValue(new Date(year, month - monthsInPeriod, 1));
};

export const doPeriodsOverlap = (startA: string, endA: string, startB: string, endB: string) => {
  return startA <= endB && startB <= endA;
};

export const calculateCustomerGiftBudget = (profitConsidered: number, customer: Customer, settings: AppSettings) => {
  // PC points are based on profit percentage from Admin Settings, not sales.
  return Math.round(Math.max(0, profitConsidered) * (getGiftPercentageForTier(customer.tier, settings) / 100));
};

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const calculateCustomerApcBonuses = (
  customer: Customer,
  customerInvoices: Invoice[],
  customerPayments: Payment[],
  settings: AppSettings
) => {
  const businessInvoices = getBusinessInvoices(customerInvoices);
  const targetSettings = getTierTargetSettings(customer.tier, settings);
  const apcEligibleInvoices = businessInvoices.filter((invoice) => calculateInvoiceApcInfo(invoice, customerPayments, customer.tier, settings).earnedApc > 0);
  const totalSales = apcEligibleInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalSales), 0);
  const onTimePaymentBonus = 0;
  const monthlyTargetBonus =
    targetSettings.monthlySalesTarget > 0 && totalSales >= targetSettings.monthlySalesTarget
      ? numberOrZero(settings.loyaltySettings.monthlyTargetBonus)
      : 0;
  const orderFrequencyBonus =
    targetSettings.monthlyOrderTarget > 0 && apcEligibleInvoices.length >= targetSettings.monthlyOrderTarget
      ? numberOrZero(settings.loyaltySettings.orderFrequencyBonus)
      : 0;

  return {
    onTimePaymentBonus,
    monthlyTargetBonus,
    orderFrequencyBonus,
    totalBonus: onTimePaymentBonus + monthlyTargetBonus + orderFrequencyBonus
  };
};

export const calculateCustomerAvailableApc = (
  customer: Customer,
  customerInvoices: Invoice[],
  customerPayments: Payment[],
  giftHistory: GiftHistory[],
  settings: AppSettings,
  approvedOverduePcRequests: OverduePcRequest[] = [],
  approvedBonusPcRequests: BonusPcRequest[] = []
) => {
  const businessInvoices = getBusinessInvoices(customerInvoices);
  const profitConsidered = businessInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalProfit), 0);
  const baseApcPoints = businessInvoices.reduce(
    (sum, invoice) => sum + calculateInvoiceApcInfo(invoice, customerPayments, customer.tier, settings).earnedApc,
    0
  );
  const bonusApcPoints = calculateCustomerApcBonuses(customer, businessInvoices, customerPayments, settings).totalBonus;
  const redeemedApcPoints = giftHistory
    .filter((gift) => gift.customerId === customer.id && gift.status === 'Given')
    .reduce((sum, gift) => sum + numberOrZero(gift.giftAmount || gift.actualGiftAmount), 0);
  const overduePcPoints = approvedOverduePcRequests
    .filter((request) => request.customerId === customer.id && request.status === 'Approved')
    .reduce((sum, request) => sum + numberOrZero(request.approvedCoins), 0);
  const approvedBonusPcPoints = approvedBonusPcRequests
    .filter((request) => request.customerId === customer.id && request.status === 'Approved')
    .reduce((sum, request) => sum + numberOrZero(request.approvedCoins), 0);

  return {
    salesAmount: businessInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalSales), 0),
    profitConsidered,
    baseApcPoints,
    bonusApcPoints,
    overduePcPoints,
    approvedBonusPcPoints,
    redeemedApcPoints,
    availableApcPoints: Math.max(0, Math.round(baseApcPoints + bonusApcPoints + overduePcPoints + approvedBonusPcPoints - redeemedApcPoints))
  };
};

export const calculateGiftDifference = (availableApcPoints: number, giftItem: GiftItem) => {
  return Math.max(0, availableApcPoints - giftItem.targetValue);
};

export const getNearestGiftOptions = (giftItems: GiftItem[], customerGiftBudget: number) => {
  // availableApcPoints comes from the PC calculation minus rewards already redeemed.
  // A reward targetValue means "suggest this reward only when available PC reaches this value".
  const activeWithinBudget = giftItems
    .filter((giftItem) => giftItem.isActive && giftItem.targetValue <= customerGiftBudget)
    .sort((a, b) => b.targetValue - a.targetValue || a.giftItemName.localeCompare(b.giftItemName));

  // Pick the nearest top 3 distinct target values, then include every reward sharing those values.
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
  payments: Payment[] = [],
  approvedOverduePcRequests: OverduePcRequest[] = [],
  approvedBonusPcRequests: BonusPcRequest[] = []
) => {
  return customers.map((customer) => {
    const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
    const customerPayments = payments.filter((payment) => payment.customerId === customer.id);
    const apcTotals = calculateCustomerAvailableApc(customer, customerInvoices, customerPayments, giftHistory, settings, approvedOverduePcRequests, approvedBonusPcRequests);
    const giftPercentage = getGiftPercentageForTier(customer.tier, settings);
    const pendingApproval = giftHistory.find((gift) => gift.customerId === customer.id && gift.status === 'Approved');

    return {
      customer,
      salesAmount: apcTotals.salesAmount,
      profitConsidered: apcTotals.profitConsidered,
      giftPercentage,
      giftBudget: apcTotals.availableApcPoints,
      bonusApcPoints: apcTotals.bonusApcPoints,
      suggestedGiftItem: suggestGiftItem(apcTotals.availableApcPoints, customer.tier),
      alreadyGiftedAmount: apcTotals.redeemedApcPoints,
      remainingEligibility: apcTotals.availableApcPoints,
      isDuplicatePeriod: Boolean(pendingApproval),
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
  payments: Payment[] = [],
  approvedOverduePcRequests: OverduePcRequest[] = [],
  approvedBonusPcRequests: BonusPcRequest[] = []
) => {
  const giftBudgetRows = buildGiftEligibilityRows(customers, invoices, giftHistory, settings, payments, approvedOverduePcRequests, approvedBonusPcRequests);

  return giftBudgetRows.map((giftBudgetRow) => {
    const pendingApproval = giftBudgetRow.pendingApproval;
    const customerGiftBudget = pendingApproval?.giftBudget ?? pendingApproval?.suggestedGiftBudget ?? giftBudgetRow.remainingEligibility;
    const matchedGiftItems = getSuggestedGiftItems(giftItems, customerGiftBudget);
    const status = pendingApproval?.status === 'Approved'
        ? 'Approved'
        : matchedGiftItems.length > 0
          ? 'Eligible'
          : 'Not Eligible';
    const eligibilityReason = pendingApproval?.status === 'Approved'
        ? 'Reward already approved for this customer.'
        : matchedGiftItems.length > 0
          ? 'Reward cost is within the customer available PC points.'
          : 'No active reward cost is within the customer available PC points.';

    return {
      ...giftBudgetRow,
      giftBudget: customerGiftBudget,
      customer: giftBudgetRow.customer,
      matchedGiftItems,
      suggestedGiftNames: matchedGiftItems.map((giftItem) => giftItem.giftItemName),
      status,
      eligibilityReason,
      alreadyGifted: false,
      pendingApproval
    };
  });
};
