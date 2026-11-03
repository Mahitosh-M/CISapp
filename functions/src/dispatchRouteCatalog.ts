import {getFirestore} from 'firebase-admin/firestore';
import {allowed,type DispatchIdentity} from './dispatchAdmin';
import {identifier,requireValue,type Data} from './dispatchCore';
import {validateWeeklyRoute,type WeeklyRoute} from '../../src/utils/dispatchRoutes';
import {initialRouteTemplates} from '../../src/utils/dispatchRouteSeeds';
import {CONFIRMED_SHOPS,deliveryLocation} from '../../src/utils/route-geo';
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
  const codeRef=value.code?db.doc(`dispatchRouteCodes/${value.code}`):null;
  const oldCodeRef=previous?.code&&previous.code!==value.code?db.doc(`dispatchRouteCodes/${previous.code}`):null;
  const code=codeRef?await tx.get(codeRef):null,oldCode=oldCodeRef?await tx.get(oldCodeRef):null;
  requireValue(!code?.exists||code.data()?.routeId===value.id,'Route code already belongs to another route');
  const oldVersion=previous?.revision?db.doc(`dispatchRouteTemplateVersions/${value.id}__${previous.revision}`):null;
  const oldVersionDoc=oldVersion?await tx.get(oldVersion):null;
  const next={...value,revision:value.revision+1,updatedAt:new Date().toISOString(),updatedBy:i.actorId};
  if(oldVersion&&!oldVersionDoc?.exists)tx.create(oldVersion,{...previous,routeId:value.id});
  tx.create(db.doc(`dispatchRouteTemplateVersions/${value.id}__${next.revision}`),{...next,routeId:value.id});
  if(codeRef)tx.set(codeRef,{routeId:value.id});
  if(oldCodeRef&&oldCode?.data()?.routeId===value.id)tx.delete(oldCodeRef);
  tx.set(ref,next);
  tx.create(db.collection('dispatchAudit').doc(),{action:'Weekly route saved',entityId:value.id,actorId:i.actorId,uid:i.uid,issuer:i.issuer,at:next.updatedAt,details:{previous:previous??null,next}});
  return next;
 });
}

export async function routeHistory(i:DispatchIdentity,p:Data){
 requireValue(i.role!=='DRIVER','Staff access required');allowed(i,'viewOperations');
 const id=identifier(p.id),db=getFirestore(),route=(await db.doc(`dispatchRouteTemplates/${id}`).get()).data();
 requireValue(route&&(i.role==='ADMIN'||route.shopIds.some((s:string)=>i.shopIds.includes(s))),'Route is outside your shops');
 const versions=(await db.collection('dispatchRouteTemplateVersions').where('routeId','==',id).get()).docs.map(d=>d.data());
 return{versions:versions.sort((a,b)=>b.revision-a.revision)};
}
export async function seedWeeklyRoutes(i:DispatchIdentity,p:Data){
 requireValue(i.role==='ADMIN','Admin required');allowed(i,'manageSettings');
 requireValue(Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=5,'Select supplied draft routes');
 const templates=initialRouteTemplates();requireValue(p.ids.every((id:string)=>templates.some(r=>r.id===id)),'Unknown seed route');
 const results=[];for(const value of templates.filter(r=>p.ids.includes(r.id))){
  // Existing records and code reservations are never overwritten by seed retries.
  const existing=await getFirestore().doc(`dispatchRouteTemplates/${value.id}`).get();
  if(existing.exists){results.push({id:value.id,created:false});continue;}
  await saveWeeklyRoute(i,{value});results.push({id:value.id,created:true});
 }return{routes:results};
}
export async function confirmShopLocations(i:DispatchIdentity){
 requireValue(i.role==='ADMIN','Admin required');allowed(i,'manageSettings');const db=getFirestore();
 await db.runTransaction(async tx=>{
  const entries=await Promise.all(Object.entries(CONFIRMED_SHOPS).map(async([id,point])=>{const ref=db.doc(`dispatchMasterData/shops_${id}`),old=await tx.get(ref);return{id,point,ref,old};}));
  for(const {id,point,ref,old} of entries){const previous=old.data()?.value??{id,name:id==='SHOP_A'?'ASHOKA':'SMPA',town:id==='SHOP_A'?'Maski':'Sindhanur',address:'',phone:'',active:true};tx.set(ref,{kind:'shops',id,value:{...previous,...point},updatedAt:new Date().toISOString(),updatedBy:i.actorId});}
  tx.create(db.collection('dispatchAudit').doc(),{action:'Confirmed shop locations applied',actorId:i.actorId,at:new Date().toISOString(),details:CONFIRMED_SHOPS});
 });return{saved:true};
}

export async function invoiceDeliveryLocation(i:DispatchIdentity,p:Data){
 requireValue(i.role!=='DRIVER','Staff access required');allowed(i,'manageDispatch');
 const invoice=(await getFirestore().doc(`invoices/${identifier(p.invoiceId)}`).get()).data();
 requireValue(invoice&&(i.role==='ADMIN'||i.shopIds.includes(invoice.shopId)),'Invoice is outside your shops');
 const customer=(await getFirestore().doc(`customers/${identifier(invoice.customerId)}`).get()).data();
 return{customerId:invoice.customerId,location:customer?.deliveryLocation?deliveryLocation(customer.deliveryLocation):null};
}
export async function saveCustomerDeliveryLocation(i:DispatchIdentity,p:Data){
 requireValue(i.role==='ADMIN','Admin required to update the customer master location');allowed(i,'manageSettings');
 const location=deliveryLocation(p.location);requireValue(location?.confirmed,'Confirm the customer pin first');
 const db=getFirestore(),ref=db.doc(`customers/${identifier(p.customerId)}`);
 await db.runTransaction(async tx=>{const old=await tx.get(ref);requireValue(old.exists,'Customer no longer exists');tx.update(ref,{deliveryLocation:location,updatedAt:new Date().toISOString()});tx.create(db.collection('dispatchAudit').doc(),{action:'Customer delivery location updated',entityId:ref.id,actorId:i.actorId,at:new Date().toISOString(),details:{previous:old.data()?.deliveryLocation??null,next:location}});});return{saved:true};
}
