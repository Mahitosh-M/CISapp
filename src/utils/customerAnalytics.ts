import type {
  AppSettings,
  Customer,
  CustomerMovement,
  CustomerScore,
  CustomerTier,
  IntelligenceSummary,
  Invoice,
  MonthlyRankingGroup,
  OnboardingStage,
  Payment,
  RiskLevel,
  ScoreBreakdownItem,
  TierCreditPolicy
} from '../types';
import { getInvoicePaymentEffect, getPendingAmount } from './paymentUtils';
import { getBusinessInvoices, getPreviousOutstandingFallback } from './openingBalance';
import {
  getEffectiveInvoiceDueDate,
  getCreditDaysForTierFromSettings,
  getGiftPercentageForTier,
  getPaymentBufferForTier,
  getPaymentTermsLabel,
  getTierTargetSettings,
  normalizeScoreWeights
} from './settings';
import { formatDate } from './formatters';
import { getTierDisplayName } from './tiers';

interface DateWindow {
  start: Date;
  end: Date;
}

interface ScoreInput {
  customer: Customer;
  customerInvoices: Invoice[];
  totalSales: number;
  totalProfit: number;
  totalPayments: number;
  previousOutstandingAmount: number;
  newOutstanding: number;
  outstanding: number;
  invoiceCount: number;
  averageOrderValue: number;
  customerMonthlySales: number;
  customerMonthlyOrders: number;
  allCustomerInvoices: Invoice[];
}

// Phase 1 scoring weights. Keep these as constants so later reports use the same rules.
export const SCORE_WEIGHTS = {
  profit: 0.3,
  paymentDiscipline: 0.3,
  frequency: 0.2,
  sales: 0.15,
  loyalty: 0.05
};

const ONBOARDING_MIN_TARGET = 4000;
const EXPECTED_MARGIN_PERCENT = 10;

// Tier credit rules are stored with the intelligence result for later Phase 2 due-date work.
export const TIER_CREDIT_POLICIES: Record<CustomerTier, TierCreditPolicy> = {
  'Tier 1': {
    tier: 'Tier 1',
    creditDays: 15,
    bufferDays: 3,
    label: '15 day credit + 3 day buffer',
    description: 'Strategic account with strong value and payment discipline.'
  },
  'Tier 2': {
    tier: 'Tier 2',
    creditDays: 10,
    bufferDays: 0,
    label: '10 day credit',
    description: 'Loyal medium customer with controlled credit exposure.'
  },
  'Tier 3': {
    tier: 'Tier 3',
    creditDays: 0,
    bufferDays: 0,
    label: 'No credit',
    description: 'Developing partner with limited credit until score improves.'
  },
  'Tier 4': {
    tier: 'Tier 4',
    creditDays: 0,
    bufferDays: 0,
    label: 'No credit',
    description: 'Same day payment preferred until score improves.'
  }
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseDate = (dateString: string) => {
  const normalizedDate = dateString.slice(0, 10);
  const [year, month, day] = normalizedDate.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

const daysBetween = (start: Date, end: Date) => Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / MS_PER_DAY);

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const capScore = (value: number) => clamp(Math.round(Number.isFinite(value) ? value : 0), 0, 100);

const roundMoney = (value: number) => Math.round(value);

const isDateInsideWindow = (dateString: string, window: DateWindow) => {
  const date = parseDate(dateString);
  return date >= startOfDay(window.start) && date <= endOfDay(window.end);
};

const formatPeriodDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return formatDate(`${year}-${month}-${day}`);
};

// Current rolling window = last 60 days ending today.
// Admin targets are monthly, so scores compare this window against a two-month average.
const getCurrentRollingWindow = (referenceDate: Date): DateWindow => {
  const end = endOfDay(referenceDate);
  const start = startOfDay(addDays(referenceDate, -59));
  return { start, end };
};

const getPreviousRollingWindow = (referenceDate: Date): DateWindow => {
  const end = endOfDay(addDays(referenceDate, -60));
  const start = startOfDay(addDays(referenceDate, -119));
  return { start, end };
};

const getWindowLabel = (window: DateWindow) => `${formatPeriodDate(window.start)} to ${formatPeriodDate(window.end)}`;

const getPaymentsForInvoice = (invoiceId: string, payments: Payment[], asOfDate: Date) => {
  return payments
    .filter((payment) => payment.invoiceId === invoiceId && parseDate(payment.date) <= endOfDay(asOfDate))
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
};

const getPaidAmountForInvoice = (invoiceId: string, payments: Payment[], asOfDate: Date) => {
  return getPaymentsForInvoice(invoiceId, payments, asOfDate).reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
};

