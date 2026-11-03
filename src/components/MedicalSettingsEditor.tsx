import {useEffect,type CSSProperties} from 'react';
import type {AppSettings,MedicalSettings,CustomerTier,TargetTierKey} from '../types';
import {getMedicalSettings} from '../utils/settings';
import {CUSTOMER_TIERS,getTierDisplayName} from '../utils/tiers';
const input:CSSProperties={width:'100%',boxSizing:'border-box',padding:12,borderRadius:8,border:'1px solid #526080',background:'#101b34',color:'#fff',fontSize:16};
const grid:CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,210px),1fr))',gap:16};
export default function MedicalSettingsEditor({settings,onChange}:{settings:AppSettings;onChange:(value:MedicalSettings)=>void}){
 const medical=getMedicalSettings(settings);
 const maximum=medical.maximumCombinedRewardPercentage!;
 useEffect(()=>{if(Number.isFinite(maximum)&&!Number.isInteger(maximum))onChange({...medical,maximumCombinedRewardPercentage:Math.round(maximum)});},[maximum,onChange]);
 const number=(label:string,value:number,change:(n:number)=>void,max?:number,step=1)=><label style={{display:'grid',gap:8}} key={label}>{label}<input style={input} aria-label={label} type="number" min={0} max={max} step={step} required value={Number.isNaN(value)?'':value} onChange={e=>change(e.target.value===''?NaN:Number(e.target.value))}/></label>;
 function tier(group:'creditDays'|'giftPercentages'|'paymentBuffers',key:CustomerTier,n:number){onChange({...medical,[group]:{...medical[group],[key]:n}});}
 return <section aria-label="Medical customer policies">
 <h3>Combined invoice reward</h3>{number('Maximum Combined Reward Percentage',medical.maximumCombinedRewardPercentage!,n=>onChange({...medical,maximumCombinedRewardPercentage:Math.round(n)}),100)}
 <h3>Medical credit and invoice PC by tier</h3><div style={grid}>{CUSTOMER_TIERS.map(key=><fieldset key={key} style={{border:'1px solid #64708b',borderRadius:10,padding:14,display:'grid',gap:14}}><legend>{getTierDisplayName(key)}</legend>{number('Medical '+getTierDisplayName(key)+' credit days',medical.creditDays[key],n=>tier('creditDays',key,n),365)}{number('Medical '+getTierDisplayName(key)+' PC percentage',medical.giftPercentages[key],n=>tier('giftPercentages',key,n),100,0.1)}{number('Medical '+getTierDisplayName(key)+' PC buffer days',medical.paymentBuffers[key],n=>tier('paymentBuffers',key,n),365)}</fieldset>)}</div>
 <h3>Medical credit limit</h3>{number('Medical provisional starter limit cap (INR)',medical.creditPolicy.starterLimitCap,n=>onChange({...medical,creditPolicy:{...medical.creditPolicy,starterLimitCap:n}}),10000)}
 <h3>Medical monthly targets</h3><div style={grid}>{CUSTOMER_TIERS.map((key,index)=>{const target=('tier'+(index+1)) as TargetTierKey;return <fieldset key={key}><legend>{getTierDisplayName(key)}</legend>{number('Medical '+getTierDisplayName(key)+' monthly sales target (INR)',medical.targetSettings[target].monthlySalesTarget,n=>onChange({...medical,targetSettings:{...medical.targetSettings,[target]:{...medical.targetSettings[target],monthlySalesTarget:n}}}))}{number('Medical '+getTierDisplayName(key)+' monthly order target',medical.targetSettings[target].monthlyOrderTarget,n=>onChange({...medical,targetSettings:{...medical.targetSettings,[target]:{...medical.targetSettings[target],monthlyOrderTarget:n}}}))}</fieldset>;})}</div>
 <h3>Medical bonus PC</h3><div style={grid}>{(['monthlyTargetBonus','cleanPaymentMonthBonus','newCustomerBonus','referralBonus'] as const).map(key=>number('Medical '+({monthlyTargetBonus:'monthly target bonus PC',cleanPaymentMonthBonus:'clean payment month bonus PC',newCustomerBonus:'new customer bonus PC',referralBonus:'referral bonus PC'}[key]),medical.loyaltySettings[key],n=>onChange({...medical,loyaltySettings:{...medical.loyaltySettings,[key]:n}}),100000))}</div>
 <h3>Medical overdue credit-risk thresholds</h3><div style={grid}>{(Object.keys(medical.overduePolicy) as Array<keyof MedicalSettings['overduePolicy']>).map(key=>number('Medical '+key,medical.overduePolicy[key],n=>onChange({...medical,overduePolicy:{...medical.overduePolicy,[key]:n}}),undefined,key.includes('Percent')?0.1:1))}</div>
 </section>;
}
