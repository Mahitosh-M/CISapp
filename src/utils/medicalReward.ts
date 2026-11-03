import type {AppSettings, CustomerTier, MedicalInvoiceReward} from '../types';
import {getMedicalSettings} from './settings';

// Existing PC/gift accounting uses one whole PC for each rupee of reward budget.
// No cash reward is converted, and no second wallet or reserve rate is introduced.
export const MEDICAL_COIN_VALUE_PAISE = 100;
export function calculateMedicalReward(grossProfit: number, levelPercentage: number, maximumPercentage: number, manualTroikaaCoins = 0) {
  if (!Number.isSafeInteger(grossProfit)) throw new Error('Invoice profit must be whole rupees.');
  if (![levelPercentage,maximumPercentage].every(n=>Number.isFinite(n)&&n>=0&&n<=100)) throw new Error('Reward percentages must be finite numbers from 0 to 100.');
  if (maximumPercentage < levelPercentage) throw new Error('The Medical ceiling is below the applicable level rate. Ask Admin to update Medical Settings.');
  if (!Number.isSafeInteger(manualTroikaaCoins) || manualTroikaaCoins < 0) throw new Error('TROIKAA coins must be a non-negative whole number.');
  const profit = Math.max(0,grossProfit);
  // Decimal rational arithmetic avoids rounding a 159.975 ceiling up to 160.
  const [digits, exponent='0'] = maximumPercentage.toString().toLowerCase().split('e');
  const [whole, decimal=''] = digits.split('.');
  const shift = Number(exponent)-decimal.length;
  const numerator = BigInt(whole+decimal) * (shift>0 ? 10n**BigInt(shift) : 1n);
  const denominator = 100n * (shift<0 ? 10n**BigInt(-shift) : 1n);
  const maximumAllowedCoins = Number(BigInt(profit)*numerator/denominator);
  const levelRewardCoins = Math.round(profit*levelPercentage/100);
  const error = manualTroikaaCoins>maximumAllowedCoins
    ? 'Maximum allowed reward for this invoice is '+maximumAllowedCoins+' coins. Please enter '+maximumAllowedCoins+' coins or fewer.'
    : levelRewardCoins>maximumAllowedCoins
      ? 'The rounded normal entitlement exceeds the whole-coin ceiling. Ask Admin to increase the maximum percentage.' : '';
  return {maximumAllowedCoins,levelRewardCoins,finalCombinedRewardCoins:Math.max(levelRewardCoins,manualTroikaaCoins),valid:!error,message:error};
}
export function buildMedicalReward(customerType: string|undefined, tier: CustomerTier, profit: number, settings: AppSettings, manualTroikaaCoins=0, existing?: MedicalInvoiceReward): MedicalInvoiceReward|undefined {
  if (customerType!=='medical') {
    if (manualTroikaaCoins!==0 || existing) throw new Error('Remove TROIKAA promotional data before saving a non-MEDICAL invoice.');
    return undefined;
  }
  const policy=getMedicalSettings(settings);
  const levelPercentage=existing?.levelPercentage ?? policy.giftPercentages[tier];
  const maximumPercentage=existing?.maximumPercentage ?? policy.maximumCombinedRewardPercentage!;
  if (!existing && !Number.isInteger(maximumPercentage)) throw new Error('Maximum Combined Reward Percentage must be a whole number. Save Medical Settings before creating a new reward.');
  const quote=calculateMedicalReward(profit,levelPercentage,maximumPercentage,manualTroikaaCoins);
  if (!quote.valid) throw new Error(quote.message);
  return {version:1,manualTroikaaCoins,maximumPercentage,levelPercentage,maximumAllowedCoins:quote.maximumAllowedCoins,levelRewardCoins:quote.levelRewardCoins,normalRewardValue:Math.max(0,profit)*levelPercentage/100,finalCombinedRewardCoins:quote.finalCombinedRewardCoins,settingsId:existing?.settingsId ?? settings.id ?? 'appSettings'};
}
