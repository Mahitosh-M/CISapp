import type { AppSettings, CustomerTier, TargetTierKey, TierTargetSetting } from '../types';
import { addDaysToDateString } from './dateUtils';

export type ScoringWeightKey = keyof AppSettings['scoringWeights'];

export const SCORING_WEIGHT_KEYS: ScoringWeightKey[] = ['profit', 'paymentDiscipline', 'frequency', 'sales', 'loyalty'];

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'erpSettings',
  giftPercentages: {
    'Tier 1': 3,
    'Tier 2': 2,
    'Tier 3': 1
  },
  creditDays: {
    'Tier 1': 15,
    'Tier 2': 10,
    'Tier 3': 0
  },
  paymentBuffers: {
    'Tier 1': 3,
    'Tier 2': 0,
    'Tier 3': 0
  },
  scoringWeights: {
    profit: 35,
    paymentDiscipline: 25,
    frequency: 20,
    sales: 15,
    loyalty: 5
  },
  highOutstandingThreshold: 100000,
  invoicePrefix: 'INV',
  financialYearReset: true,
  defaultReportPeriod: 'current_month',
  giftPeriodOptions: ['1_month', '3_months', '6_months', '1_year', 'custom'],
  staffPermissions: {
    canViewReports: false,
    canViewDashboard: true
  },
  targetSettings: {
    tier1: {
      monthlySalesTarget: 50000,
      monthlyOrderTarget: 4
    },
    tier2: {
      monthlySalesTarget: 40000,
      monthlyOrderTarget: 3
    },
    tier3: {
      monthlySalesTarget: 20000,
      monthlyOrderTarget: 2
    }
  },
  // Customer portal privacy flag. Default false hides tier/category until Admin explicitly allows it.
  showCustomerTierToCustomer: false
};

const roundToTwoDecimals = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const wholeNumberOrNaN = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : Number.NaN;
};

const mergeTierTargetSettings = (targetSettings: Partial<TierTargetSetting> | undefined, fallback: TierTargetSetting): TierTargetSetting => ({
  ...fallback,
  ...targetSettings,
  monthlyOrderTarget: wholeNumberOrNaN(targetSettings?.monthlyOrderTarget ?? fallback.monthlyOrderTarget)
});

export const mergeWithDefaultSettings = (settings?: Partial<AppSettings>): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  highOutstandingThreshold: settings?.highOutstandingThreshold ?? DEFAULT_SETTINGS.highOutstandingThreshold,
  invoicePrefix: settings?.invoicePrefix || DEFAULT_SETTINGS.invoicePrefix,
  financialYearReset: settings?.financialYearReset ?? DEFAULT_SETTINGS.financialYearReset,
  defaultReportPeriod: settings?.defaultReportPeriod ?? DEFAULT_SETTINGS.defaultReportPeriod,
  giftPercentages: {
    ...DEFAULT_SETTINGS.giftPercentages,
    ...settings?.giftPercentages
  },
  creditDays: {
    ...DEFAULT_SETTINGS.creditDays,
    ...settings?.creditDays
  },
  paymentBuffers: {
    ...DEFAULT_SETTINGS.paymentBuffers,
    ...settings?.paymentBuffers
  },
  scoringWeights: {
    ...DEFAULT_SETTINGS.scoringWeights,
    ...settings?.scoringWeights
  },
  giftPeriodOptions: settings?.giftPeriodOptions ?? DEFAULT_SETTINGS.giftPeriodOptions,
  staffPermissions: {
    ...DEFAULT_SETTINGS.staffPermissions,
    ...settings?.staffPermissions
  },
  showCustomerTierToCustomer: settings?.showCustomerTierToCustomer ?? DEFAULT_SETTINGS.showCustomerTierToCustomer,
  targetSettings: {
    tier1: mergeTierTargetSettings(settings?.targetSettings?.tier1, DEFAULT_SETTINGS.targetSettings.tier1),
    tier2: mergeTierTargetSettings(settings?.targetSettings?.tier2, DEFAULT_SETTINGS.targetSettings.tier2),
    tier3: mergeTierTargetSettings(settings?.targetSettings?.tier3, DEFAULT_SETTINGS.targetSettings.tier3)
  }
});

export const getTargetTierKey = (tier?: CustomerTier): TargetTierKey => {
  if (tier === 'Tier 1') return 'tier1';
  if (tier === 'Tier 2') return 'tier2';
  return 'tier3';
};

export const getTierTargetSettings = (tier: CustomerTier | undefined, settings?: AppSettings): TierTargetSetting => {
  const activeSettings = mergeWithDefaultSettings(settings);

  // Future target rules should be edited in Settings and kept under targetSettings.
  return activeSettings.targetSettings[getTargetTierKey(tier)];
};

export const getScoringWeightTotal = (settings?: Partial<AppSettings>) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  const total = SCORING_WEIGHT_KEYS.reduce((sum, key) => sum + numberOrZero(activeSettings.scoringWeights[key]), 0);

  return roundToTwoDecimals(total);
};

export const isScoringWeightTotalValid = (total: number) => Math.abs(total - 100) < 0.001;

export const validateScoringWeights = (settings?: Partial<AppSettings>) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  const errors: string[] = [];
  const scoringWeightTotal = getScoringWeightTotal(activeSettings);

  SCORING_WEIGHT_KEYS.forEach((key) => {
    const weight = Number(activeSettings.scoringWeights[key]);

    if (!Number.isFinite(weight)) {
      errors.push('Every scoring weight must be a valid number.');
    } else if (weight < 0) {
      errors.push('Scoring weights cannot be negative.');
    }
  });

  if (!isScoringWeightTotalValid(scoringWeightTotal)) {
    errors.push(`Scoring weights must total exactly 100%. Current total is ${scoringWeightTotal}%.`);
  }

  return {
    isValid: errors.length === 0,
    errors: [...new Set(errors)],
    scoringWeightTotal
  };
};

