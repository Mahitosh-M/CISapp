import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from './dispatchDomain/emptyState';
import { planDailyDelivery, dailyPlansFor, reorderDailyPlan } from './dispatchDailyRoutes';
import type { AppState } from './dispatchDomain/domain';
import type { CloudRequest, CloudSnapshot } from './dispatchDomain/syncMerge';
import type { DispatchIdentity } from './dispatchAdmin';
import type { WeeklyRoute } from '../../src/utils/dispatchRoutes';

const admin: DispatchIdentity = { uid:'admin',issuer:'cisapp-236ab',actorId:'admin',role:'ADMIN',shopIds:['SHOP_A','SHOP_S'],name:'Admin' };
const staff = (shop: string): DispatchIdentity => ({...admin,uid:shop,actorId:shop,role:'MANAGER',shopIds:[shop]});
const route: WeeklyRoute = {id:'weekly',name:'Weekly route',from:'Maski',to:'Sindhanur',startShopId:'SHOP_A',endShopId:'SHOP_S',shopIds:['SHOP_A','SHOP_S'],days:[1],active:true,status:'Active',revision:1,
  stops:[{id:'first',name:'First stop',shopId:'SHOP_A',lat:15.96,lng:76.65},{id:'last',name:'Last stop',shopId:'SHOP_S',lat:15.75,lng:76.75}]};
function input(id: string, shop = 'SHOP_A', day = '2026-11-09', selected = route) {
  const request: CloudRequest = {id,sourceInvoiceId:id,sourceCustomerId:'customer-'+id,invoiceNumber:id,customerName:id,shopId:shop,sourceRevision:1,scheduledDate:day,address:'Fixture address',contact:'0000000000',packages:2,instructions:'',active:true,tripId:null,routeId:selected.id,routeStopId:'first'};
  const cloud: CloudSnapshot = {identity:{...admin,issuer:'cisapp-236ab'},customers:[{id:request.sourceCustomerId,name:id,phone:'0000000000',area:'Fixture',invoices:[{id,number:id,date:'2026-11-06',due:'2026-11-30',amount:100000,outstanding:40000,shopId:shop,opening:false}]}],requests:[],trips:[],drivers:[],claims:[],serverAt:'2026-11-06T12:00:00Z'};
  return {request,cloud,selected};
}
function add(state: AppState, data: ReturnType<typeof input>) { return planDailyDelivery(state,data.request,data.selected,data.cloud,'2026-11-06T12:00:00Z'); }

test('new jobs create one unassigned daily draft per route/date, and repeated saves never duplicate stops',()=>{
 const s=emptyState(),a=input('a'),b=input('b','SHOP_S');
 const first=add(s,a),second=add(s,b);a.request.tripId=first.tripId;add(s,a);
 assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(s.trips.length,1);
 assert.equal(first.tripId,second.tripId);assert.equal(s.trips[0].stops.length,2);
 assert.equal(s.trips[0].status,'Draft');assert.equal(s.trips[0].vehicleId,'');assert.equal(s.trips[0].primaryDriverId,'');
 assert.deepEqual(s.trips[0].planningShopIds,['SHOP_A','SHOP_S']);
 assert.equal(s.jobs.find(job=>job.id==='cis-job:a')!.tripId,first.tripId);
 assert.equal(s.invoices[0].outstanding,40000);assert.equal(s.collections.length,0);
});

test('new route/date jobs are separated and draft rescheduling removes only the moved delivery',()=>{
 const s=emptyState(),a=input('a'),b=input('b');const first=add(s,a);add(s,b);
 a.request.tripId=first.tripId;a.request.scheduledDate='2026-11-16';const moved=add(s,a);
 assert.notEqual(first.tripId,moved.tripId);assert.equal(s.trips[0].stops.length,1);
 assert.equal(s.trips[0].stops[0].jobId,'cis-job:b');assert.equal(s.jobs.find(job=>job.id==='cis-job:a')!.date,'2026-11-16');
 const other=input('other','SHOP_A','2026-11-09',{...route,id:'other'});add(s,other);assert.equal(s.trips.length,3);
});

test('removing an automatic draft request cancels an empty draft without modifying other history',()=>{
 const s=emptyState(),a=input('a');const first=add(s,a);a.request.tripId=first.tripId;a.request.active=false;
 const removed=planDailyDelivery(s,a.request,null,a.cloud,'2026-11-06T12:05:00Z');
 assert.equal(removed.tripId,null);assert.equal(s.trips[0].status,'Cancelled');assert.equal(s.jobs[0].status,'Cancelled');assert.equal(s.trips[0].stops.length,0);
});

