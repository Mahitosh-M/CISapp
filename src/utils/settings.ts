import type { AppSettings, CustomerTier } from '../types';
import { addDaysToDateString } from './dateUtils';

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
  }
};

export const mergeWithDefaultSettings = (settings?: Partial<AppSettings>): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...settings,
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
  }
});

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

  return {
    profit: activeSettings.scoringWeights.profit / 100,
    paymentDiscipline: activeSettings.scoringWeights.paymentDiscipline / 100,
    frequency: activeSettings.scoringWeights.frequency / 100,
    sales: activeSettings.scoringWeights.sales / 100,
    loyalty: activeSettings.scoringWeights.loyalty / 100
  };
};