const getInvoicePaidDate = (invoice: Invoice, payments: Payment[], asOfDate: Date) => {
  const invoicePayments = getPaymentsForInvoice(invoice.id, payments, asOfDate);
  let paidTotal = 0;

  for (const payment of invoicePayments) {
    paidTotal += getInvoicePaymentEffect(payment);

    if (paidTotal >= invoice.totalSales) {
      return parseDate(payment.date);
    }
  }

  return null;
};

const getActiveMonthCount = (invoices: Invoice[]) => {
  const activeMonths = new Set(
    invoices.map((invoice) => {
      const date = parseDate(invoice.date);
      return `${date.getFullYear()}-${date.getMonth()}`;
    })
  );

  return activeMonths.size;
};

const getAverageTargetMonthCount = (window: DateWindow) => Math.max(1, (daysBetween(window.start, window.end) + 1) / 30);

const getWholeOrderCount = (value: number) => Math.max(0, Math.round(value));

const tierOrder: Record<CustomerTier, number> = {
  'Tier 1': 4,
  'Tier 2': 3,
  'Tier 3': 2,
  'Tier 4': 1
};

const capTier = (tier: CustomerTier, maximumTier: CustomerTier) => (tierOrder[tier] > tierOrder[maximumTier] ? maximumTier : tier);

const getCustomerAgeDays = (customer: Customer, asOfDate: Date) => {
  if (!customer.createdAt) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, daysBetween(parseDate(customer.createdAt), asOfDate));
};

const getOnboardingStage = (customer: Customer, invoiceCount: number, activeMonthCount: number, asOfDate: Date): OnboardingStage => {
  const customerAgeDays = getCustomerAgeDays(customer, asOfDate);

  if (customerAgeDays >= 60 && invoiceCount >= 2 && activeMonthCount >= 2) {
    return 'Stage D';
  }

  if (invoiceCount <= 1) {
    return 'Stage A';
  }

  if (customerAgeDays <= 30) {
    return 'Stage B';
  }

  return 'Stage C';
};

const getConfidenceFactor = (invoiceCount: number, activeMonthCount: number) => {
  if (activeMonthCount >= 2) {
    return 1;
  }

  if (invoiceCount >= 2) {
    return 0.7;
  }

  if (invoiceCount === 1) {
    return 0.5;
  }

  return 0;
};

const getPreviousMonthSales = (customerId: string, invoices: Invoice[], asOfDate: Date) => {
  const previousMonthStart = new Date(asOfDate.getFullYear(), asOfDate.getMonth() - 1, 1);
  const previousMonthEnd = endOfMonth(previousMonthStart);

  return invoices
    .filter((invoice) => invoice.customerId === customerId && isDateInsideWindow(invoice.date, { start: previousMonthStart, end: previousMonthEnd }))
    .reduce((sum, invoice) => sum + invoice.totalSales, 0);
};

const getFirstInvoiceAmount = (invoices: Invoice[]) => {
  const firstInvoice = [...invoices].sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime())[0];
  return firstInvoice?.totalSales ?? 0;
};

const getExpectedOrderTarget = (monthlySalesTarget: number) => {
  if (monthlySalesTarget <= 5000) return 1;
  if (monthlySalesTarget <= 15000) return 2;
  if (monthlySalesTarget <= 30000) return 3;
  return 4;
};

const getSegmentTargetGuidance = (segmentRank: number) => {
  if (segmentRank <= 5) {
    return { growthFactor: 1.15, directionTarget: 24000 };
  }

  if (segmentRank <= 15) {
    return { growthFactor: 1.1, directionTarget: 13000 };
  }

  return { growthFactor: 1.05, directionTarget: 4000 };
};

const getSuggestedMonthlySalesTarget = (
  entry: ScoreInput,
  configuredTarget: number,
  segmentRank: number,
  onboardingStage: OnboardingStage,
  asOfDate: Date
) => {
  if (onboardingStage === 'Stage A' || onboardingStage === 'Stage B') {
    return roundMoney(Math.max(getFirstInvoiceAmount(entry.allCustomerInvoices) * 1.25, ONBOARDING_MIN_TARGET));
  }

  if (onboardingStage === 'Stage C') {
    return roundMoney(Math.max(getPreviousMonthSales(entry.customer.id, entry.allCustomerInvoices, asOfDate) * 1.1, ONBOARDING_MIN_TARGET));
  }

  const { growthFactor, directionTarget } = getSegmentTargetGuidance(segmentRank);
  const rollingTarget = Math.max(entry.customerMonthlySales * growthFactor, ONBOARDING_MIN_TARGET);
  const guidedTarget = Math.max(rollingTarget, Math.min(directionTarget, rollingTarget * 1.2));

  if (configuredTarget > 0) {
    return roundMoney(clamp(guidedTarget, configuredTarget * 0.8, configuredTarget * 1.2));
  }

  return roundMoney(guidedTarget);
};

