import {getFirestore} from 'firebase-admin/firestore';
import {allowed,type DispatchIdentity} from './dispatchAdmin';
import {identifier,requireValue,type Data} from './dispatchCore';
import {validateWeeklyRoute,type WeeklyRoute} from '../../src/utils/dispatchRoutes';
export async function routeCatalog(i:DispatchIdentity){
 requireValue(i.role!=='DRIVER','Staff access required');allowed(i,'viewOperations');
 const records=(await getFirestore().collection('dispatchRouteTemplates').get()).docs.map(d=>d.data() as WeeklyRoute);
 return {routes:records.filter(r=>i.role==='ADMIN'||r.shopIds.some(s=>i.shopIds.includes(s)))};
}
export async function saveWeeklyRoute(i:DispatchIdentity,p:Data){
 requireValue(i.role==='ADMIN','Admin required');allowed(i,'manageSettings');
 const value=validateWeeklyRoute(p.value),db=getFirestore(),ref=db.doc(`dispatchRouteTemplates/${identifier(value.id)}`);
 return db.runTransaction(async tx=>{
  const previous=(await tx.get(ref)).data();
  requireValue((previous?.revision??0)===value.revision,'Route changed elsewhere. Refresh and retry.');
  const next={...value,revision:value.revision+1,updatedAt:new Date().toISOString(),updatedBy:i.actorId};
  tx.set(ref,next);
  tx.create(db.collection('dispatchAudit').doc(),{action:'Weekly route saved',entityId:value.id,actorId:i.actorId,uid:i.uid,issuer:i.issuer,at:next.updatedAt,details:{previous:previous??null,next}});
  return next;
 });
}
