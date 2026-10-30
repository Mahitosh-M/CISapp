import type { AppSettings, CustomerTier, MedicalSettings, Invoice, TargetTierKey, TierTargetSetting } from '../types';
import { addDaysToDateString } from './dateUtils';
import { getTierDisplayName } from './tiers';

export type ScoringWeightKey = keyof AppSettings['scoringWeights'];

export const SCORING_WEIGHT_KEYS: ScoringWeightKey[] = ['profit', 'paymentDiscipline', 'frequency', 'sales', 'loyalty'];

export const DEFAULT_SETTINGS: AppSettings = {
  key: 'erpSettings',
  giftPercentages: {
    'Tier 1': 4,
    'Tier 2': 3,
    'Tier 3': 2,
    'Tier 4': 1
  },
  creditDays: {
    'Tier 1': 15,
    'Tier 2': 10,
    'Tier 3': 0,
    'Tier 4': 0
  },
  paymentBuffers: {
    'Tier 1': 3,
    'Tier 2': 0,
    'Tier 3': 0,
    'Tier 4': 0
  },
  scoringWeights: {
    profit: 30,
    paymentDiscipline: 30,
    frequency: 15,
    sales: 20,
    loyalty: 5
  },
  highOutstandingThreshold: 100000,
  fixedMonthlyCosts: 0,
  invoicePrefix: 'INV',
  financialYearReset: true,
  defaultReportPeriod: 'current_month',
  giftPeriodOptions: ['1_month', '3_months', '6_months', '1_year', 'custom'],
  staffPermissions: {
    canViewDashboard: true
  },
  creditPolicy: {
    starterLimitCap: 10000,
    overdueGraceDays: 0,
    lookbackDays: 90
  },
  overduePolicy: {
    minorSalesRatioPercent: 5,
    seriousSalesRatioPercent: 15,
    materialDays: 7,
    seriousDays: 30,
    seriousInvoiceCount: 2,
    repeatedEventCount: 3
  },
  loyaltySettings: {
    pointsPerThousand: 0,
    onTimePaymentBonus: 0,
    monthlyTargetBonus: 5,
    orderFrequencyBonus: 0,
    cleanPaymentMonthBonus: 5,
    newCustomerBonus: 20,
    paymentBonus: 0,
    purchaseTargetBonus: 0,
    referralBonus: 50,
    partnerLevelThresholds: {
      'Active Partner': 0,
      'Silver Partner': 0,
      'Gold Partner': 0,
      'Platinum Partner': 0
    },
    rewardBudgetCap: 0
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
    },
    tier4: {
      monthlySalesTarget: 10000,
      monthlyOrderTarget: 1
    }
  },
  // Customer portal privacy flag. Default false hides tier/category until Admin explicitly allows it.
  showCustomerTierToCustomer: false,
  turnOnOrder: false,
  medicalOrder: false,
  headerOrder: true,
  down: false,
  customerDown: false
};