const calculateProfitScore = (actualProfit: number, monthlySalesTarget: number, fallbackScore: number) => {
  if (actualProfit <= 0) {
    return 0;
  }

  const targetRollingProfit = Math.max(1, monthlySalesTarget * 2 * (EXPECTED_MARGIN_PERCENT / 100));
  return capScore((actualProfit / targetRollingProfit) * 100 || fallbackScore);
};

const hasOverdueBeyondAllowed = (customerInvoices: Invoice[], payments: Payment[], asOfDate: Date, tier: CustomerTier, settings?: AppSettings) => {
  return customerInvoices.some((invoice) => {
    const paidAmount = getPaidAmountForInvoice(invoice.id, payments, asOfDate);
    return getPendingAmount(invoice.totalSales, paidAmount) > 0 && parseDate(getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, tier, settings)) < startOfDay(asOfDate);
  });
};

const applyTierGates = (
  scoreTier: CustomerTier,
  customerMonthlySales: number,
  paymentDisciplineScore: number,
  hasOverdue: boolean,
  outstandingRatio: number,
  onboardingStage: OnboardingStage,
  isOnboarding: boolean
) => {
  let finalTier = scoreTier;
  const reasons: string[] = [];

  if (isOnboarding) {
    if (onboardingStage === 'Stage A') {
      finalTier = capTier(finalTier, 'Tier 4');
      reasons.push('First invoice customer remains Active until more history is available.');
    } else if (onboardingStage === 'Stage B') {
      finalTier = capTier(finalTier, 'Tier 3');
      reasons.push('First 30 days onboarding caps the level at Silver.');
    } else if (onboardingStage === 'Stage C') {
      finalTier = capTier(finalTier, 'Tier 2');
      reasons.push('31-60 day onboarding caps the level at Gold.');
    }
  }

  if (hasOverdue) {
    finalTier = capTier(finalTier, 'Tier 4');
    reasons.push('Overdue beyond allowed credit days caps the level at Active.');
  } else if (paymentDisciplineScore < 55 || outstandingRatio > 0.5) {
    finalTier = capTier(finalTier, 'Tier 3');
    reasons.push('Payment risk caps automatic upgrade at Silver.');
  }

  if (finalTier === 'Tier 1' && (customerMonthlySales < 30000 || paymentDisciplineScore < 90)) {
    finalTier = 'Tier 2';
    reasons.push('Score qualifies for Platinum, but sales/payment gate allows Gold.');
  }

  if (finalTier === 'Tier 2' && customerMonthlySales < 15000) {
    finalTier = 'Tier 3';
    reasons.push('Score qualifies for Gold, but sales gate allows Silver.');
  }

  if (finalTier === 'Tier 3' && customerMonthlySales < 5000) {
    finalTier = 'Tier 4';
    reasons.push('Score qualifies for Silver, but sales gate allows Active.');
  }

  return {
    tier: finalTier,
    tierCapReason: reasons[0]
  };
};

export const calculateSalesPerformanceScore = (customerMonthlySales: number, monthlySalesTarget: number, fallbackScore: number) => {
  if (monthlySalesTarget <= 0) {
    // Admin may temporarily set a zero target. Falling back preserves existing ranking behavior and avoids division by zero.
    return capScore(fallbackScore);
  }

  // Sales achievement is capped so a customer cannot score 140/100 by greatly exceeding the monthly target.
  return capScore((customerMonthlySales / monthlySalesTarget) * 100);
};

export const calculateOrderPerformanceScore = (
  customerMonthlyOrderCount: number,
  monthlyOrderTarget: number,
  averageOrderValue: number,
  monthlySalesTarget: number,
  fallbackScore: number
) => {
  if (monthlyOrderTarget <= 0) {
    // Zero target is treated as "use previous frequency logic" until Admin sets a meaningful target.
    return capScore(fallbackScore);
  }

  const baseScore = (customerMonthlyOrderCount / monthlyOrderTarget) * 100;
  const averageOrderStrength = monthlySalesTarget > 0 ? (averageOrderValue / monthlySalesTarget) * 100 : 0;
  const volumeProtection = customerMonthlyOrderCount < monthlyOrderTarget && averageOrderStrength >= 50 ? Math.min(25, averageOrderStrength * 0.25) : 0;

  // Large-value rare buyers receive a moderate boost, but the final order score is still capped at 100.
  return capScore(baseScore + volumeProtection);
};

