import type { AppSettings, Customer, Invoice, MonthlyCustomerStats, PartnerLevel, Payment } from '../types';
import { calculateDueStatus } from './customerPortal';
import { getCurrentMonthRange } from './dateUtils';
import { getTierTargetSettings, mergeWithDefaultSettings } from './settings';

export const PARTNER_LEVELS: PartnerLevel[] = ['Active Partner', 'Silver Partner', 'Gold Partner', 'Platinum Partner'];

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getCurrentMonthKey = () => {
  const range = getCurrentMonthRange();
  return range.fromDate.slice(0, 7);
};

export const getMonthlyStatsId = (customerId: string, month: string) => `${customerId}_${month.replace('-', '_')}`;

export const formatApc = (value: unknown) => `${Math.max(0, Math.round(numberOrZero(value)))}`;

export const getPartnerLevelForPoints = (points: number, settings?: AppSettings): PartnerLevel => {
  const thresholds = mergeWithDefaultSettings(settings).loyaltySettings.partnerLevelThresholds;

  return PARTNER_LEVELS.reduce<PartnerLevel>((currentLevel, level) => {
    return points >= numberOrZero(thresholds[level]) ? level : currentLevel;
  }, 'Active Partner');
};

export const getNextPartnerLevel = (level: PartnerLevel) => {
  const index = PARTNER_LEVELS.indexOf(level);
  return index >= 0 && index < PARTNER_LEVELS.length - 1 ? PARTNER_LEVELS[index + 1] : undefined;
};

export const getPartnerLevelThreshold = (level: PartnerLevel, settings?: AppSettings) => {
  return numberOrZero(mergeWithDefaultSettings(settings).loyaltySettings.partnerLevelThresholds[level]);
};

export const getLevelProgressPercent = (points: number, level: PartnerLevel, settings?: AppSettings) => {
  const thresholds = mergeWithDefaultSettings(settings).loyaltySettings.partnerLevelThresholds;
  const nextLevel = getNextPartnerLevel(level);

  if (!nextLevel) return 100;

  const currentThreshold = numberOrZero(thresholds[level]);
  const nextThreshold = Math.max(currentThreshold + 1, numberOrZero(thresholds[nextLevel]));

  return Math.min(100, Math.max(0, Math.round(((points - currentThreshold) / (nextThreshold - currentThreshold)) * 100)));
};

export const canViewRewardAtLevel = (customerLevel: PartnerLevel, rewardLevel: PartnerLevel) => {
  return PARTNER_LEVELS.indexOf(customerLevel) >= PARTNER_LEVELS.indexOf(rewardLevel);
};

export const buildMonthlyCustomerStats = (
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings?: AppSettings,
  month = getCurrentMonthKey()
): MonthlyCustomerStats => {
  const activeSettings = mergeWithDefaultSettings(settings);
  const monthPrefix = `${month}-`;
  const monthlyInvoices = invoices.filter((invoice) => invoice.customerId === customer.id && invoice.date.startsWith(monthPrefix));
  const monthlyPayments = payments.filter((payment) => payment.customerId === customer.id && payment.date.startsWith(monthPrefix));
  const targetSettings = getTierTargetSettings(customer.tier, activeSettings);
  const totalSales = monthlyInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalSales), 0);
  const totalPayments = monthlyPayments.reduce((sum, payment) => sum + numberOrZero(payment.amount), 0);
  const overdueAmount = monthlyInvoices
    .map((invoice) => calculateDueStatus(invoice, payments, undefined, customer.tier, activeSettings))
    .filter((view) => view.outstandingAmount > 0 && view.daysRemaining < 0)
    .reduce((sum, view) => sum + view.outstandingAmount, 0);
  const purchasePoints = Math.floor(totalSales / 1000) * activeSettings.loyaltySettings.pointsPerThousand;
  const targetBonus = totalSales >= targetSettings.monthlySalesTarget && targetSettings.monthlySalesTarget > 0 ? activeSettings.loyaltySettings.monthlyTargetBonus : 0;
  const frequencyBonus = monthlyInvoices.length >= targetSettings.monthlyOrderTarget && targetSettings.monthlyOrderTarget > 0 ? activeSettings.loyaltySettings.orderFrequencyBonus : 0;
  const onTimeBonus = overdueAmount <= 0 && monthlyPayments.length > 0 ? activeSettings.loyaltySettings.onTimePaymentBonus : 0;
  const pointsEarned = Math.round(Math.max(0, purchasePoints + targetBonus + frequencyBonus + onTimeBonus));
  const currentLevel = getPartnerLevelForPoints(pointsEarned, activeSettings);

  return {
    id: getMonthlyStatsId(customer.id, month),
    customerId: customer.id,
    month,
    totalSales,
    totalPayments,
    orderCount: monthlyInvoices.length,
    overdueAmount,
    target: targetSettings.monthlySalesTarget,
    pointsEarned,
    currentLevel,
    progressPercent: getLevelProgressPercent(pointsEarned, currentLevel, activeSettings),
    updatedAt: new Date().toISOString()
  };
};