export const DEFAULT_MEDICAL_SETTINGS: MedicalSettings = {
 giftPercentages: {...DEFAULT_SETTINGS.giftPercentages},
 creditDays: {'Tier 1':15,'Tier 2':15,'Tier 3':15,'Tier 4':15},
 paymentBuffers: {...DEFAULT_SETTINGS.paymentBuffers},
 creditPolicy: {...DEFAULT_SETTINGS.creditPolicy},overduePolicy:{...DEFAULT_SETTINGS.overduePolicy},
 targetSettings: structuredClone(DEFAULT_SETTINGS.targetSettings),loyaltySettings:structuredClone(DEFAULT_SETTINGS.loyaltySettings)
};
export const getMedicalSettings = (settings?: Partial<AppSettings>):MedicalSettings => {
 const value=settings?.medicalSettings;
 return {giftPercentages:{...DEFAULT_MEDICAL_SETTINGS.giftPercentages,...value?.giftPercentages},creditDays:{...DEFAULT_MEDICAL_SETTINGS.creditDays,...value?.creditDays},paymentBuffers:{...DEFAULT_MEDICAL_SETTINGS.paymentBuffers,...value?.paymentBuffers},creditPolicy:{...DEFAULT_MEDICAL_SETTINGS.creditPolicy,...value?.creditPolicy},overduePolicy:{...DEFAULT_MEDICAL_SETTINGS.overduePolicy,...value?.overduePolicy},targetSettings:Object.fromEntries(Object.entries(DEFAULT_MEDICAL_SETTINGS.targetSettings).map(([key,defaults])=>[key,{...defaults,...value?.targetSettings?.[key as TargetTierKey]}])) as MedicalSettings['targetSettings'],loyaltySettings:{...DEFAULT_MEDICAL_SETTINGS.loyaltySettings,...value?.loyaltySettings}};
};
export const getCustomerPolicy = (settings:AppSettings|undefined,customerType?:string):MedicalSettings => customerType==='medical'?getMedicalSettings(settings):mergeWithDefaultSettings(settings);

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
  medicalSettings:getMedicalSettings(settings),
  highOutstandingThreshold: settings?.highOutstandingThreshold ?? DEFAULT_SETTINGS.highOutstandingThreshold,
  fixedMonthlyCosts: settings?.fixedMonthlyCosts ?? DEFAULT_SETTINGS.fixedMonthlyCosts,
  invoicePrefix: settings?.invoicePrefix || DEFAULT_SETTINGS.invoicePrefix,
  financialYearReset: settings?.financialYearReset ?? DEFAULT_SETTINGS.financialYearReset,
  defaultReportPeriod: settings?.defaultReportPeriod ?? DEFAULT_SETTINGS.defaultReportPeriod,
  giftPercentages: {
    ...DEFAULT_SETTINGS.giftPercentages
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
    ...DEFAULT_SETTINGS.scoringWeights
  },
  giftPeriodOptions: settings?.giftPeriodOptions ?? DEFAULT_SETTINGS.giftPeriodOptions,
  staffPermissions: {
    ...DEFAULT_SETTINGS.staffPermissions,
    ...settings?.staffPermissions
  },
  creditPolicy: {
    ...DEFAULT_SETTINGS.creditPolicy,
    ...settings?.creditPolicy,
    starterLimitCap: Math.min(10_000, Math.max(0, numberOrZero(settings?.creditPolicy?.starterLimitCap ?? DEFAULT_SETTINGS.creditPolicy.starterLimitCap))),
    overdueGraceDays: 0,
    lookbackDays: 90
  },
  overduePolicy: {
    ...DEFAULT_SETTINGS.overduePolicy,
    ...settings?.overduePolicy
  },
  loyaltySettings: {
    ...DEFAULT_SETTINGS.loyaltySettings,
    ...settings?.loyaltySettings,
    onTimePaymentBonus: 0,
    monthlyTargetBonus: 5,
    orderFrequencyBonus: 0,
    cleanPaymentMonthBonus: 5,
    newCustomerBonus: 20,
    paymentBonus: 0,
    purchaseTargetBonus: 0,
    referralBonus: 50,
    partnerLevelThresholds: {
      ...DEFAULT_SETTINGS.loyaltySettings.partnerLevelThresholds,
      ...settings?.loyaltySettings?.partnerLevelThresholds
    }
  },
  showCustomerTierToCustomer: settings?.showCustomerTierToCustomer ?? DEFAULT_SETTINGS.showCustomerTierToCustomer,
  turnOnOrder: settings?.turnOnOrder ?? DEFAULT_SETTINGS.turnOnOrder,
  medicalOrder: settings?.medicalOrder ?? DEFAULT_SETTINGS.medicalOrder,
  headerOrder: settings?.headerOrder ?? DEFAULT_SETTINGS.headerOrder,
  down: settings?.down ?? DEFAULT_SETTINGS.down,
  customerDown: settings?.customerDown ?? DEFAULT_SETTINGS.customerDown,
  targetSettings: {
    tier1: mergeTierTargetSettings(settings?.targetSettings?.tier1, DEFAULT_SETTINGS.targetSettings.tier1),
    tier2: mergeTierTargetSettings(settings?.targetSettings?.tier2, DEFAULT_SETTINGS.targetSettings.tier2),
    tier3: mergeTierTargetSettings(settings?.targetSettings?.tier3, DEFAULT_SETTINGS.targetSettings.tier3),
    tier4: mergeTierTargetSettings(settings?.targetSettings?.tier4, DEFAULT_SETTINGS.targetSettings.tier4)
  }
});

export const getTargetTierKey = (tier?: CustomerTier): TargetTierKey => {
  if (tier === 'Tier 1') return 'tier1';
  if (tier === 'Tier 2') return 'tier2';
  if (tier === 'Tier 3') return 'tier3';
  return 'tier4';
};

