import { FieldValue, getFirestore, type Firestore, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { roundCashBalance } from '../../src/utils/wholeRupees';

const shops = ['SHOP_A', 'SHOP_S'];
function fail(code: 'invalid-argument'|'failed-precondition'|'permission-denied'|'not-found'|'already-exists', message: string): never { throw new HttpsError(code,message); }
function bounded(value:number) { if(!Number.isFinite(value)||Math.abs(value)>1e12)fail('failed-precondition','Cash totals require Admin review.');return value; }
function field(data:DocumentData,key:string) {const value=data[key]??0;if(typeof value!=='number')fail('failed-precondition','Invalid cash total.');return bounded(value);}
function total(data:DocumentData,key:string,delta:number) {const next=bounded(field(data,key)+delta);if(next<0)fail('failed-precondition','Transfer totals are inconsistent. No balances were changed.');return next;}
function balance(tx:Transaction,db:Firestore,uid:string,shopId:string,before:number,delta:number,id:string) {
 const result=roundCashBalance(before,delta);bounded(result.availableBalance);let roundingAuditId:string|null=null;
 if(result.adjustment!==0){const ref=db.collection('cashAdjustments').doc();roundingAuditId=ref.id;tx.create(ref,{shopId,amount:Math.abs(result.adjustment),direction:result.adjustment>0?'add':'deduct',reason:'Whole-rupee rounding for cash operation '+id.slice(0,50),createdAt:FieldValue.serverTimestamp(),createdBy:uid});}
 return {availableBalance:result.availableBalance,roundingDelta:result.adjustment,roundingAuditId};
}
/** Cross-shop balances stay on the server; every operation is checked against the current trusted user profile. */
export async function executeCashTransfer(uid:string|undefined,input:unknown,db:Firestore=getFirestore()) {
 if(!uid)throw new HttpsError('unauthenticated','Sign in before transferring cash.');
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid-argument','Invalid transfer request.');
 const data=input as Record<string,unknown>,action=data.action;
 if(!['create','update','delete'].includes(String(action)))fail('invalid-argument','Invalid transfer action.');
 const keys=action==='create'?['action','id','fromShopId','toShopId','amount','note']:action==='update'?['action','id','amount','note']:['action','id'];
 if(Object.keys(data).some(key=>!keys.includes(key)))fail('invalid-argument','Unexpected transfer fields.');
 if(typeof data.id!=='string'||!data.id||data.id.length>160||data.id.includes('/')||[...data.id].some(c=>c.charCodeAt(0)<32))fail('invalid-argument','Invalid transfer ID.');
 const id=data.id;
 const amount=action==='delete'?0:data.amount;
 if(typeof amount!=='number'||!Number.isSafeInteger(amount)||(action!=='delete'&&(amount<=0||amount>1e8)))fail('invalid-argument','Transfer must be a positive whole rupee amount.');
 if(action!=='delete'&&(typeof data.note!=='string'||data.note.length>160))fail('invalid-argument','Transfer note must be at most 160 characters.');
 const note=String(data.note??'').trim();
 return db.runTransaction(async tx=>{
  const ref=db.doc('shopTransfers/'+id),deletedRef=db.doc('cashTransferOperations/'+id+'_deleted');
  const [profile,snapshot,deleted]=await Promise.all([tx.get(db.doc('users/'+uid)),tx.get(ref),tx.get(deletedRef)]);
  const actor=profile.data(),existing=snapshot.data(),previous=existing??deleted.data()?.transfer;
  if(!actor||actor.active!==true||!['Admin','admin','Staff'].includes(actor.role))fail('permission-denied','Only active team members can transfer cash.');
  if(action==='delete'&&actor.role==='Staff')fail('permission-denied','Only Admin can delete a transfer.');
  const from=action==='create'?data.fromShopId:previous?.fromShopId,to=action==='create'?data.toShopId:previous?.toShopId;
  if(!shops.includes(String(from))||!shops.includes(String(to))||from===to)fail('invalid-argument','Select two different valid shops.');
  if(actor.role==='Staff'&&actor.shopId!==from)fail('permission-denied','Staff can send or correct transfers only from their assigned shop.');
  if(action==='create'&&deleted.exists)fail('already-exists','This transfer ID was already used. Start a new transfer.');
  if(action==='create'&&existing){
   if(existing.fromShopId!==from||existing.toShopId!==to||existing.amount!==amount||existing.note!==note||existing.createdBy!==uid)fail('already-exists','This transfer ID belongs to another operation.');
   return {id,fromShopId:from,toShopId:to,amount,alreadyApplied:true};
  }
  if(action==='delete'&&!existing&&previous)return {id,...previous,alreadyApplied:true};
  if(action!=='create'&&!existing)fail('not-found','Transfer entry was not found.');
  const previousAmount=action==='create'?0:Number(existing!.amount);
  if(action!=='create'&&(!Number.isFinite(previousAmount)||previousAmount<=0||previousAmount>1e8))fail('failed-precondition','Transfer amount requires Admin review.');
  const delta=action==='delete'?-previousAmount:amount-previousAmount;
  if(action==='update'&&delta===0&&note===existing!.note)return {previousAmount,amount,amountDifference:0,fromShopId:from,toShopId:to};
  const senderRef=db.doc('shopCash/'+from),receiverRef=db.doc('shopCash/'+to);
  const [sender,receiver]=await Promise.all([tx.get(senderRef),tx.get(receiverRef)]),s=sender.data(),r=receiver.data();
  if(!s||!r||!s.initializedAt||!r.initializedAt||s.shopId!==from||r.shopId!==to)fail('failed-precondition','Both shop balances must be initialized.');
  const senderBalance=field(s,'availableBalance'),receiverBalance=field(r,'availableBalance');
  if(delta>0&&senderBalance-delta<0)fail('failed-precondition','The sending shop does not have enough available amount.');
  const senderTotal=total(s,'totalTransferredOut',delta),receiverTotal=total(r,'totalTransferredIn',delta);
  const now=new Date().toISOString(),type=action==='create'?'transfer':action==='update'?'transfer_edit':'transfer_delete';
  // Finish every read above before writing balances and their matching rounding audits.
  tx.update(senderRef,{...balance(tx,db,uid,String(from),senderBalance,-delta,id),totalTransferredOut:senderTotal,lastCashOperationId:id,lastCashOperationType:type,updatedAt:now});
  tx.update(receiverRef,{...balance(tx,db,uid,String(to),receiverBalance,delta,id),totalTransferredIn:receiverTotal,lastCashOperationId:id,lastCashOperationType:type,updatedAt:now});
  if(action==='create')tx.create(ref,{fromShopId:from,toShopId:to,amount,note,createdAt:FieldValue.serverTimestamp(),createdBy:uid});
  else if(action==='update')tx.update(ref,{amount,note,updatedAt:FieldValue.serverTimestamp(),updatedBy:uid});
  else tx.delete(ref);
  const audit=action==='delete'?deletedRef:db.collection('cashTransferOperations').doc();
  tx.create(audit,{transferId:id,action,fromShopId:from,toShopId:to,previousAmount,amount:action==='delete'?0:amount,...(action==='delete'?{transfer:{fromShopId:from,toShopId:to,amount:previousAmount,note:existing!.note,createdBy:existing!.createdBy}}:{}),createdAt:FieldValue.serverTimestamp(),createdBy:uid});
  return action==='delete'?{id,fromShopId:from,toShopId:to,amount:previousAmount,note:existing!.note,createdBy:existing!.createdBy,createdAt:null}:{id,previousAmount,amount,amountDifference:delta,fromShopId:from,toShopId:to};
 });
}
export const manageCashTransfer=onCall({region:'asia-south1'},request=>executeCashTransfer(request.auth?.uid,request.data));

/** New cash outflows use the same trusted actor/shop checks and replay protection as transfers. */
export async function executeCashExpense(uid:string|undefined,input:unknown,db:Firestore=getFirestore()) {
 if(!uid)throw new HttpsError('unauthenticated','Sign in before saving cash outflows.');
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid-argument','Invalid expense request.');
 const data=input as Record<string,unknown>,allowed=['id','shopId','amount','category','description'];
 if(Object.keys(data).some(k=>!allowed.includes(k)))fail('invalid-argument','Unexpected expense fields.');
 if(typeof data.id!=='string'||!data.id||data.id.length>160||data.id.includes('/')||[...data.id].some(c=>c.charCodeAt(0)<32))fail('invalid-argument','Invalid expense ID.');
 if(!shops.includes(String(data.shopId)))fail('invalid-argument','Select a valid shop.');
 if(typeof data.amount!=='number'||!Number.isSafeInteger(data.amount)||data.amount<=0||data.amount>1e8)fail('invalid-argument','Expense must be a positive whole rupee amount.');
 if(!['purchases','emi','salary','fuel','electricity','rent','maintenance','transport','supplies','taxes','other'].includes(String(data.category)))fail('invalid-argument','Select a valid expense category.');
 if(typeof data.description!=='string'||!data.description.trim()||data.description.length>160)fail('invalid-argument','Enter expense details of at most 160 characters.');
 const id=data.id,shopId=String(data.shopId),amount=data.amount,description=data.description.trim(),category=String(data.category);
 return db.runTransaction(async tx=>{
  const ref=db.doc('cashExpenses/'+id),summaryRef=db.doc('shopCash/'+shopId);
  const [profile,expense,summary]=await Promise.all([tx.get(db.doc('users/'+uid)),tx.get(ref),tx.get(summaryRef)]);
  const actor=profile.data();
  if(!actor||actor.active!==true||!['Admin','admin','Staff'].includes(actor.role))fail('permission-denied','Only active team members can save cash outflows.');
  if(actor.role==='Staff'&&actor.shopId!==shopId)fail('permission-denied','Staff can save cash outflows only for their assigned shop.');
  const old=expense.data();
  if(old){
   if(old.shopId!==shopId||old.amount!==amount||old.category!==category||old.description!==description||old.createdBy!==uid)fail('already-exists','This expense ID belongs to another operation.');
   return {id,shopId,amount,alreadyApplied:true};
  }
  const s=summary.data();
  if(!s||!s.initializedAt||s.shopId!==shopId)fail('failed-precondition','The shop balance is not initialized.');
  const nextTotal=total(s,'totalExpenses',amount);
  tx.create(ref,{shopId,amount,category,description,createdAt:FieldValue.serverTimestamp(),createdBy:uid});
  tx.update(summaryRef,{...balance(tx,db,uid,shopId,field(s,'availableBalance'),-amount,id),totalExpenses:nextTotal,lastCashOperationId:id,lastCashOperationType:'expense',updatedAt:new Date().toISOString()});
  return {id,shopId,amount};
 });
}
export const createCashExpense=onCall({region:'asia-south1'},request=>executeCashExpense(request.auth?.uid,request.data));
