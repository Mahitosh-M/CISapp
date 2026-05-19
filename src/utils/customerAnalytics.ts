import type {
  AppSettings,
  Customer,
  CustomerMovement,
  CustomerScore,
  CustomerTier,
  IntelligenceSummary,
  Invoice,
  MonthlyRankingGroup,
  Payment,
  RiskLevel,
  ScoreBreakdownItem,
  TierCreditPolicy
} from '../types';
import {
  calculateDynamicDueDate,
  getCreditDaysForTierFromSettings,
  getGiftPercentageForTier,
  getPaymentBufferForTier,
  getPaymentTermsLabel,
  normalizeScoreWeights
} from './settings';

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
  outstanding: number;
  invoiceCount: number;
  averageOrderValue: number;
}

// Phase 1 scoring weights. Keep these as constants so later reports use the same rules.
export const SCORE_WEIGHTS = {
  profit: 0.35,
  paymentDiscipline: 0.25,
  frequency: 0.2,
  sales: 0.15,
  loyalty: 0.05
};

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
    description: 'Same day payment preferred until score improves.'
  }
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseDate = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

const daysBetween = (start: Date, end: Date) => Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / MS_PER_DAY);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundMoney = (value: number) => Math.round(value);

const isDateInsideWindow = (dateString: string, window: DateWindow) => {
  const date = parseDate(dateString);
  return date >= startOfDay(window.start) && date <= endOfDay(window.end);
};

const formatPeriodDate = (date: Date) => {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

// Current rolling window = current calendar month + previous calendar month.
// This keeps rankings broader than a single month while staying easy to explain.
const getCurrentRollingWindow = (referenceDate: Date): DateWindow => {
  const end = endOfDay(referenceDate);
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  return { start, end };
};

const getPreviousRollingWindow = (referenceDate: Date): DateWindow => {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 3, 1);
  const end = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 0, 23, 59, 59, 999);
  return { start, end };
};

const getWindowLabel = (window: DateWindow) => `${formatPeriodDate(window.start)} to ${formatPeriodDate(window.end)}`;

const getPaymentsForInvoice = (invoiceId: string, payments: Payment[], asOfDate: Date) => {
  return payments
    .filter((payment) => payment.invoiceId === invoiceId && parseDate(payment.date) <= endOfDay(asOfDate))
    .sort((a, b) => parseDate(a.date).getTime() - parseDate(b.date).getTime());
};

const getPaidAmountForInvoice = (invoiceId: string, payments: Payment[], asOfDate: Date) => {
  return getPaymentsForInvoice(invoiceId, payments, asOfDate).reduce((sum, payment) => sum + payment.amount, 0);
};

