import {describe,it,expect} from 'vitest';
import {DEFAULT_SETTINGS,getMedicalSettings,mergeWithDefaultSettings,calculateDynamicDueDate,buildInvoiceTimeTerms,getGiftPercentageForTier,getTierTargetSettings,validateAppSettings} from './settings';
import {getBonusPcAmount} from './bonusPc';
import {calculateCustomerCredit} from './creditCalculation';
import {calculateInvoiceApcInfo} from './customerPortal';
import type {Invoice} from '../types';
const medical=()=>({...getMedicalSettings(),creditDays:{'Tier 1':21,'Tier 2':20,'Tier 3':18,'Tier 4':15},giftPercentages:{'Tier 1':8,'Tier 2':6,'Tier 3':4,'Tier 4':2}});
describe('independent Medical policies',()=>{
 it('defaults every Medical tier to 15 days without inheriting normal credit edits',()=>{
  const settings=mergeWithDefaultSettings({...DEFAULT_SETTINGS,creditDays:{'Tier 1':30,'Tier 2':25,'Tier 3':10,'Tier 4':7}});
  for(const tier of ['Tier 1','Tier 2','Tier 3','Tier 4'] as const)expect(calculateDynamicDueDate('2026-11-01',tier,settings,'medical')).toBe('2026-11-16');expect(calculateDynamicDueDate('2026-11-01','Tier 4',settings)).toBe('2026-11-08');
 });
 it('preserves independent Medical settings through load/save normalisation',()=>{
  const settings=mergeWithDefaultSettings({...DEFAULT_SETTINGS,medicalSettings:medical()});expect(mergeWithDefaultSettings(settings).medicalSettings).toEqual(settings.medicalSettings);expect(getGiftPercentageForTier('Tier 1',settings,'medical')).toBe(8);expect(getGiftPercentageForTier('Tier 1',settings)).toBe(4);
 });
 it('saves Medical invoice PC and credit terms independently of tier defaults',()=>{
  const settings=mergeWithDefaultSettings({...DEFAULT_SETTINGS,medicalSettings:medical()}),terms=buildInvoiceTimeTerms('2026-11-01','','Tier 1',settings,undefined,undefined,'medical');expect(terms).toMatchObject({creditDaysAtInvoice:21,pcPercentageAtInvoice:8,bufferDaysAtInvoice:3,savedDueDate:'2026-11-22'});expect(buildInvoiceTimeTerms('2026-11-01','','Tier 1',settings)).toMatchObject({creditDaysAtInvoice:15,pcPercentageAtInvoice:4});
 });
 it('does not rewrite historical terms or awarded invoice PC when Medical settings change',()=>{
  const existing={tierAtInvoice:'Tier 1' as const,creditDaysAtInvoice:15,pcPercentageAtInvoice:4,bufferDaysAtInvoice:3,savedDueDate:'2026-11-16'},settings=mergeWithDefaultSettings({...DEFAULT_SETTINGS,medicalSettings:medical()});
  expect(buildInvoiceTimeTerms('2026-11-01','','Tier 1',settings,existing,undefined,'medical')).toMatchObject(existing);
  const invoice={id:'i',date:'2026-11-01',dueDate:'2026-11-16',totalSales:1000,totalProfit:100,...existing} as Invoice;expect(calculateInvoiceApcInfo(invoice,[],'Tier 1',settings,'2026-11-01').expectedApc).toBe(4);
 });
 it('separates Medical monthly targets and bonus amounts while normal bonuses stay unchanged',()=>{
  const profile=medical();profile.targetSettings.tier4={monthlySalesTarget:2500,monthlyOrderTarget:8};profile.loyaltySettings.newCustomerBonus=35;profile.loyaltySettings.referralBonus=75;
  const settings=mergeWithDefaultSettings({...DEFAULT_SETTINGS,medicalSettings:profile});expect(getTierTargetSettings('Tier 4',settings,'medical')).toEqual({monthlySalesTarget:2500,monthlyOrderTarget:8});expect(getTierTargetSettings('Tier 4',settings).monthlyOrderTarget).toBe(1);expect(getBonusPcAmount('medical','new_customer',settings)).toBe(35);expect(getBonusPcAmount('customer','new_customer',settings)).toBe(20);expect(getBonusPcAmount('medical','referral',settings)).toBe(75);
 });
 it('uses Medical credit days and starter cap without changing normal credit recommendations',()=>{
  const profile=medical();profile.creditPolicy.starterLimitCap=2000;const settings=mergeWithDefaultSettings({...DEFAULT_SETTINGS,medicalSettings:profile});
  const input={customerId:'c',invoices:[],payments:[],settings,existingProfile:{manualStarterLimit:5000},reviewReason:'test'};const med=calculateCustomerCredit({...input,customer:{customerType:'medical',tier:'Tier 1'}}),normal=calculateCustomerCredit({...input,customer:{customerType:'customer',tier:'Tier 1'}});expect(med.summary.creditDays).toBe(21);expect(med.profile.calculatedCreditLimit).toBe(2000);expect(normal.profile.calculatedCreditLimit).toBe(5000);
 });
 it('rejects invalid Medical percentages, fractional days/bonuses and targets',()=>{
  const profile=medical();profile.giftPercentages['Tier 1']=101;profile.creditDays['Tier 2']=1.5;profile.loyaltySettings.newCustomerBonus=2.5;profile.targetSettings.tier1.monthlyOrderTarget=-1;expect(validateAppSettings({...DEFAULT_SETTINGS,medicalSettings:profile}).isValid).toBe(false);
 });
});