export const validateAppSettings = (settings?: Partial<AppSettings>) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  const scoringValidation = validateScoringWeights(activeSettings);
  const errors = [...scoringValidation.errors];

  (Object.entries(activeSettings.giftPercentages) as [CustomerTier, number][]).forEach(([tier, percentage]) => {
    if (!Number.isFinite(Number(percentage))) {
      errors.push(`${tier} gift percentage must be a valid number.`);
    } else if (Number(percentage) < 0) {
      errors.push(`${tier} gift percentage cannot be negative.`);
    }
  });

  (Object.entries(activeSettings.creditDays) as [CustomerTier, number][]).forEach(([tier, days]) => {
    if (!Number.isFinite(Number(days))) {
      errors.push(`${tier} credit days must be a valid number.`);
    } else if (Number(days) < 0) {
      errors.push(`${tier} credit days cannot be negative.`);
    }
  });

  (Object.entries(activeSettings.paymentBuffers) as [CustomerTier, number][]).forEach(([tier, days]) => {
    if (!Number.isFinite(Number(days))) {
      errors.push(`${tier} buffer days must be a valid number.`);
    } else if (Number(days) < 0) {
      errors.push(`${tier} buffer days cannot be negative.`);
    }
  });

  if (!Number.isFinite(Number(activeSettings.highOutstandingThreshold)) || Number(activeSettings.highOutstandingThreshold) < 0) {
    errors.push('High outstanding threshold cannot be negative.');
  }

  if (!activeSettings.invoicePrefix.trim()) {
    errors.push('Invoice prefix is required.');
  }

  (Object.entries(activeSettings.targetSettings) as [TargetTierKey, TierTargetSetting][]).forEach(([tierKey, target]) => {
    const readableTier = tierKey === 'tier1' ? 'Tier 1' : tierKey === 'tier2' ? 'Tier 2' : 'Tier 3';

    if (!Number.isFinite(Number(target.monthlySalesTarget))) {
      errors.push(`${readableTier} monthly sales target must be a valid number.`);
    } else if (Number(target.monthlySalesTarget) < 0) {
      errors.push(`${readableTier} monthly sales target cannot be negative.`);
    }

    if (!Number.isFinite(Number(target.monthlyOrderTarget))) {
      errors.push(`${readableTier} monthly order target must be a valid number.`);
    } else if (Number(target.monthlyOrderTarget) < 0) {
      errors.push(`${readableTier} monthly order target cannot be negative.`);
    } else if (!Number.isInteger(Number(target.monthlyOrderTarget))) {
      errors.push(`${readableTier} monthly order target must be a whole number.`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors: [...new Set(errors)],
    scoringWeightTotal: scoringValidation.scoringWeightTotal
  };
};

export const getGiftPercentageForTier = (tier: CustomerTier, settings?: AppSettings) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  return activeSettings.giftPercentages[tier] ?? DEFAULT_SETTINGS.giftPercentages[tier];
};

export const getCreditDaysForTierFromSettings = (tier: CustomerTier, settings?: AppSettings) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  return activeSettings.creditDays[tier] ?? DEFAULT_SETTINGS.creditDays[tier];
};

export const getPaymentBufferForTier = (tier: CustomerTier, settings?: AppSettings) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  return activeSettings.paymentBuffers[tier] ?? DEFAULT_SETTINGS.paymentBuffers[tier];
};

export const getTotalCreditDaysForTier = (tier: CustomerTier, settings?: AppSettings) => {
  return getCreditDaysForTierFromSettings(tier, settings) + getPaymentBufferForTier(tier, settings);
};

export const calculateDynamicDueDate = (invoiceDate: string, tier: CustomerTier, settings?: AppSettings) => {
  return addDaysToDateString(invoiceDate, getTotalCreditDaysForTier(tier, settings));
};

export const getEffectiveInvoiceDueDate = (
  invoiceDate: string,
  storedDueDate: string | undefined,
  tier: CustomerTier,
  settings?: AppSettings
) => {
  const normalizedStoredDueDate = storedDueDate?.trim();
  return normalizedStoredDueDate || calculateDynamicDueDate(invoiceDate, tier, settings);
};

export const getPaymentTermsLabel = (tier: CustomerTier, settings?: AppSettings) => {
  const creditDays = getCreditDaysForTierFromSettings(tier, settings);
  const bufferDays = getPaymentBufferForTier(tier, settings);

  if (creditDays <= 0) {
    return 'No credit - same day payment preferred';
  }

  return bufferDays > 0 ? `${creditDays} day credit + ${bufferDays} day buffer` : `${creditDays} day credit`;
};

export const normalizeScoreWeights = (settings?: AppSettings) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  const scoringValidation = validateScoringWeights(activeSettings);
  const scoringWeights = scoringValidation.isValid ? activeSettings.scoringWeights : DEFAULT_SETTINGS.scoringWeights;

  // Existing Firestore settings may already contain a bad total. Falling back here keeps customer scores capped.
  return {
    profit: scoringWeights.profit / 100,
    paymentDiscipline: scoringWeights.paymentDiscipline / 100,
    frequency: scoringWeights.frequency / 100,
    sales: scoringWeights.sales / 100,
    loyalty: scoringWeights.loyalty / 100
  };
};
