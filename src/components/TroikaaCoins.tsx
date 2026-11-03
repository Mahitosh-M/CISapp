import {useEffect,useState} from 'react';
import {quoteMedicalReward} from '../services/medicalRewardService';
import type {MedicalRewardQuoteRequest,MedicalRewardQuoteResponse} from '../utils/medicalRewardContract';
import './TroikaaCoins.css';
export default function TroikaaCoins({customerType,input,onChange}:{customerType?:string;input:MedicalRewardQuoteRequest;onChange:(coins:number)=>void}){
 const [open,setOpen]=useState(false);
 const [quote,setQuote]=useState<MedicalRewardQuoteResponse>();
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const [text,setText]=useState(String(input.manualTroikaaCoins));
 useEffect(()=>{setText(String(input.manualTroikaaCoins));},[input.manualTroikaaCoins,input.customerId]);
 useEffect(()=>{setOpen(false);setQuote(undefined);setError('');},[input.customerId,input.invoiceId]);
 useEffect(()=>{
  if(!open||customerType!=='medical')return;
  let active=true;setQuote(undefined);setError('');setLoading(true);
  const timer=setTimeout(()=>{void quoteMedicalReward(input).then(value=>{if(active)setQuote(value);}).catch(err=>{if(active)setError(err instanceof Error?err.message:'Unable to validate reward.');}).finally(()=>{if(active)setLoading(false);});},200);
  return ()=>{active=false;clearTimeout(timer);};
 },[open,customerType,input.customerId,input.invoiceId,input.salesAmount,input.costAmount,input.transportAmount,input.manualTroikaaCoins]);
 if(customerType!=='medical')return null;
 return <section className="troikaa-coins" aria-label="TROIKAA reward">
  <button className="troikaa-toggle" type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>TROIKAA Coins</button>
  {open&&<div className="troikaa-panel">
   <label>TROIKAA Coins<input aria-label="Manual TROIKAA coins" type="text" inputMode="numeric" pattern="[0-9]*" value={text} disabled={quote?.locked} onChange={event=>{const value=event.target.value;setText(value);onChange(value===''?0:Number(value));}}/></label>
   {loading&&<p role="status">Checking reward limits…</p>}
   {error&&<p role="alert">{error}</p>}
   {quote&&<><dl><div><dt>Maximum allowed total coins</dt><dd>{quote.maximumAllowedCoins}</dd></div><div><dt>Normal level entitlement</dt><dd>{quote.levelRewardCoins}</dd></div><div><dt>Final combined reward coins</dt><dd>{quote.valid?quote.finalCombinedRewardCoins:'Revise proposal'}</dd></div></dl>{quote.message&&<p role={quote.valid?'status':'alert'}>{quote.message}</p>}</>}
  </div>}
 </section>;
}