const getInvoicePaidDate = (invoice: Invoice, payments: Payment[], asOfDate: Date) => {
  const invoicePayments = getPaymentsForInvoice(invoice.id, payments, asOfDate);
  let paidTotal = 0;

  for (const payment of invoicePayments) {
    paidTotal += payment.amount;

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

const getMonthsInWindow = (window: DateWindow) => {
  const start = new Date(window.start.getFullYear(), window.start.getMonth(), 1);
  const end = new Date(window.end.getFullYear(), window.end.getMonth(), 1);
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
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
    const dueDate = parseDate(calculateDynamicDueDate(invoice.date, tier, settings));
    const paidDate = getInvoicePaidDate(invoice, payments, asOfDate);

    if (paidDate) {
      return Math.max(0, daysBetween(dueDate, paidDate));
    }

    const paidAmount = getPaidAmountForInvoice(invoice.id, payments, asOfDate);
    const outstanding = invoice.totalSales - paidAmount;

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

  const monthsInWindow = Math.max(1, getMonthsInWindow(window));
  return clamp(Math.round((getActiveMonthCount(customerInvoices) / monthsInWindow) * 100), 30, 100);
};

const assignTier = (intelligenceScore: number, paymentDisciplineScore: number): CustomerTier => {
  if (intelligenceScore >= 80 && paymentDisciplineScore >= 70) {
    return 'Tier 1';
  }

  if (intelligenceScore >= 60 && paymentDisciplineScore >= 50) {
    return 'Tier 2';
  }

  return 'Tier 3';
};

const getRiskLevel = (tier: CustomerTier, paymentDisciplineScore: number, outstanding: number, totalSales: number): RiskLevel => {
  const outstandingRatio = totalSales > 0 ? outstanding / totalSales : 0;

  if (tier === 'Tier 3' || paymentDisciplineScore < 55 || outstandingRatio > 0.5) {
    return 'High';
  }

  if (tier === 'Tier 2' || paymentDisciplineScore < 75 || outstanding > 0) {
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

  return 'Monitor before increasing credit';
};

const getOverdueStatus = (customerInvoices: Invoice[], payments: Payment[], asOfDate: Date, tier: CustomerTier, settings?: AppSettings) => {
  const hasOverdueInvoice = customerInvoices.some((invoice) => {
    const paidAmount = getPaidAmountForInvoice(invoice.id, payments, asOfDate);
    return invoice.totalSales - paidAmount > 0 && parseDate(calculateDynamicDueDate(invoice.date, tier, settings)) < startOfDay(asOfDate);
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
    'Tier 1': 3,
    'Tier 2': 2,
    'Tier 3': 1
  };

  if (tierOrder[current.tier] > tierOrder[previous.tier]) {
    return { movement: 'Promoted', movementReason: `Moved from ${previous.tier} to ${current.tier}` };
  }

  if (tierOrder[current.tier] < tierOrder[previous.tier]) {
    return { movement: 'Demoted', movementReason: `Moved from ${previous.tier} to ${current.tier}` };
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
  settings?: AppSettings
): ScoreBreakdownItem[] => [
  // Settings store values as human-friendly percentages. The engine normalizes them to 0-1 weights.
  {
    key: 'profit',
    label: 'Profit Contribution',
    score: profitScore,
    weight: normalizeScoreWeights(settings).profit,
    weightedScore: profitScore * normalizeScoreWeights(settings).profit,
    description: '35% weight for real business contribution.'
  },
  {
    key: 'paymentDiscipline',
    label: 'Payment Discipline',
    score: paymentDisciplineScore,
    weight: normalizeScoreWeights(settings).paymentDiscipline,
    weightedScore: paymentDisciplineScore * normalizeScoreWeights(settings).paymentDiscipline,
    description: '25% weight for on-time collection behavior.'
  },
  {
    key: 'frequency',
    label: 'Order Frequency',
    score: frequencyScore,
    weight: normalizeScoreWeights(settings).frequency,
    weightedScore: frequencyScore * normalizeScoreWeights(settings).frequency,
    description: '20% weight against the weekly order target.'
  },
  {
    key: 'sales',
    label: 'Sales Volume',
    score: salesScore,
    weight: normalizeScoreWeights(settings).sales,
    weightedScore: salesScore * normalizeScoreWeights(settings).sales,
    description: '15% weight for rolling sales value.'
  },
  {
    key: 'loyalty',
    label: 'Loyalty Consistency',
    score: loyaltyScore,
    weight: normalizeScoreWeights(settings).loyalty,
    weightedScore: loyaltyScore * normalizeScoreWeights(settings).loyalty,
    description: '5% weight for active months in the window.'
  }
];

const buildScoresForWindow = (customers: Customer[], invoices: Invoice[], payments: Payment[], window: DateWindow, settings?: AppSettings): CustomerScore[] => {
  const activeInvoices = invoices.filter((invoice) => isDateInsideWindow(invoice.date, window));

  const scoreInputs: ScoreInput[] = customers.map((customer) => {
    const customerInvoices = activeInvoices.filter((invoice) => invoice.customerId === customer.id);
    const invoiceIds = new Set(customerInvoices.map((invoice) => invoice.id));
    const customerPayments = payments.filter((payment) => invoiceIds.has(payment.invoiceId) && parseDate(payment.date) <= endOfDay(window.end));

    const totalSales = customerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const totalProfit = customerInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const totalPayments = customerPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const invoiceCount = customerInvoices.length;

    return {
      customer,
      customerInvoices,
      totalSales,
      totalProfit,
      totalPayments,
      outstanding: totalSales - totalPayments,
      invoiceCount,
      averageOrderValue: invoiceCount > 0 ? roundMoney(totalSales / invoiceCount) : 0
    };
  });

  const highestSales = Math.max(...scoreInputs.map((entry) => entry.totalSales), 1);
  const highestProfit = Math.max(...scoreInputs.map((entry) => entry.totalProfit), 1);
  const highestAverageOrderValue = Math.max(...scoreInputs.map((entry) => entry.averageOrderValue), 1);

  const unrankedScores = scoreInputs.map((entry) => {
    const weights = normalizeScoreWeights(settings);
    const salesScore = entry.totalSales > 0 ? clamp(Math.round((entry.totalSales / highestSales) * 100), 10, 100) : 0;
    const profitScore = entry.totalProfit > 0 ? clamp(Math.round((entry.totalProfit / highestProfit) * 100), 10, 100) : 0;
    const frequencyScore = rateFrequencyScore(entry.invoiceCount, entry.averageOrderValue, highestAverageOrderValue, window);
    const paymentDisciplineScore = ratePaymentDiscipline(entry.customerInvoices, payments, window.end, entry.customer.tier, settings);
    const loyaltyScore = rateLoyaltyConsistency(entry.customerInvoices, window);

    const intelligenceScore = Math.round(
      profitScore * weights.profit +
        paymentDisciplineScore * weights.paymentDiscipline +
        frequencyScore * weights.frequency +
        salesScore * weights.sales +
        loyaltyScore * weights.loyalty
    );

    const tier = assignTier(intelligenceScore, paymentDisciplineScore);
    const creditPolicy = {
      creditDays: getCreditDaysForTierFromSettings(tier, settings),
      bufferDays: getPaymentBufferForTier(tier, settings),
      label: getPaymentTermsLabel(tier, settings)
    };
    const riskLevel = getRiskLevel(tier, paymentDisciplineScore, entry.outstanding, entry.totalSales);

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
      frequencyScore,
      paymentDisciplineScore,
      salesScore,
      profitScore,
      loyaltyScore,
      intelligenceScore,
      giftBudget: roundMoney(entry.totalSales * (getGiftPercentageForTier(tier, settings) / 100)),
      rank: 0,
      movement: 'Stable' as CustomerMovement,
      movementReason: '',
      riskLevel,
      recommendedAction: getRecommendedAction(riskLevel, tier, entry.outstanding),
      overdueStatus: getOverdueStatus(entry.customerInvoices, payments, window.end, entry.customer.tier, settings),
      scoreBreakdown: buildScoreBreakdown(profitScore, paymentDisciplineScore, frequencyScore, salesScore, loyaltyScore, settings)
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
  const currentScores = buildScoresForWindow(customers, invoices, payments, getCurrentRollingWindow(referenceDate), settings);
  const previousScores = buildScoresForWindow(customers, invoices, payments, getPreviousRollingWindow(referenceDate), settings);
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
  return buildScoresForWindow(customers, invoices, payments, {
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