const rateFrequencyScore = (invoiceCount: number, averageOrderValue: number, highestAverageOrderValue: number, window: DateWindow) => {
  if (invoiceCount === 0) {
    return 0;
  }

  const daysInWindow = Math.max(1, daysBetween(window.start, window.end) + 1);
  const weeksInWindow = daysInWindow / 7;

  // Target is one order per week. A volume protection boost prevents large rare buyers from being over-penalized.
  const weeklyOrderScore = Math.min(100, (invoiceCount / weeksInWindow) * 100);
  const volumeProtection = highestAverageOrderValue > 0 ? (averageOrderValue / highestAverageOrderValue) * 45 : 0;

  return clamp(Math.round(weeklyOrderScore + volumeProtection), 20, 100);
};

const ratePaymentDiscipline = (customerInvoices: Invoice[], payments: Payment[], asOfDate: Date, tier: CustomerTier, settings?: AppSettings) => {
  if (customerInvoices.length === 0) {
    return 0;
  }

  const delayMeasures = customerInvoices.map((invoice) => {
    const dueDate = parseDate(getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, tier, settings));
    const paidDate = getInvoicePaidDate(invoice, payments, asOfDate);

    if (paidDate) {
      return Math.max(0, daysBetween(dueDate, paidDate));
    }

    const paidAmount = getPaidAmountForInvoice(invoice.id, payments, asOfDate);
    const outstanding = getPendingAmount(invoice.totalSales, paidAmount);

    if (outstanding <= 0 || asOfDate <= dueDate) {
      return 0;
    }

    return Math.max(0, daysBetween(dueDate, asOfDate));
  });

  const averageDelay = delayMeasures.reduce((sum, value) => sum + value, 0) / delayMeasures.length;

  return clamp(Math.round(100 - averageDelay * 4), 20, 100);
};

const rateLoyaltyConsistency = (customerInvoices: Invoice[], window: DateWindow) => {
  if (customerInvoices.length === 0) {
    return 0;
  }

  const monthsInWindow = Math.max(1, Math.round(getAverageTargetMonthCount(window)));
  return clamp(Math.round((getActiveMonthCount(customerInvoices) / monthsInWindow) * 100), 30, 100);
};

const assignTier = (intelligenceScore: number): CustomerTier => {
  if (intelligenceScore >= 81) {
    return 'Tier 1';
  }

  if (intelligenceScore >= 61) {
    return 'Tier 2';
  }

  if (intelligenceScore >= 41) {
    return 'Tier 3';
  }

  return 'Tier 4';
};

const getRiskLevel = (tier: CustomerTier, paymentDisciplineScore: number, outstanding: number, outstandingBase: number): RiskLevel => {
  const outstandingRatio = outstandingBase > 0 ? outstanding / outstandingBase : 0;

  if (tier === 'Tier 4' || paymentDisciplineScore < 55 || outstandingRatio > 0.5) {
    return 'High';
  }

  if (tier === 'Tier 2' || tier === 'Tier 3' || paymentDisciplineScore < 75 || outstanding > 0) {
    return 'Medium';
  }

  return 'Low';
};

const getRecommendedAction = (riskLevel: RiskLevel, tier: CustomerTier, outstanding: number) => {
  if (riskLevel === 'High') {
    return outstanding > 0 ? 'Review credit before next order' : 'Keep on same-day payment until score improves';
  }

  if (tier === 'Tier 1') {
    return 'Protect relationship and prioritize service';
  }

  if (tier === 'Tier 2') {
    return 'Encourage weekly ordering and timely collection';
  }

  if (tier === 'Tier 3') {
    return 'Build ordering consistency and monitor collections';
  }

  return 'Monitor before increasing credit';
};

const getOverdueStatus = (customerInvoices: Invoice[], payments: Payment[], asOfDate: Date, tier: CustomerTier, settings?: AppSettings) => {
  const hasOverdueInvoice = customerInvoices.some((invoice) => {
    const paidAmount = getPaidAmountForInvoice(invoice.id, payments, asOfDate);
    return getPendingAmount(invoice.totalSales, paidAmount) > 0 && parseDate(getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, tier, settings)) < startOfDay(asOfDate);
  });

  return hasOverdueInvoice ? 'Overdue' : 'Clear';
};

