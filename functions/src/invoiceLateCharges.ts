import {getApps,initializeApp} from 'firebase-admin/app';
import {FieldPath,getFirestore,type Firestore} from 'firebase-admin/firestore';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {onDocumentCreated,onDocumentWritten} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {assessInvoiceCharges,chargeDate,invoiceReceivableAmount,type ChargeInvoice} from '../../src/utils/invoiceCharges';
import {applyCustomerOutstandingDelta} from '../../src/utils/customerOutstanding';
import {getInvoicePaymentEffect} from '../../src/utils/paymentUtils';
import {isOpeningBalanceInvoice} from '../../src/utils/openingBalance';
import {mapPaymentDoc} from '../../src/utils/financialDocuments';
import {stableId} from './dispatchCore';

type Scope='new_only'|'existing_from_start'|'existing_from_invoice';
interface Policy {enabled:boolean;scope:Scope;effectiveDate:string;revision:number;rolloutCursor?:string;rolloutComplete?:boolean;}
const region='asia-south1';
const database=()=>getFirestore(getApps()[0]??initializeApp());
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function admin(uid?:string){if(!uid)throw new HttpsError('unauthenticated','Sign in');const p=await database().doc(`users/${uid}`).get();if(p.data()?.active!==true||p.data()?.role!=='Admin')throw new HttpsError('permission-denied','Admin only');return uid;}
function policyInput(data:Record<string,unknown>):Omit<Policy,'revision'>{
  if(typeof data.enabled!=='boolean'||!['new_only','existing_from_start','existing_from_invoice'].includes(String(data.scope)))throw new HttpsError('invalid-argument','Choose an activation scope');
  const effectiveDate=String(data.effectiveDate??'');chargeDate(effectiveDate,0);
  if(data.enabled && effectiveDate<today())throw new HttpsError('invalid-argument','Activation date cannot be before today; select retrospective scope explicitly');
  return{enabled:data.enabled,scope:data.scope as Scope,effectiveDate};
}
const opening=(value:Record<string,any>)=>isOpeningBalanceInvoice({...value,invoiceNumber:String(value.invoiceNumber??'')});
function firstDate(invoice:Record<string,any>,policy:Policy){const maturity=chargeDate(invoice.date,30);return policy.scope==='existing_from_invoice'?maturity:maturity>policy.effectiveDate?maturity:policy.effectiveDate;}

export const configureInvoiceLateCharges=onCall({region},async request=>{
  const uid=await admin(request.auth?.uid),input=policyInput(request.data??{}),db=database(),ref=db.doc('settings/invoiceLateChargePolicy');
  return db.runTransaction(async tx=>{const previous=await tx.get(ref);const value:Policy={...input,revision:Number(previous.data()?.revision??0)+1,rolloutComplete:input.scope==='new_only'};
    tx.set(ref,{...value,updatedAt:new Date().toISOString(),updatedBy:uid});
    tx.create(db.collection('invoiceChargePolicyAudit').doc(),{before:previous.data()??null,after:value,actorId:uid,at:new Date().toISOString()});return value;
  });
});

export async function registerInvoiceChargePolicy(db:Firestore,id:string,policy:Policy){
  return db.runTransaction(async tx=>{const ref=db.doc(`invoices/${id}`),snapshot=await tx.get(ref),value=snapshot.data();
    if(!policy.enabled||!value||value.lateChargePolicy||opening(value)||['cancelled','deleted','void'].includes(String(value.status??value.recordStatus??'').toLowerCase()))return false;
    if(policy.scope==='new_only'){
      const created=value.createdAt?.toDate?.()??(value.createdAt instanceof Date?value.createdAt:new Date(String(value.createdAt??'')));
      if(!Number.isFinite(created.getTime())||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(created)<policy.effectiveDate)return false;
    }
    const payments=await tx.get(db.collection('payments').where('invoiceId','==',id));
    const paid=payments.docs.reduce((sum,d)=>sum+getInvoicePaymentEffect(mapPaymentDoc(d.id,d.data())),0);
    if(invoiceReceivableAmount(value as ChargeInvoice)<=paid)return false;
    const firstChargeDate=firstDate(value,policy);
    tx.update(ref,{lateChargePolicy:{version:1,firstChargeDate,nextIndex:0},lateChargesTotal:0,lateChargeEvents:[],nextLateChargeDate:firstChargeDate});return true;
  });
}