export const getTierTargetSettings = (tier: CustomerTier | undefined, settings?: AppSettings, customerType?:string): TierTargetSetting => {
  const activeSettings = mergeWithDefaultSettings(settings);

  // Future target rules should be edited in Settings and kept under targetSettings.
  return getCustomerPolicy(activeSettings,customerType).targetSettings[getTargetTierKey(tier)];
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

  if (!Number.isFinite(Number(activeSettings.fixedMonthlyCosts)) || Number(activeSettings.fixedMonthlyCosts) < 0) {
    errors.push('Fixed monthly costs cannot be negative.');
  }

  if (!Number.isFinite(Number(activeSettings.creditPolicy.starterLimitCap)) || Number(activeSettings.creditPolicy.starterLimitCap) < 0) {
    errors.push('Starter credit limit cap cannot be negative.');
  }

  if (Number(activeSettings.creditPolicy.starterLimitCap) > 10_000) {
    errors.push('Starter credit limit cap cannot exceed 10,000.');
  }

  if (!activeSettings.invoicePrefix.trim()) {
    errors.push('Invoice prefix is required.');
  }

  const overduePolicy = activeSettings.overduePolicy;
  if (overduePolicy.minorSalesRatioPercent < 0 || overduePolicy.seriousSalesRatioPercent <= overduePolicy.minorSalesRatioPercent) {
    errors.push('Serious overdue sales ratio must be greater than the minor ratio.');
  }
  if (overduePolicy.materialDays < 0 || overduePolicy.seriousDays <= overduePolicy.materialDays) {
    errors.push('Serious overdue days must be greater than material overdue days.');
  }
  if (!Number.isInteger(overduePolicy.seriousInvoiceCount) || overduePolicy.seriousInvoiceCount < 1) {
    errors.push('Serious overdue invoice count must be a whole number of at least 1.');
  }
  if (!Number.isInteger(overduePolicy.repeatedEventCount) || overduePolicy.repeatedEventCount < 1) {
    errors.push('Repeated overdue event count must be a whole number of at least 1.');
  }

  const loyaltySettings = activeSettings.loyaltySettings;
  [
    ['Monthly target bonus', loyaltySettings.monthlyTargetBonus],
    ['Clean payment month bonus', loyaltySettings.cleanPaymentMonthBonus],
    ['New customer bonus', loyaltySettings.newCustomerBonus],
    ['Referral bonus', loyaltySettings.referralBonus]
  ].forEach(([label, value]) => {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) {
      errors.push(`${label} must be a non-negative number.`);
    }
  });

  (Object.entries(activeSettings.targetSettings) as [TargetTierKey, TierTargetSetting][]).forEach(([tierKey, target]) => {
    const tierByKey: Record<TargetTierKey, CustomerTier> = {
      tier1: 'Tier 1',
      tier2: 'Tier 2',
      tier3: 'Tier 3',
      tier4: 'Tier 4'
    };
    const readableTier = getTierDisplayName(tierByKey[tierKey]);

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

  const medical=getMedicalSettings(activeSettings);
  for(const tier of ['Tier 1','Tier 2','Tier 3','Tier 4'] as CustomerTier[]){
   if(!Number.isFinite(medical.giftPercentages[tier])||medical.giftPercentages[tier]<0||medical.giftPercentages[tier]>100)errors.push('Medical PC percentages must be between 0 and 100');
   for(const key of ['creditDays','paymentBuffers'] as const)if(!Number.isInteger(medical[key][tier])||medical[key][tier]<0||medical[key][tier]>365)errors.push('Medical credit and buffer days must be whole days from 0 to 365');
  }
  if(!Number.isSafeInteger(medical.creditPolicy.starterLimitCap)||medical.creditPolicy.starterLimitCap<0||medical.creditPolicy.starterLimitCap>10000)errors.push('Medical starter limit cap must be whole rupees from 0 to 10000');
  for(const key of ['monthlyTargetBonus','cleanPaymentMonthBonus','newCustomerBonus','referralBonus'] as const)if(!Number.isSafeInteger(medical.loyaltySettings[key])||medical.loyaltySettings[key]<0||medical.loyaltySettings[key]>100000)errors.push('Medical bonus PC must be whole points from 0 to 100000');
  for(const value of Object.values(medical.targetSettings))if(!Number.isSafeInteger(value.monthlySalesTarget)||value.monthlySalesTarget<0||!Number.isSafeInteger(value.monthlyOrderTarget)||value.monthlyOrderTarget<0)errors.push('Medical targets must be non-negative whole rupees and orders');
  const risk=medical.overduePolicy;if(Object.values(risk).some(n=>!Number.isFinite(n)||n<0)||risk.seriousSalesRatioPercent<=risk.minorSalesRatioPercent||risk.seriousDays<=risk.materialDays||risk.seriousInvoiceCount<1||!Number.isInteger(risk.seriousInvoiceCount)||!Number.isInteger(risk.repeatedEventCount))errors.push('Medical overdue risk thresholds are invalid');
  return {
    isValid: errors.length === 0,
    errors: [...new Set(errors)],
    scoringWeightTotal: scoringValidation.scoringWeightTotal
  };
};

export const getGiftPercentageForTier = (tier: CustomerTier, settings?: AppSettings, customerType?:string) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  return getCustomerPolicy(activeSettings,customerType).giftPercentages[tier] ?? DEFAULT_SETTINGS.giftPercentages[tier];
};

export const getCreditDaysForTierFromSettings = (tier: CustomerTier, settings?: AppSettings, customerType?:string) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  return getCustomerPolicy(activeSettings,customerType).creditDays[tier] ?? DEFAULT_SETTINGS.creditDays[tier];
};

