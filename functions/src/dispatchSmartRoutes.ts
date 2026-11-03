import {getFirestore,type Transaction} from 'firebase-admin/firestore';
import type {DispatchIdentity} from './dispatchAdmin';
import type {Command} from './dispatchDomain/commands';
import type {AppState,Trip} from './dispatchDomain/domain';
import {buildTripRoute,plannedArrival} from './dispatchDomain/smart-routing';
import {validateWeeklyRoute} from '../../src/utils/dispatchRoutes';
import {identifier,requireValue} from './dispatchCore';
import {settingsForDate,type RouteCostSettings} from './dispatchDomain/route-costs';
import {emptyState} from './dispatchDomain/emptyState';
import {deliveryLocation} from './dispatchDomain/route-geo';
import type {Data} from './dispatchCore';
/** Compatibility publishing uses the same confirmed-location and trusted-template gate. */
export async function prepareLegacyPublishedRoute(i:DispatchIdentity,value:Data,previous:Data|undefined,requests:Data[],tx:Transaction){
 const s=emptyState(),db=getFirestore();
 const customerIds=[...new Set((value.stops as Data[]).map(st=>st.customerId as string))];
 const customers=await Promise.all(customerIds.map(id=>tx.get(db.doc('customers/'+identifier(id)))));
 s.customers=customers.map(doc=>({id:doc.id,externalId:doc.id,name:String(doc.data()?.name??'Customer'),phone:String(doc.data()?.mobile??''),alternate:'',address:'',area:'',landmark:'',pin:'',instructions:'',active:true,location:deliveryLocation(doc.data()?.deliveryLocation)}));
 s.jobs=requests.map(r=>({id:r.id,invoiceId:r.id,customerId:r.sourceCustomerId,location:deliveryLocation(r.location),routeStopId:r.routeStopId,packages:r.packages,remaining:r.packages} as AppState['jobs'][number]));
 const trip={...value,routeTemplateId:value.routeTemplateId||undefined,routeSnapshot:previous?.routeSnapshot,amendmentNote:String(value.amendmentNote??'')} as Trip;
 const history=await tx.get(db.collection('dispatchTrips').where('vehicleId','==',value.vehicleId));
 s.trips=[trip,...history.docs.filter(d=>d.id!==value.id).map(d=>d.data() as Trip)];
 if(previous)requireValue(trip.amendmentNote?.trim(),'Released route changes need an amendment reason');
 await prepareSmartTrip(i,{type:'routeAction',id:trip.id,action:'Release',note:trip.amendmentNote??''},s,tx);
 value.routeSnapshot=buildTripRoute(s,trip,trip.routeSnapshot?.template??null,new Date().toISOString());
 value.routeCostSettingsId=trip.routeCostSettingsId;
 value.routeReferenceKm=value.routeSnapshot.template?.referenceKm??null;
 value.routeReferenceMinutes=value.routeSnapshot.template?.referenceMinutes??null;
 value.routeTargetArrival=value.routeSnapshot.template?.targetArrival??'17:00';value.routeDeparture=value.routeSnapshot.template?.departure??null;value.routePlannedArrival=plannedArrival(value.routeSnapshot);
 if(previous)value.pendingRouteAcknowledgements=[value.primaryDriverId,...(value.companionId?[value.companionId]:[])];
}
export async function prepareSmartTrip(i:DispatchIdentity,c:Command,s:AppState,tx:Transaction){
 if(c.type!=='saveTrip'&&!(c.type==='routeAction'&&c.action==='Release'))return;
 const trip=c.type==='saveTrip'?c.value:s.trips.find(t=>t.id===c.id)!;requireValue(trip,'Trip unavailable');const old=s.trips.find(t=>t.id===trip.id);
 const raw=trip.routeTemplateId?(await tx.get(getFirestore().doc(`dispatchRouteTemplates/${identifier(trip.routeTemplateId)}`))).data():null;
 if(trip.routeTemplateId)requireValue(raw?.active===true,'Route template is inactive; select an active plan');
 const template=raw?validateWeeklyRoute(raw):null;
 if(c.type==='saveTrip'&&trip.routeSnapshot?.template&&template)requireValue(trip.routeSnapshot.template.revision===template.revision,'Template changed while planning. Reopen and review the route.');
 if(c.type==='routeAction'&&old?.routeSnapshot?.template&&template)requireValue(old.routeSnapshot.template.revision===template.revision,'Template changed after this draft was saved. Review and save the draft before releasing.');
 if(template?.startShopId)requireValue(trip.startShopId===template.startShopId&&trip.endShopId===template.endShopId,'Trip shop endpoints must match the route template');
 trip.routeSnapshot={template,points:[],capturedAt:new Date().toISOString(),revision:old?.routeSnapshot?.revision??0};
 if(c.type==='routeAction'&&!trip.routeCostSettingsId){const settings=await tx.get(getFirestore().collection('dispatchRouteCostSettings'));trip.routeCostSettingsId=settingsForDate(settings.docs.map(d=>d.data() as RouteCostSettings),trip.date).id;}
 if(c.type==='saveTrip'&&old?.status==='Released'){
  requireValue(trip.amendmentNote?.trim(),'Released route changes need an amendment reason');trip.routeSnapshot=buildTripRoute(s,trip,template,new Date().toISOString());trip.pendingRouteAcknowledgements=[trip.primaryDriverId,...(trip.companionId?[trip.companionId]:[])];
 }
 // Daily physical continuity is reviewed, independently of invoice/accounting status.
 const previous=s.trips.filter(t=>t.id!==trip.id&&t.vehicleId===trip.vehicleId&&t.date<trip.date&&t.status!=='Cancelled').sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(previous&&previous.endShopId!==trip.startShopId)requireValue(!!trip.amendmentNote?.trim(),'Vehicle starts away from the previous destination. Record the relocation/continuity explanation.');
 const weekday=new Date(trip.date+'T00:00:00Z').getUTCDay();
 if([0,3].includes(weekday)&&!template?.days.includes(weekday))requireValue(i.role==='ADMIN'&&!!trip.amendmentNote?.trim(),'Admin must explain an exceptional trip on the scheduled vehicle rest day');
}
