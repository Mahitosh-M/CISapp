import {getFirestore,type Transaction} from 'firebase-admin/firestore';
import type {Trip} from './dispatchDomain/domain';
import type {DispatchIdentity} from './dispatchAdmin';
import {identifier,type Data} from './dispatchCore';
/** Read-only financial projection for reporting; never creates receipts/expenses or changes CISapp amounts. */
export async function prepareCompletionValuation(tx:Transaction,t:Trip,records:Array<{id:string;exists:boolean;data:()=>Data|undefined}>,actor:DispatchIdentity){
 const db=getFirestore(),ref=db.doc('dispatchTripValuations/'+identifier(t.id)),old=await tx.get(ref);if(old.exists)return null;
 const wanted=new Set(t.reportingCompletedInvoiceIds??[]),found=records.filter(r=>wanted.has(r.id)&&r.exists),unavailable=[...new Set([...(t.reportingInvoiceIds??[]).filter(id=>!wanted.has(id)),...[...wanted].filter(id=>!found.some(r=>r.id===id))])];
 const values=found.flatMap(record=>{const i=record.data()!;if(['cancelled','deleted','void'].includes(String(i.status??'').toLowerCase()))return[];const sales=Number(i.totalSales??i.salesAmount),profit=Number(i.totalProfit);if(!Number.isFinite(sales)||!Number.isFinite(profit)){unavailable.push(record.id);return[];}return[{invoiceId:record.id,shopId:i.shopId??null,sales:Math.round(sales*100),grossProfit:Math.round(profit*100),sourceUpdatedAt:i.updatedAt??i.createdAt??null}];});
 return{commit(){const at=new Date().toISOString();tx.create(ref,{tripId:t.id,at,actorId:actor.actorId,values,unavailable,source:'CISapp at verified shift closure'});tx.create(db.collection('dispatchAudit').doc(),{action:'Completed trip reporting valuation captured',entityId:t.id,actorId:actor.actorId,at,details:{invoiceCount:values.length,unvaluedCount:unavailable.length}});}};
}