const getMovementDetails = (current: CustomerScore, previous?: CustomerScore): { movement: CustomerMovement; movementReason: string } => {
  if (!previous || previous.invoiceCount === 0) {
    return {
      movement: current.invoiceCount > 0 ? 'New' : 'Stable',
      movementReason: current.invoiceCount > 0 ? 'New activity in current rolling window' : 'No activity in both comparison windows'
    };
  }

  const tierOrder: Record<CustomerTier, number> = {
    'Tier 1': 4,
    'Tier 2': 3,
    'Tier 3': 2,
    'Tier 4': 1
  };

  if (tierOrder[current.tier] > tierOrder[previous.tier]) {
    return { movement: 'Promoted', movementReason: `Moved from ${getTierDisplayName(previous.tier)} to ${getTierDisplayName(current.tier)}` };
  }

  if (tierOrder[current.tier] < tierOrder[previous.tier]) {
    return { movement: 'Demoted', movementReason: `Moved from ${getTierDisplayName(previous.tier)} to ${getTierDisplayName(current.tier)}` };
  }

  const scoreChange = current.intelligenceScore - previous.intelligenceScore;

  if (scoreChange >= 8) {
    return { movement: 'Promoted', movementReason: `Score improved by ${scoreChange} points` };
  }

  if (scoreChange <= -8) {
    return { movement: 'Demoted', movementReason: `Score dropped by ${Math.abs(scoreChange)} points` };
  }

  return { movement: 'Stable', movementReason: `Score changed by ${scoreChange} points` };
};

const buildScoreBreakdown = (
  profitScore: number,
  paymentDisciplineScore: number,
  frequencyScore: number,
  salesScore: number,
  loyaltyScore: number,
  monthlySalesTarget: number,
  customerMonthlySales: number,
  salesTargetAchievement: number,
  monthlyOrderTarget: number,
  customerMonthlyOrders: number,
  orderTargetAchievement: number,
  settings?: AppSettings,
  breakdownWeights = normalizeScoreWeights(settings)
): ScoreBreakdownItem[] => [
  // Settings store values as human-friendly percentages. The engine normalizes them to 0-1 weights.
  {
    key: 'profit',
    label: 'Profit Contribution',
    score: profitScore,
    weight: breakdownWeights.profit,
    weightedScore: profitScore * breakdownWeights.profit,
    description: 'Weighted contribution from target-based profit performance.'
  },
  {
    key: 'paymentDiscipline',
    label: 'Payment Discipline',
    score: paymentDisciplineScore,
    weight: breakdownWeights.paymentDiscipline,
    weightedScore: paymentDisciplineScore * breakdownWeights.paymentDiscipline,
    description: 'Weighted contribution from on-time collection behavior.'
  },
  {
    key: 'frequency',
    label: 'Order Frequency',
    score: frequencyScore,
    weight: breakdownWeights.frequency,
    weightedScore: frequencyScore * breakdownWeights.frequency,
    description: 'Weighted contribution against the target-based monthly order count.',
    targetValue: monthlyOrderTarget,
    actualValue: customerMonthlyOrders,
    achievementPercent: orderTargetAchievement
  },
  {
    key: 'sales',
    label: 'Sales Performance',
    score: salesScore,
    weight: breakdownWeights.sales,
    weightedScore: salesScore * breakdownWeights.sales,
    description: 'Weighted contribution against the suggested monthly sales target.',
    targetValue: monthlySalesTarget,
    actualValue: customerMonthlySales,
    achievementPercent: salesTargetAchievement
  },
  {
    key: 'loyalty',
    label: 'Loyalty Consistency',
    score: loyaltyScore,
    weight: breakdownWeights.loyalty,
    weightedScore: loyaltyScore * breakdownWeights.loyalty,
    description: '5% weight for active months in the window.'
  }
];

