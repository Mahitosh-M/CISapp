import './InvoiceChargeSettings.css';
import {useEffect,useState} from 'react';
import {doc,getDoc} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {app,db} from '../firebase';

type Scope='new_only'|'existing_from_start'|'existing_from_invoice';
interface Policy {enabled:boolean;scope:Scope;effectiveDate:string;includeOpeningBalances?:boolean;revision?:number;}
const businessDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export default function InvoiceChargeSettings(){
 const [policy,setPolicy]=useState<Policy>({enabled:false,scope:'existing_from_start',effectiveDate:'2026-12-01',includeOpeningBalances:true});
 const [busy,setBusy]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;getDoc(doc(db,'settings/invoiceLateChargePolicy')).then(snapshot=>{if(active&&snapshot.exists())setPolicy(snapshot.data() as Policy);}).catch(e=>active&&setError(String(e.message))).finally(()=>active&&setBusy(false));return()=>{active=false;};},[]);
 async function save(){
  const description=policy.scope==='new_only'?'new invoices only':policy.scope==='existing_from_start'?'existing unpaid invoices, charging from the activation date or day 30, whichever is later':'existing unpaid invoices, assessing missed periods from the original invoice date';
  if(!window.confirm(`${policy.enabled?'Enable':'Disable'} overdue charges from ${policy.effectiveDate} for ${description}. ${policy.includeOpeningBalances?'Include':'Exclude'} opening balances. Original invoice sales and posted receipts remain unchanged. Assessed charges are immutable and separately audited.`))return;
  setBusy(true);setMessage('');setError('');
  try{await httpsCallable(getFunctions(app,'asia-south1'),'configureInvoiceLateCharges')(policy);setMessage('Policy saved. Enabled charges are assessed by the trusted hourly service.');}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <section className="invoice-charge-settings" aria-label="Invoice overdue charges">
  <h3>INVOICE OVERDUE CHARGES</h3>
  <p>From the activation date, invoices reaching 30 days attract 2% on the unpaid balance. Every 15 days afterwards: 1% of the remaining balance, including unpaid charges. Each charge rounds to the nearest whole rupee.</p>
  <p>December policy: no charges before 1 December 2026. Older unpaid invoices and existing opening balances start on 1 December. An invoice dated 20 November first attracts charges on 20 December. Payments through the previous day reduce each assessment.</p>
  <p>Credit due dates stay unchanged. No charge is collected as cash until a payment is received. Disabling stops future assessments; it does not remove posted charges.</p>
  <div style={{display:'grid',gap:12,maxWidth:620}}>
   <label className="invoice-charge-toggle"><input type="checkbox" checked={policy.enabled} disabled={busy} onChange={e=>setPolicy({...policy,enabled:e.target.checked})}/> Enable automatic charges</label>
   <label>Invoice scope<select value={policy.scope} disabled={busy} onChange={e=>setPolicy({...policy,scope:e.target.value as Scope})}>
    <option value="new_only">New invoices only</option><option value="existing_from_start">Existing unpaid invoices — from activation date</option><option value="existing_from_invoice">Existing unpaid invoices — from original invoice date</option>
   </select></label>
   <label>Activation date<input type="date" min={businessDate()} value={policy.effectiveDate} disabled={busy} onChange={e=>setPolicy({...policy,effectiveDate:e.target.value})}/></label>
   <label className="invoice-charge-toggle"><input type="checkbox" checked={policy.includeOpeningBalances===true} disabled={busy} onChange={e=>setPolicy({...policy,includeOpeningBalances:e.target.checked})}/> Include unpaid opening balances</label>
   <p>Changing scope does not rewrite policies already attached to invoices. Backdated payments do not silently reverse an assessed charge; those require review.</p>
   <button type="button" disabled={busy||!policy.effectiveDate} onClick={()=>void save()}>{busy?'Please wait…':'Review and save charge policy'}</button>
   {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </div>
 </section>;
}
