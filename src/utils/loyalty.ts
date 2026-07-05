import type { AppSettings, Customer, CustomerTier, Invoice, MonthlyCustomerStats, PartnerLevel, Payment } from '../types';
import { calculateDueStatus, calculateInvoiceApcInfo } from './customerPortal';
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

export const formatPc = formatApc;

export const getPartnerLevelForTier = (tier?: CustomerTier): PartnerLevel => {
  if (tier === 'Tier 1') return 'Platinum Partner';
  if (tier === 'Tier 2') return 'Gold Partner';
  if (tier === 'Tier 3') return 'Silver Partner';
  return 'Active Partner';
};

export const getNextPartnerLevel = (level: PartnerLevel) => {
  const index = PARTNER_LEVELS.indexOf(level);
  return index >= 0 && index < PARTNER_LEVELS.length - 1 ? PARTNER_LEVELS[index + 1] : undefined;
};

export const getScoreNeededForNextPartnerLevel = (score: number, level: PartnerLevel) => {
  if (level === 'Active Partner') return Math.max(0, 41 - score);
  if (level === 'Silver Partner') return Math.max(0, 61 - score);
  if (level === 'Gold Partner') return Math.max(0, 81 - score);
  return 0;
};

export const getIntelligenceScoreProgressPercent = (score: number, level: PartnerLevel) => {
  if (level === 'Platinum Partner') return 100;

  const ranges: Record<Exclude<PartnerLevel, 'Platinum Partner'>, { min: number; next: number }> = {
    'Active Partner': { min: 0, next: 41 },
    'Silver Partner': { min: 41, next: 61 },
    'Gold Partner': { min: 61, next: 81 }
  };
  const range = ranges[level];

  return Math.min(100, Math.max(0, Math.round(((score - range.min) / (range.next - range.min)) * 100)));
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
  const apcEligibleInvoices = monthlyInvoices.filter((invoice) => calculateInvoiceApcInfo(invoice, payments, customer.tier, activeSettings).earnedApc > 0);
  const apcEligibleSales = apcEligibleInvoices.reduce((sum, invoice) => sum + numberOrZero(invoice.totalSales), 0);
  const invoiceApc = apcEligibleInvoices.reduce((sum, invoice) => sum + calculateInvoiceApcInfo(invoice, payments, customer.tier, activeSettings).earnedApc, 0);
  const targetBonus = apcEligibleSales >= targetSettings.monthlySalesTarget && targetSettings.monthlySalesTarget > 0 ? activeSettings.loyaltySettings.monthlyTargetBonus : 0;
  const frequencyBonus = apcEligibleInvoices.length >= targetSettings.monthlyOrderTarget && targetSettings.monthlyOrderTarget > 0 ? activeSettings.loyaltySettings.orderFrequencyBonus : 0;
  const pointsEarned = Math.round(Math.max(0, invoiceApc + targetBonus + frequencyBonus));
  const currentLevel = getPartnerLevelForTier(customer.tier);

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
    progressPercent: 100,
    updatedAt: new Date().toISOString()
  };
};