test('released trips remain unchanged while later jobs get a new daily draft',()=>{
 const s=emptyState(),a=input('a');const first=add(s,a);s.trips[0].status='Released';s.trips[0].vehicleId='van';s.trips[0].primaryDriverId='driver';
 const before=JSON.stringify(s.trips[0]);const next=add(s,input('b'));
 assert.notEqual(next.tripId,first.tripId);assert.equal(s.trips.length,2);assert.equal(JSON.stringify(s.trips[0]),before);
 a.request.tripId=first.tripId;assert.equal(add(s,a).tripId,first.tripId);assert.equal(JSON.stringify(s.trips[0]),before);
});

test('a full draft spills additional jobs to a new draft without exceeding 60 stops',()=>{
 const s=emptyState();for(let n=0;n<61;n++)add(s,input('invoice-'+n));
 assert.deepEqual(s.trips.map(trip=>trip.stops.length),[60,1]);assert.equal(new Set(s.jobs.map(job=>job.id)).size,61);
});

test('newly added stops follow saved waypoint order and existing assignments survive draft updates',()=>{
 const s=emptyState(),a=input('a'),b=input('b');a.request.routeStopId='last';add(s,a);add(s,b);
 assert.deepEqual(s.trips[0].stops.map(stop=>stop.jobId),['cis-job:b','cis-job:a']);
 s.trips[0].name='Reviewed plan';s.trips[0].vehicleId='van';s.trips[0].primaryDriverId='driver';
 a.request.tripId=s.trips[0].id;a.request.packages=4;a.selected={...route,revision:2};add(s,a);
 assert.equal(s.jobs.find(job=>job.id==='cis-job:a')!.remaining,4);assert.equal(s.trips[0].vehicleId,'van');assert.equal(s.trips[0].name,'Reviewed plan');assert.equal(s.trips[0].routeSnapshot?.template?.revision,2);
});

test('legacy published assignments are preserved even when absent from the operational state',()=>{
 const s=emptyState(),a=input('a');a.request.tripId='legacy-published';
 assert.equal(add(s,a).tripId,'legacy-published');assert.equal(s.trips.length,0);
});

test('Staff summaries and edits stay within their shop, preserving hidden deliveries and rejecting stale saves',()=>{
 const s=emptyState();add(s,input('a'));add(s,input('hidden','SHOP_S'));add(s,input('b'));
 const before=s.trips[0],staffA=staff('SHOP_A');const visible=dailyPlansFor(staffA,s);
 assert.deepEqual(visible[0].stops.map(stop=>stop.customerName),['a','b']);
 const [a,hidden,b]=before.stops;
 reorderDailyPlan(staffA,s,{id:before.id,revision:before.revision,stopIds:[b.id,a.id]});
 assert.deepEqual(before.stops.map(stop=>stop.id),[b.id,hidden.id,a.id]);
 assert.throws(()=>reorderDailyPlan(staffA,s,{id:before.id,revision:visible[0].revision,stopIds:[a.id,b.id]}),/changed/);
 assert.throws(()=>reorderDailyPlan(staffA,s,{id:before.id,revision:before.revision,stopIds:[hidden.id,a.id]}),/Permission/);
 assert.equal(dailyPlansFor(staff('unassigned'),s).length,0);
});

test('Admin can reorder both shops, while drivers, released routes, duplicate IDs and locked moves are rejected',()=>{
 const s=emptyState();add(s,input('a'));add(s,input('b','SHOP_S'));const trip=s.trips[0],ids=trip.stops.map(stop=>stop.id);
 reorderDailyPlan(admin,s,{id:trip.id,revision:trip.revision,stopIds:[...ids].reverse()});
 assert.equal(dailyPlansFor(admin,s)[0].stops.length,2);
 assert.throws(()=>reorderDailyPlan(admin,s,{id:trip.id,revision:trip.revision,stopIds:[ids[0],ids[0]]}),/valid/);
 trip.stops[0].locked=true;assert.throws(()=>reorderDailyPlan(admin,s,{id:trip.id,revision:trip.revision,stopIds:ids}),/Locked/);
 assert.throws(()=>dailyPlansFor({...staff('SHOP_A'),role:'DRIVER'},s),/Staff or Admin/);
 assert.throws(()=>reorderDailyPlan({...staff('SHOP_A'),role:'DRIVER'},s,{id:trip.id,revision:trip.revision,stopIds:ids}),/Permission/);
 trip.status='Released';assert.throws(()=>reorderDailyPlan(admin,s,{id:trip.id,revision:trip.revision,stopIds:ids}),/draft/);
});
