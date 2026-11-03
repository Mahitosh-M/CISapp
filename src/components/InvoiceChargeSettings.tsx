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
  if(!window.confirm(`${policy.enabled?'Enable':'Disable'} overdue charges for regular customers only from ${policy.effectiveDate}: ${description}. ${policy.includeOpeningBalances?'Include':'Exclude'} opening balances.`))return;
  setBusy(true);setMessage('');setError('');
  try{await httpsCallable(getFunctions(app,'asia-south1'),'configureInvoiceLateCharges')(policy);setMessage('Charge policy saved.');}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 return <section className="invoice-charge-settings" aria-label="Invoice overdue charges">
  <h3>CUSTOMER INVOICE OVERDUE CHARGES</h3>
  <div style={{display:'grid',gap:12,maxWidth:620}}>
   <label className="invoice-charge-toggle"><input type="checkbox" checked={policy.enabled} disabled={busy} onChange={e=>setPolicy({...policy,enabled:e.target.checked})}/> Enable automatic charges for customers</label>
   <label>Invoice scope<select value={policy.scope} disabled={busy} onChange={e=>setPolicy({...policy,scope:e.target.value as Scope})}>
    <option value="new_only">New customer invoices only</option><option value="existing_from_start">Existing unpaid customer invoices — from activation date</option><option value="existing_from_invoice">Existing unpaid customer invoices — from original invoice date</option>
   </select></label>
   <label>Activation date<input type="date" min={businessDate()} value={policy.effectiveDate} disabled={busy} onChange={e=>setPolicy({...policy,effectiveDate:e.target.value})}/></label>
   <label className="invoice-charge-toggle"><input type="checkbox" checked={policy.includeOpeningBalances===true} disabled={busy} onChange={e=>setPolicy({...policy,includeOpeningBalances:e.target.checked})}/> Include unpaid opening balances</label>
   <button type="button" disabled={busy||!policy.effectiveDate} onClick={()=>void save()}>{busy?'Please wait…':'Review and save charge policy'}</button>
   {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </div>
 </section>;
}