const buildScoresForWindow = (customers: Customer[], invoices: Invoice[], payments: Payment[], window: DateWindow, settings?: AppSettings): CustomerScore[] => {
  const activeInvoices = invoices.filter((invoice) => isDateInsideWindow(invoice.date, window));

  const scoreInputs: ScoreInput[] = customers.map((customer) => {
    const customerInvoices = activeInvoices.filter((invoice) => invoice.customerId === customer.id);
    const allCustomerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
    const invoiceIds = new Set(customerInvoices.map((invoice) => invoice.id));
    const allInvoiceIds = new Set(allCustomerInvoices.map((invoice) => invoice.id));
    const customerPayments = payments.filter((payment) => invoiceIds.has(payment.invoiceId) && parseDate(payment.date) <= endOfDay(window.end));
    const allCustomerPayments = payments.filter((payment) => allInvoiceIds.has(payment.invoiceId) && parseDate(payment.date) <= endOfDay(window.end));

    const totalSales = customerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const totalProfit = customerInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const totalPayments = customerPayments.reduce((sum, payment) => sum + payment.amount + payment.cashDiscount, 0);
    const allInvoicePaymentEffect = allCustomerPayments.reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
    const allSales = allCustomerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    // Opening balances are normal invoices after conversion; the field is only a legacy fallback.
    const previousOutstandingAmount = getPreviousOutstandingFallback(customer, allCustomerInvoices);
    const newOutstanding = getPendingAmount(allSales, allInvoicePaymentEffect);
    const invoiceCount = customerInvoices.length;
    const monthsInScoringWindow = getAverageTargetMonthCount(window);

    return {
      customer,
      customerInvoices,
      totalSales,
      totalProfit,
      totalPayments,
      previousOutstandingAmount,
      newOutstanding,
      outstanding: previousOutstandingAmount + newOutstanding,
      invoiceCount,
      averageOrderValue: invoiceCount > 0 ? roundMoney(totalSales / invoiceCount) : 0,
      customerMonthlySales: roundMoney(totalSales / monthsInScoringWindow),
      customerMonthlyOrders: getWholeOrderCount(invoiceCount / monthsInScoringWindow),
      allCustomerInvoices
    };
  });

  const highestSales = Math.max(...scoreInputs.map((entry) => entry.totalSales), 1);
  const highestProfit = Math.max(...scoreInputs.map((entry) => entry.totalProfit), 1);
  const highestAverageOrderValue = Math.max(...scoreInputs.map((entry) => entry.averageOrderValue), 1);
  const segmentRankByCustomerId = new Map(
    [...scoreInputs]
      .sort((a, b) => b.totalSales - a.totalSales || b.totalProfit - a.totalProfit)
      .map((entry, index) => [entry.customer.id, index + 1])
  );

  const unrankedScores = scoreInputs.map((entry) => {
    const weights = normalizeScoreWeights(settings);
    const targetSettings = getTierTargetSettings(entry.customer.tier, settings);
    const onboardingStage = getOnboardingStage(entry.customer, entry.allCustomerInvoices.length, getActiveMonthCount(entry.allCustomerInvoices), window.end);
    const isOnboarding = onboardingStage !== 'Stage D';
    const activeBreakdownWeights = isOnboarding
      ? { profit: 0, paymentDiscipline: 0.4, frequency: 0.1, sales: 0.2, loyalty: 0.3 }
      : weights;
    const confidenceFactor = getConfidenceFactor(entry.allCustomerInvoices.length, getActiveMonthCount(entry.allCustomerInvoices));
    const monthlySalesTarget = getSuggestedMonthlySalesTarget(
      entry,
      targetSettings.monthlySalesTarget,
      segmentRankByCustomerId.get(entry.customer.id) ?? scoreInputs.length,
      onboardingStage,
      window.end
    );
    const monthlyOrderTarget = getExpectedOrderTarget(monthlySalesTarget);
    const fallbackSalesScore = entry.totalSales > 0 ? clamp(Math.round((entry.totalSales / highestSales) * 100), 10, 100) : 0;
    const fallbackFrequencyScore = rateFrequencyScore(entry.invoiceCount, entry.averageOrderValue, highestAverageOrderValue, window);
    const salesScore = calculateSalesPerformanceScore(entry.customerMonthlySales, monthlySalesTarget, fallbackSalesScore);
    const profitScore = calculateProfitScore(
      entry.totalProfit,
      monthlySalesTarget,
      entry.totalProfit > 0 ? clamp(Math.round((entry.totalProfit / highestProfit) * 100), 10, 100) : 0
    );
    const baseFrequencyScore = calculateOrderPerformanceScore(
      entry.customerMonthlyOrders,
      monthlyOrderTarget,
      entry.averageOrderValue,
      monthlySalesTarget,
      fallbackFrequencyScore
    );
    const paymentDisciplineScore = ratePaymentDiscipline(entry.customerInvoices, payments, window.end, entry.customer.tier, settings);
    const frequencyScore = entry.customerMonthlySales >= monthlySalesTarget * 1.2 && paymentDisciplineScore >= 90 ? Math.max(70, baseFrequencyScore) : baseFrequencyScore;
    const loyaltyScore = rateLoyaltyConsistency(entry.customerInvoices, window);
    const salesTargetAchievement = monthlySalesTarget > 0 ? capScore((entry.customerMonthlySales / monthlySalesTarget) * 100) : 0;
    const orderTargetAchievement = monthlyOrderTarget > 0 ? capScore((entry.customerMonthlyOrders / monthlyOrderTarget) * 100) : 0;
    const outstandingBase = Math.max(entry.totalSales + entry.previousOutstandingAmount, entry.outstanding, 1);
    const outstandingPenalty = entry.outstanding > 0 ? Math.min(15, (entry.outstanding / outstandingBase) * 15) : 0;
    const outstandingRatio = outstandingBase > 0 ? entry.outstanding / outstandingBase : 0;

    const normalScore = capScore(
      profitScore * weights.profit +
        paymentDisciplineScore * weights.paymentDiscipline +
        frequencyScore * weights.frequency +
        salesScore * weights.sales +
        loyaltyScore * weights.loyalty -
        outstandingPenalty
    );
    const onboardingScore = capScore(
      (paymentDisciplineScore * 0.4 + loyaltyScore * 0.3 + salesScore * 0.2 + frequencyScore * 0.1 - outstandingPenalty) * confidenceFactor
    );
    const intelligenceScore = isOnboarding ? onboardingScore : normalScore;
    const scoreTier = assignTier(intelligenceScore);
    const hasOverdue = hasOverdueBeyondAllowed(entry.customerInvoices, payments, window.end, entry.customer.tier, settings);
    const gatedTier = applyTierGates(
      scoreTier,
      entry.customerMonthlySales,
      paymentDisciplineScore,
      hasOverdue,
      outstandingRatio,
      onboardingStage,
      isOnboarding
    );

    const tier = entry.customer.tierOverride ? entry.customer.tier : gatedTier.tier;
    const tierCapReason = entry.customer.tierOverride && (hasOverdue || paymentDisciplineScore < 55 || outstandingRatio > 0.5)
      ? 'Admin override preserved, but payment risk should be reviewed.'
      : gatedTier.tierCapReason;
    const creditPolicy = {
      creditDays: getCreditDaysForTierFromSettings(tier, settings),
      bufferDays: getPaymentBufferForTier(tier, settings),
      label: getPaymentTermsLabel(tier, settings)
    };
    const riskLevel = getRiskLevel(tier, paymentDisciplineScore, entry.outstanding, outstandingBase);

    return {
      customerId: entry.customer.id,
      customerName: entry.customer.name,
      customerArea: entry.customer.area,
      customerMobile: entry.customer.mobile,
      tier,
      storedTier: entry.customer.tier,
      creditDays: creditPolicy.creditDays,
      creditBufferDays: creditPolicy.bufferDays,
      creditPolicyLabel: creditPolicy.label,
      totalSales: entry.totalSales,
      totalProfit: entry.totalProfit,
      totalPayments: entry.totalPayments,
      outstanding: entry.outstanding,
      invoiceCount: entry.invoiceCount,
      averageOrderValue: entry.averageOrderValue,
      monthlySalesTarget,
      customerMonthlySales: entry.customerMonthlySales,
      salesTargetAchievement,
      monthlyOrderTarget,
      customerMonthlyOrders: entry.customerMonthlyOrders,
      orderTargetAchievement,
      insights: [
        isOnboarding ? 'New customer uses onboarding mode' : '',
        salesTargetAchievement >= 100 ? 'Sales target achieved' : 'Below monthly sales target',
        orderTargetAchievement >= 100 ? 'Order frequency target achieved' : 'Order frequency below target',
        entry.customerMonthlyOrders < monthlyOrderTarget && entry.averageOrderValue >= monthlySalesTarget * 0.5
          ? 'Strong large-value buyer despite low frequency'
          : '',
        tierCapReason || '',
        paymentDisciplineScore < 65 ? 'Payment discipline affecting score' : '',
        outstandingPenalty > 0 ? 'High outstanding reducing score' : '',
        profitScore === 0 && entry.totalProfit < 0 ? 'Negative profit reducing score heavily' : ''
      ].filter(Boolean),
      frequencyScore,
      paymentDisciplineScore,
      salesScore,
      profitScore,
      loyaltyScore,
      intelligenceScore,
      giftBudget: roundMoney(Math.max(0, entry.totalProfit) * (getGiftPercentageForTier(tier, settings) / 100)),
      rank: 0,
      movement: 'Stable' as CustomerMovement,
      movementReason: '',
      riskLevel,
      recommendedAction: getRecommendedAction(riskLevel, tier, entry.outstanding),
      overdueStatus: getOverdueStatus(entry.customerInvoices, payments, window.end, entry.customer.tier, settings),
      tierCapReason,
      isOnboarding,
      onboardingStage,
      confidenceFactor,
      scoreBreakdown: buildScoreBreakdown(
        profitScore,
        paymentDisciplineScore,
        frequencyScore,
        salesScore,
        loyaltyScore,
        monthlySalesTarget,
        entry.customerMonthlySales,
        salesTargetAchievement,
        monthlyOrderTarget,
        entry.customerMonthlyOrders,
        orderTargetAchievement,
        settings,
        activeBreakdownWeights
      )
    };
  });

  return [...unrankedScores]
    .sort((a, b) => b.intelligenceScore - a.intelligenceScore || b.totalProfit - a.totalProfit || b.totalSales - a.totalSales)
    .map((score, index) => ({
      ...score,
      rank: index + 1
    }));
};