export async function postInvoiceLateCharges(db:Firestore,id:string,asOf:string){
  return db.runTransaction(async tx=>{
    const ref=db.doc(`invoices/${id}`),snapshot=await tx.get(ref),value=snapshot.data();
    if(!value?.lateChargePolicy)return{added:0};
    if(opening(value)||['cancelled','deleted','void'].includes(String(value.status??value.recordStatus??'').toLowerCase())){tx.update(ref,{nextLateChargeDate:null});return{added:0};}
    const customerRef=db.doc(`customers/${value.customerId}`);
    const [customer,paymentDocs]=await Promise.all([tx.get(customerRef),tx.get(db.collection('payments').where('invoiceId','==',id))]);
    if(!customer.exists)throw new Error('Customer missing; charge requires review');
    const payments=paymentDocs.docs.map(d=>mapPaymentDoc(d.id,d.data()));
    const at=new Date().toISOString(),result=assessInvoiceCharges({id,...value} as ChargeInvoice,payments,asOf,at);
    // All reads precede writes. Assessment IDs and the invoice state change atomically.
    result.events.forEach(event=>tx.create(db.doc(`invoiceLateCharges/${stableId('late-charge',event.id)}`),{...event,invoiceId:id,customerId:value.customerId,shopId:value.shopId??null,policyVersion:1}));
    tx.update(ref,{lateChargeEvents:[...(value.lateChargeEvents??[]),...result.events],lateChargesTotal:Number(value.lateChargesTotal??0)+result.added,lateChargePolicy:{...value.lateChargePolicy,nextIndex:result.nextIndex},nextLateChargeDate:result.nextDate,lateChargesUpdatedAt:at});
    if(result.added>0)tx.update(customerRef,{...applyCustomerOutstandingDelta(customer.data()!,{invoice:result.added}),financialSummaryUpdatedAt:at,updatedAt:at});
    return{added:result.added,assessments:result.events.length};
  });
}

export const registerNewInvoiceLateCharges=onDocumentCreated({document:'invoices/{invoiceId}',region},async event=>{
  const db=database(),config=await db.doc('settings/invoiceLateChargePolicy').get();const p=config.data() as Policy|undefined;
  if(p?.enabled)await registerInvoiceChargePolicy(db,event.params.invoiceId,p);
});

export const assessDueInvoiceLateCharges=onSchedule({schedule:'every 60 minutes',timeZone:'Asia/Kolkata',region},async()=>{
  const db=database(),config=db.doc('settings/invoiceLateChargePolicy'),snapshot=await config.get(),p=snapshot.data() as Policy|undefined,day=today();
  if(!p?.enabled||p.effectiveDate>day)return;
  if(!p.rolloutComplete){
    let query=db.collection('invoices').orderBy(FieldPath.documentId()).limit(100);
    if(p.rolloutCursor)query=query.startAfter(p.rolloutCursor);
    const page=await query.get();for(const invoice of page.docs)await registerInvoiceChargePolicy(db,invoice.id,p);
    await db.runTransaction(async tx=>{const latest=await tx.get(config);if(latest.data()?.revision===p.revision)tx.update(config,{rolloutCursor:page.docs.at(-1)?.id??p.rolloutCursor??'',rolloutComplete:page.size<100});});
  }
  const due=await db.collection('invoices').where('nextLateChargeDate','<=',day).orderBy('nextLateChargeDate').limit(100).get();
  for(const invoice of due.docs)await postInvoiceLateCharges(db,invoice.id,day);
});

export const reopenInvoiceLateCharges=onDocumentWritten({document:'payments/{paymentId}',region},async event=>{
  const db=database();const ids=new Set([event.data?.before.data()?.invoiceId,event.data?.after.data()?.invoiceId].filter(Boolean));
  for(const id of ids){await db.runTransaction(async tx=>{const ref=db.doc(`invoices/${id}`),invoice=await tx.get(ref),value=invoice.data();if(!value?.lateChargePolicy||value.nextLateChargeDate!==null)return;
    const payments=await tx.get(db.collection('payments').where('invoiceId','==',id));
    const paid=payments.docs.reduce((sum,d)=>sum+getInvoicePaymentEffect(mapPaymentDoc(d.id,d.data())),0);
    if(invoiceReceivableAmount(value as ChargeInvoice)>paid)tx.update(ref,{nextLateChargeDate:chargeDate(value.lateChargePolicy.firstChargeDate,value.lateChargePolicy.nextIndex*15)});
  });}
});