export const getPaymentBufferForTier = (tier: CustomerTier, settings?: AppSettings, customerType?:string) => {
  const activeSettings = mergeWithDefaultSettings(settings);
  return getCustomerPolicy(activeSettings,customerType).paymentBuffers[tier] ?? DEFAULT_SETTINGS.paymentBuffers[tier];
};

export const getTotalCreditDaysForTier = (tier: CustomerTier, settings?: AppSettings) => {
  return getCreditDaysForTierFromSettings(tier, settings) + getPaymentBufferForTier(tier, settings);
};

export const calculateDynamicDueDate = (invoiceDate: string, tier: CustomerTier, settings?: AppSettings, customerType?:string) => {
  return addDaysToDateString(invoiceDate, getCreditDaysForTierFromSettings(tier, settings,customerType));
};

export const getInvoiceSavedDueDate = (invoice: Pick<Invoice, 'date' | 'dueDate' | 'savedDueDate' | 'creditDaysAtInvoice'>, tier: CustomerTier, settings?: AppSettings) => {
  const storedDueDate = invoice.savedDueDate?.trim() || invoice.dueDate?.trim();
  if (storedDueDate) return storedDueDate;
  const creditDays = invoice.creditDaysAtInvoice ?? getCreditDaysForTierFromSettings(tier, settings);
  return addDaysToDateString(invoice.date, Math.max(0, Math.round(creditDays)));
};

export const getInvoiceBufferDays = (invoice: Pick<Invoice, 'bufferDaysAtInvoice'>, tier: CustomerTier, settings?: AppSettings) => {
  return Math.max(0, Math.round(invoice.bufferDaysAtInvoice ?? getPaymentBufferForTier(tier, settings)));
};

export const getInvoiceFinalPcCutoffDate = (
  invoice: Pick<Invoice, 'date' | 'dueDate' | 'savedDueDate' | 'finalPcCutoffDate' | 'creditDaysAtInvoice' | 'bufferDaysAtInvoice'>,
  tier: CustomerTier,
  settings?: AppSettings
) => {
  return invoice.finalPcCutoffDate?.trim()
    || addDaysToDateString(getInvoiceSavedDueDate(invoice, tier, settings), getInvoiceBufferDays(invoice, tier, settings));
};

export const buildInvoiceTimeTerms = (
  invoiceDate: string,
  dueDate: string,
  tier: CustomerTier,
  settings?: AppSettings,
  existing?: Partial<Pick<Invoice,
    'tierAtInvoice'
    | 'pcPercentageAtInvoice'
    | 'creditDaysAtInvoice'
    | 'bufferDaysAtInvoice'
    | 'savedDueDate'
    | 'termsEstimated'
  >>,
  creditDaysOverride?: number,
  customerType?:string
) => {
  const tierAtInvoice = existing?.tierAtInvoice ?? tier;
  const creditDaysAtInvoice = Math.max(0, Math.round(
    existing?.creditDaysAtInvoice ?? creditDaysOverride ?? getCreditDaysForTierFromSettings(tierAtInvoice, settings,customerType)
  ));
  const bufferDaysAtInvoice = Math.max(0, Math.round(
    existing?.bufferDaysAtInvoice ?? getPaymentBufferForTier(tierAtInvoice, settings,customerType)
  ));
  const pcPercentageAtInvoice = Math.max(0,
    existing?.pcPercentageAtInvoice ?? getGiftPercentageForTier(tierAtInvoice, settings,customerType)
  );
  const savedDueDate = dueDate.trim()
    || existing?.savedDueDate?.trim()
    || addDaysToDateString(invoiceDate, creditDaysAtInvoice);
  const termsEstimated = existing
    ? existing.termsEstimated === true
      || existing.tierAtInvoice === undefined
      || existing.pcPercentageAtInvoice === undefined
      || existing.creditDaysAtInvoice === undefined
      || existing.bufferDaysAtInvoice === undefined
    : false;

  return {
    tierAtInvoice,
    pcPercentageAtInvoice,
    creditDaysAtInvoice,
    bufferDaysAtInvoice,
    savedDueDate,
    finalPcCutoffDate: addDaysToDateString(savedDueDate, bufferDaysAtInvoice),
    termsEstimated
  };
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

export const getPaymentTermsLabel = (tier: CustomerTier, settings?: AppSettings, customerType?:string) => {
  const creditDays = getCreditDaysForTierFromSettings(tier, settings,customerType);
  const bufferDays = getPaymentBufferForTier(tier, settings,customerType);

  if (creditDays <= 0) {
    return 'No credit - same day payment preferred';
  }

  return bufferDays > 0 ? `${creditDays} day credit; ${bufferDays} day PC buffer` : `${creditDays} day credit`;
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