export const buildCustomerScores = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  referenceDate = new Date(),
  settings?: AppSettings
): CustomerScore[] => {
  const businessInvoices = getBusinessInvoices(invoices);
  const currentScores = buildScoresForWindow(customers, businessInvoices, payments, getCurrentRollingWindow(referenceDate), settings);
  const previousScores = buildScoresForWindow(customers, businessInvoices, payments, getPreviousRollingWindow(referenceDate), settings);
  const previousScoreByCustomer = new Map(previousScores.map((score) => [score.customerId, score]));

  return currentScores.map((currentScore) => {
    const previousScore = previousScoreByCustomer.get(currentScore.customerId);
    const movementDetails = getMovementDetails(currentScore, previousScore);

    return {
      ...currentScore,
      previousRank: previousScore?.rank,
      previousScore: previousScore?.intelligenceScore,
      previousTier: previousScore?.tier,
      ...movementDetails
    };
  });
};

export const buildCustomerScoresForDateRange = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  fromDate: string,
  toDate: string,
  settings?: AppSettings
): CustomerScore[] => {
  return buildScoresForWindow(customers, getBusinessInvoices(invoices), payments, {
    start: parseDate(fromDate),
    end: parseDate(toDate)
  }, settings);
};

export const buildMonthlyRankings = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  referenceDate = new Date(),
  settings?: AppSettings
): MonthlyRankingGroup[] => {
  const targetMonths = [
    new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1),
    new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1)
  ];

  return targetMonths.map((monthStart) => {
    const monthEnd =
      monthStart.getMonth() === referenceDate.getMonth() && monthStart.getFullYear() === referenceDate.getFullYear()
        ? endOfDay(referenceDate)
        : endOfMonth(monthStart);
    const rankingWindow = {
      start: new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1),
      end: monthEnd
    };
    const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = monthStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const scores = buildScoresForWindow(customers, invoices, payments, rankingWindow, settings);

    return {
      monthKey,
      monthLabel,
      periodLabel: getWindowLabel(rankingWindow),
      rankings: scores
        .filter((score) => score.totalSales > 0)
        .slice(0, 10)
        .map((score) => ({
          customerId: score.customerId,
          customerName: score.customerName,
          rank: score.rank,
          tier: score.tier,
          intelligenceScore: score.intelligenceScore,
          totalSales: score.totalSales,
          totalProfit: score.totalProfit,
          giftBudget: score.giftBudget
        }))
    };
  });
};

