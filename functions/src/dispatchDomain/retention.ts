import type {AppState,Trip} from './domain';
import {cashSummary} from './rules';
export const DELIVERY_RETENTION_MS=7*24*60*60*1000;
export function closedTimestamp(s:AppState,t:Trip):string|undefined {
 if(t.closedAt&&Number.isFinite(Date.parse(t.closedAt)))return t.closedAt;
 return s.audit.filter(a=>a.entityId===t.id&&a.action==='Shift closed and odometer verified'&&Number.isFinite(Date.parse(a.at))).map(a=>a.at).sort().at(-1);
}
export function eligibleForRetention(s:AppState,t:Trip,at:string):boolean {
 const closed=closedTimestamp(s,t),time=Date.parse(closed??'');
 if(t.purgedAt||t.status!=='Closed'||!Number.isFinite(Date.parse(at))||!Number.isFinite(time)||Date.parse(at)-time<DELIVERY_RETENTION_MS)return false;
 if(!t.handoverConfirmed||!t.approvedOdometer||cashSummary(s,t).difference!==0)return false;
 if(s.collections.some(c=>c.tripId===t.id&&(c.status==='Pending'||c.status==='Approved'&&c.unallocated>0)))return false;
 if(s.fuels.some(f=>f.tripId===t.id&&(['Submitted','Clarification'].includes(f.status)||f.reimbursement==='Pending')))return false;
 if(s.jobs.some(j=>(j.tripId===t.id||t.stops.some(st=>st.jobId===j.id))&&(!['Delivered','Cancelled'].includes(j.status)||!j.returnsReconciled)))return false;
 return true;
}
export function tripEvidenceIds(s:AppState,tripIds:Set<string>):string[]{
 return [...new Set([
 ...s.trips.filter(t=>tripIds.has(t.id)).flatMap(t=>[t.openingPhoto,t.closingPhoto]),
 ...s.attempts.filter(a=>tripIds.has(a.tripId)).map(a=>a.evidenceId),
 ...s.collections.filter(c=>tripIds.has(c.tripId)).map(c=>c.evidenceId),
 ...s.fuels.filter(f=>tripIds.has(f.tripId)).map(f=>f.receiptId),
 ].filter((id):id is string=>!!id))];
}
/** Erase delivery detail; retain only accounting/reporting summaries and audit event metadata. */
export function expireDeliveryDetails(s:AppState,tripIds:Set<string>,at:string){
 const jobIds=new Set(s.jobs.filter(j=>!!j.tripId&&tripIds.has(j.tripId)).map(j=>j.id));
 const evidenceIds=tripEvidenceIds(s,tripIds);
 for(const job of s.jobs){const expiredPackages=s.attempts.filter(a=>a.jobId===job.id&&tripIds.has(a.tripId)).reduce((n,a)=>n+a.delivered,0);if(expiredPackages)job.deliveredPackages=(job.deliveredPackages??0)+expiredPackages;if(jobIds.has(job.id)){job.address='';job.phone='';job.description='';job.instructions='';job.purgedAt=at;}}
 s.attempts=s.attempts.filter(a=>!tripIds.has(a.tripId));
 for(const t of s.trips.filter(t=>tripIds.has(t.id))){t.purgedAt=at;t.stops=[];t.openingPhoto=null;t.closingPhoto=null;t.openingNote='';t.endNote='';}
 for(const c of s.collections.filter(c=>tripIds.has(c.tripId)))c.evidenceId=null;
 for(const f of s.fuels.filter(f=>tripIds.has(f.tripId)))f.receiptId='';
 for(const a of s.audit.filter(a=>a.entityType==='delivery'&&jobIds.has(a.entityId))){a.before='"Delivery detail removed after seven-day retention"';a.after='"Delivery detail removed after seven-day retention"';}
 return {jobIds:[...jobIds],evidenceIds};
}
