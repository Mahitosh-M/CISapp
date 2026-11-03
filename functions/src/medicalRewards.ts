import {getFirestore} from 'firebase-admin/firestore';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {calculateMedicalReward} from '../../src/utils/medicalReward';
import {getMedicalSettings,mergeWithDefaultSettings} from '../../src/utils/settings';
import {calculateInvoiceApcInfo,getInvoiceFullPaymentEvent} from '../../src/utils/customerPortal';
import {mapInvoiceDoc,mapPaymentDoc} from '../../src/utils/financialDocuments';
import {canPostInvoicePcForSettlement,decideImmutableInvoicePcAward} from '../../src/utils/pcAwardPolicy';
import type {CustomerTier} from '../../src/types';
import type {MedicalRewardQuoteResponse} from '../../src/utils/medicalRewardContract';
const db=()=>getFirestore();
const id=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>160||value.includes('/'))throw new HttpsError('invalid-argument','Invalid record ID.');return value;};
async function actor(uid?:string){
 if(!uid)throw new HttpsError('unauthenticated','Sign in first.');
 const user=(await db().doc('users/'+uid).get()).data();
 if(user?.active!==true||!['Admin','Staff'].includes(user.role))throw new HttpsError('permission-denied','Only active CISapp team members may manage invoice rewards.');
 return user;
}
function scope(user:FirebaseFirestore.DocumentData,invoice:FirebaseFirestore.DocumentData){if(user.role==='Staff'&&user.shopId&&invoice.shopId&&user.shopId!==invoice.shopId)throw new HttpsError('permission-denied','This invoice belongs to another shop.');}
async function settings(){const preferred=await db().doc('settings/appSettings').get();if(preferred.exists)return mergeWithDefaultSettings({...preferred.data(),id:preferred.id});const result=await db().collection('settings').where('key','==','erpSettings').limit(1).get();return mergeWithDefaultSettings({...result.docs[0]?.data(),id:result.docs[0]?.id});}
export const quoteMedicalInvoiceReward=onCall({region:'asia-south1'},async (request):Promise<MedicalRewardQuoteResponse>=>{
 const user=await actor(request.auth?.uid);const data=request.data;
 if(!data||typeof data!=='object'||Object.keys(data).some(key=>!['customerId','invoiceId','salesAmount','costAmount','transportAmount','manualTroikaaCoins'].includes(key)))throw new HttpsError('invalid-argument','Invalid quote fields.');
 const customerId=id(data.customerId);const customer=(await db().doc('customers/'+customerId).get()).data();
 if(customer?.customerType!=='medical')throw new HttpsError('failed-precondition','TROIKAA coins are available only for MEDICAL customers.');
 for(const key of ['salesAmount','costAmount','transportAmount','manualTroikaaCoins'])if(!Number.isSafeInteger(data[key])||data[key]<0)throw new HttpsError('invalid-argument','Invoice amounts and proposed coins must be non-negative whole numbers.');
 const invoice=data.invoiceId?(await db().doc('invoices/'+id(data.invoiceId)).get()).data():undefined;
 if(data.invoiceId&&!invoice)throw new HttpsError('not-found','Invoice no longer exists.');
 if(invoice){scope(user,invoice);if(invoice.customerId!==customerId&&(await db().doc('loyaltyLedger/'+invoice.customerId+'_'+data.invoiceId+'_invoice_pc').get()).exists)throw new HttpsError('failed-precondition','A posted invoice reward cannot move to another customer.');}
 const policy=getMedicalSettings(await settings());
 const saved=invoice?.customerId===customerId?invoice?.medicalReward:undefined;
 if(invoice&&!invoice.medicalReward)return {maximumAllowedCoins:0,levelRewardCoins:0,finalCombinedRewardCoins:0,valid:data.manualTroikaaCoins===0,message:'Historical invoice rewards are preserved. TROIKAA proposals apply to new invoices.',locked:true};
 if(invoice&&saved&&(await db().doc('loyaltyLedger/'+customerId+'_'+data.invoiceId+'_invoice_pc').get()).exists)return {maximumAllowedCoins:saved.maximumAllowedCoins,levelRewardCoins:saved.levelRewardCoins,finalCombinedRewardCoins:saved.finalCombinedRewardCoins,valid:data.manualTroikaaCoins===saved.manualTroikaaCoins,message:'Reward already finalised. Its saved proposal is protected.',locked:true};
 if(!saved&&!Number.isInteger(policy.maximumCombinedRewardPercentage))throw new HttpsError('failed-precondition','Maximum Combined Reward Percentage must be a whole number. Save Medical Settings first.');
 try {return {...calculateMedicalReward(data.salesAmount-data.costAmount-data.transportAmount,saved?.levelPercentage??policy.giftPercentages[customer.tier as CustomerTier]??policy.giftPercentages['Tier 4'],saved?.maximumPercentage??policy.maximumCombinedRewardPercentage!,data.manualTroikaaCoins),locked:false};}
 catch(error){throw new HttpsError('invalid-argument',error instanceof Error?error.message:'Invalid reward proposal.');}
});
// Existing immutable invoice ledger ID and balance transaction are reused.
// No trigger writes historical records. Posting occurs only through the existing settlement/retry flow.
export const postMedicalInvoiceReward=onCall({region:'asia-south1'},async request=>{
 const user=await actor(request.auth?.uid);const invoiceId=id(request.data?.invoiceId);
 return db().runTransaction(async tx=>{
  const invoiceRef=db().doc('invoices/'+invoiceId);const invoiceSnap=await tx.get(invoiceRef);
  if(!invoiceSnap.exists)throw new HttpsError('not-found','Invoice no longer exists.');
  const invoice=mapInvoiceDoc(invoiceId,invoiceSnap.data()!);scope(user,invoiceSnap.data()!);
  if(!invoice.medicalReward)throw new HttpsError('failed-precondition','This endpoint is only for combined Medical invoice rewards.');
  const ledgerRef=db().doc('loyaltyLedger/'+invoice.customerId+'_'+invoiceId+'_invoice_pc');
  const ledger=await tx.get(ledgerRef);
  if(ledger.exists)return {invoiceId,status:'already_finalized',points:Number(ledger.data()?.points??0)};
  const balanceRef=db().doc('pcBalances/'+invoice.customerId);
  const [balanceSnap,paymentSnaps]=await Promise.all([tx.get(balanceRef),tx.get(db().collection('payments').where('invoiceId','==',invoiceId))]);
  const balance=balanceSnap.data();const payments=paymentSnaps.docs.map(s=>mapPaymentDoc(s.id,s.data()));
  const settlement=getInvoiceFullPaymentEvent(invoice,payments);
  if(!settlement)return {invoiceId,status:'not_fully_paid',points:0};
  if(!canPostInvoicePcForSettlement(invoice,settlement,balance?.protectedAt))return {invoiceId,status:'not_eligible',points:0};
  const award=calculateInvoiceApcInfo(invoice,payments,invoice.tierAtInvoice??'Tier 4');
  const decision=decideImmutableInvoicePcAward(false,undefined,award.earnedApc);const timestamp=new Date().toISOString();
  const availablePc=Number(balance?.availablePc??0)+decision.pointsToAdd;
  if(decision.pointsToAdd>0)tx.set(balanceRef,{customerId:invoice.customerId,availablePc,incomingPc:Number(balance?.incomingPc??0)+decision.pointsToAdd,redeemedPc:Number(balance?.redeemedPc??0),protectedAt:String(balance?.protectedAt??''),lastAwardReferenceId:invoiceId,lastMutationReferenceId:ledgerRef.id,updatedAt:timestamp},{merge:true});
  tx.create(ledgerRef,{customerId:invoice.customerId,type:'on_time_payment',points:decision.awardedPoints,reason:'Invoice '+invoice.invoiceNumber+' combined PC permanently finalised',referenceId:invoiceId,month:settlement.date.slice(0,7),createdAt:timestamp});
  return {invoiceId,status:decision.pointsToAdd>0?'credited':'finalized_zero',points:decision.awardedPoints,availablePc};
 });
});