export const buildIntelligenceSummary = (customerScores: CustomerScore[]): IntelligenceSummary => {
  const emptySummary = {
    totalSales: 0,
    totalProfit: 0,
    totalPayments: 0,
    outstanding: 0,
    customerCount: 0,
    averageScore: 0,
    giftBudget: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
    tier4Count: 0,
    riskCustomerCount: 0
  };

  if (customerScores.length === 0) {
    return emptySummary;
  }

  const summary = customerScores.reduce((runningSummary, customer) => {
    runningSummary.totalSales += customer.totalSales;
    runningSummary.totalProfit += customer.totalProfit;
    runningSummary.totalPayments += customer.totalPayments;
    runningSummary.outstanding += customer.outstanding;
    runningSummary.customerCount += 1;
    runningSummary.giftBudget += customer.giftBudget;
    runningSummary.averageScore += customer.intelligenceScore;

    if (customer.tier === 'Tier 1') runningSummary.tier1Count += 1;
    if (customer.tier === 'Tier 2') runningSummary.tier2Count += 1;
    if (customer.tier === 'Tier 3') runningSummary.tier3Count += 1;
    if (customer.tier === 'Tier 4') runningSummary.tier4Count += 1;
    if (customer.riskLevel === 'High') runningSummary.riskCustomerCount += 1;

    return runningSummary;
  }, emptySummary);

  return {
    ...summary,
    averageScore: Math.round(summary.averageScore / summary.customerCount)
  };
};

export const getCustomerScoreById = (
  customerId: string,
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[]
): CustomerScore | undefined => {
  return buildCustomerScores(customers, invoices, payments).find((entry) => entry.customerId === customerId);
};
