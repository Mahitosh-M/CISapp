import {getFirestore} from 'firebase-admin/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {logger} from 'firebase-functions';
import type {AppState} from './dispatchDomain/domain';
import {closedTimestamp,eligibleForRetention,expireDeliveryDetails} from './dispatchDomain/retention';
import {identifier,stableId} from './dispatchCore';
/** Only Dispatch-owned collections are written. Source CISapp records are untouched. */
export async function expireClosedDispatchData(at=new Date().toISOString(),db=getFirestore()){
 if(!Number.isFinite(Date.parse(at)))throw new Error('Invalid retention timestamp');
 const stateRef=db.doc('dispatchOperationalState/main');
 const initial=(await stateRef.get()).data()?.state as AppState|undefined;
 let expired=0,images=0;
 if(initial){
  const candidates=initial.trips.filter(t=>t.status==='Closed'&&!t.purgedAt&&(!closedTimestamp(initial,t)||eligibleForRetention(initial,t,at))).slice(0,10);
  for(const candidate of candidates){
   const tripId=identifier(candidate.id),retentionRef=db.doc('dispatchRetention/'+stableId('trip',tripId)),tripRef=db.doc('dispatchTrips/'+tripId);
   const removed=await db.runTransaction(async tx=>{
    const [snapshot,phase,published]=await Promise.all([tx.get(stateRef),tx.get(retentionRef),tx.get(tripRef)]);
    if(phase.exists)return;
    const s=snapshot.data()?.state as AppState|undefined,t=s?.trips.find(t=>t.id===tripId);if(!s||!t||t.status!=='Closed'||t.purgedAt)return;
    // Legacy trips without a verified closure time get a full seven-day grace period.
    if(!closedTimestamp(s,t)){t.closedAt=at;tx.set(stateRef,{state:s,updatedAt:at});if(published.exists)tx.update(tripRef,{closedAt:at});return;}
    if(!eligibleForRetention(s,t,at))return;
    const claims=await tx.get(db.collection('dispatchCollections').where('tripId','==',tripId));
    if(claims.docs.some(d=>d.data().status==='Pending'||d.data().status==='Posted'&&d.data().unallocated>0))return;
    const result=expireDeliveryDetails(s,new Set([tripId]),at);
    tx.set(stateRef,{state:JSON.parse(JSON.stringify(s)),updatedAt:at});
    if(published.exists)tx.update(tripRef,{purgedAt:at,closedAt:closedTimestamp(s,t),stops:[],openingPhoto:null,closingPhoto:null,openingNote:'',endNote:''});
    tx.create(retentionRef,{tripId,purgedAt:at,status:'PendingEvidence',jobCount:result.jobIds.length});
    tx.create(db.collection('dispatchAudit').doc(),{action:'Closed Dispatch delivery details removed after seven days',entityId:tripId,actorId:'system:retention',at,details:{policyDays:7,jobCount:result.jobIds.length,financialRecordsRetained:true}});
    return true;
   });
   if(removed)expired++;
  }
 }
 // Durable queue: a failed or interrupted image deletion is retried safely.
 const queue=await db.collection('dispatchRetention').where('status','==','PendingEvidence').limit(10).get();
 for(const task of queue.docs){
  const tripId=identifier(task.data().tripId);
  const evidence=await db.collection('dispatchEvidence').where('tripId','==',tripId).get();
  for(const manifest of evidence.docs){await db.recursiveDelete(manifest.ref);images++;}
  await task.ref.update({status:'Complete',evidenceDeletedAt:at});
 }
 return {expired,images};
}
export const cleanupClosedDispatch=onSchedule({schedule:'every 60 minutes',timeZone:'Asia/Kolkata',region:'asia-south1',timeoutSeconds:300,memory:'256MiB',maxInstances:1,retryCount:3},async()=>{logger.info('Dispatch retention completed',await expireClosedDispatchData());});
