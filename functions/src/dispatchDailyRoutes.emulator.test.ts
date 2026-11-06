import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;

test('Automatic daily routes: atomic concurrent saves, next service dates, safe edits and unchanged financial records', { skip: !enabled }, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST!, /^(127\.0\.0\.1|localhost):/);
  if (!getApps().length) initializeApp({ projectId: 'demo-dispatch-daily' });
  const db = getFirestore();
  for (const collection of ['invoices','customers','payments','dispatchDeliveryRequests','dispatchOperationalState','dispatchRouteTemplates','dispatchAudit','dispatchMasterData','dispatchIdentities','dispatchTrips','dispatchVehicleLocks']) {
    for (const doc of (await db.collection(collection).get()).docs) await doc.ref.delete();
  }
  const { dispatchServiceForTests: api } = await import('./dispatchBridge');
  const { dailyRoutePlans, saveDailyRouteOrder } = await import('./dispatchDailyRoutes');
  const { scopedState, operation } = await import('./dispatchOperations');
  const admin = { uid:'daily-admin',issuer:'cisapp-236ab',actorId:'daily-admin',name:'Fixture Admin',role:'ADMIN' as const,shopIds:['SHOP_A','SHOP_S'] };
  const staff = { ...admin,uid:'daily-staff',actorId:'daily-staff',role:'MANAGER' as const,shopIds:['SHOP_A'] };
  const other = { ...staff,uid:'other-staff',actorId:'other-staff',shopIds:['SHOP_S'] };
  const weekly = { id:'weekly',name:'Monday route',from:'Maski',to:'Sindhanur',startShopId:'SHOP_A',endShopId:'SHOP_S',shopIds:['SHOP_A','SHOP_S'],stops:[{id:'a',name:'Maski',kind:'Shop',shopId:'SHOP_A',lat:15.96064,lng:76.65706},{id:'s',name:'Sindhanur',kind:'Shop',shopId:'SHOP_S',lat:15.7555,lng:76.75372}],days:[1],active:true,status:'Active',revision:1 };
  await db.doc('dispatchRouteTemplates/weekly').set(weekly);
  const source = { invoiceNumber:'Fixture',customerId:'customer',customerName:'Fixture Customer',shopId:'SHOP_A',date:'2026-11-06',dueDate:'2026-11-30',totalSales:1000,totalCost:600,totalProfit:400,salesAmount:1000,costAmount:600,transportAmount:0,createdAt:'2026-11-06T00:00:00Z',branchSystemVersion:1 };
  for (const id of ['a','b','c']) {
    await db.doc('customers/'+id).set({name:'Fixture '+id,mobile:'0000000000',area:'Fixture',deliveryLocation:{lat:15.9,lng:76.7,confirmed:true},advanceBalance:200});
    await db.doc('invoices/'+id).set({...source,invoiceNumber:id,customerId:id,shopId:id==='b'?'SHOP_S':'SHOP_A'});
  }
  const receipt = {invoiceId:'a',invoiceNumber:'a',customerId:'a',customerName:'Fixture a',date:'2026-11-06',amount:100,amountAppliedToInvoice:100,cashDiscount:0,createdAt:'2026-11-06T00:00:00Z'};
  await db.doc('payments/original').set(receipt);
  const customerBefore = (await db.doc('customers/a').get()).data();
  const invoiceBefore = (await db.doc('invoices/a').get()).data()!;
  const request = (invoiceId: string) => ({invoiceId,routeId:'weekly',routeStopId:'a',scheduledDate:'2026-11-06',packages:2,address:'Verified fixture address',contact:'0000000000'});
  const [first,second] = await Promise.all([api.markDelivery(staff,request('a')),api.markDelivery(other,request('b'))]);
  assert.equal(first.scheduledDate,'2026-11-09');assert.equal(second.scheduledDate,'2026-11-09');
  assert.equal(first.dailyRoute!.tripId,second.dailyRoute!.tripId);
  let state = (await db.doc('dispatchOperationalState/main').get()).data()!.state;
  assert.equal(state.trips.length,1);assert.equal(state.trips[0].status,'Draft');assert.equal(state.trips[0].stops.length,2);
  assert.equal((await db.collection('dispatchTrips').get()).size,0,'Draft must not be published to drivers');
  assert.equal((await db.doc('dispatchDeliveryRequests/a').get()).data()!.tripId,state.trips[0].id);
  assert.deepEqual((await db.doc('dispatchDeliveryRequests/a').get()).data()!.assignedDriverIds,[]);
  await api.markDelivery(staff,request('a'));await api.markDelivery(staff,request('c'));
  state = (await db.doc('dispatchOperationalState/main').get()).data()!.state;
  assert.equal(state.trips.length,1);assert.equal(state.trips[0].stops.length,3);
  const staffPlans = await dailyRoutePlans(staff);assert.equal(staffPlans.plans[0].stops.length,2);
  assert.equal(staffPlans.plans[0].stops.some(stop=>stop.customerId==='b'),false);
  assert.equal(scopedState(staff,state).trips.length,0,'Shared draft is edited through scoped CISapp controls, not exposed as a cross-shop operational trip');
  const plan=staffPlans.plans[0],hidden=state.trips[0].stops.find((stop:any)=>stop.customerId==='cis-customer:b');
  const hiddenIndex=state.trips[0].stops.indexOf(hidden);
  await saveDailyRouteOrder(staff,{id:plan.id,revision:plan.revision,stopIds:plan.stops.map(stop=>stop.id).reverse()});
  state = (await db.doc('dispatchOperationalState/main').get()).data()!.state;
  assert.equal(state.trips[0].stops[hiddenIndex].id,hidden.id);
  await assert.rejects(()=>saveDailyRouteOrder(staff,{id:plan.id,revision:plan.revision,stopIds:plan.stops.map(stop=>stop.id)}),/changed/);
  await assert.rejects(()=>saveDailyRouteOrder(staff,{id:plan.id,revision:state.trips[0].revision,stopIds:[hidden.id]}),/Permission/);
  await assert.rejects(()=>api.markDelivery(staff,request('b')),/Permission/);
  const beforeWrongAccess=JSON.stringify(state);
  assert.equal(JSON.stringify((await db.doc('dispatchOperationalState/main').get()).data()!.state),beforeWrongAccess);
  const moved=await api.markDelivery(staff,{...request('a'),scheduledDate:'2026-11-10'});
  assert.equal(moved.scheduledDate,'2026-11-16');assert.notEqual(moved.dailyRoute!.tripId,first.dailyRoute!.tripId);
  const removed=await api.markDelivery(staff,{invoiceId:'a',required:false});assert.equal(removed.dailyRoute!.tripId,null);
  assert.equal((await db.doc('dispatchDeliveryRequests/a').get()).data()!.tripId,null);
  const invoiceAfter=(await db.doc('invoices/a').get()).data()!;
  for(const key of ['totalSales','totalCost','totalProfit','salesAmount','costAmount','dueDate'])assert.equal(invoiceAfter[key],invoiceBefore[key]);
  assert.deepEqual((await db.doc('payments/original').get()).data(),receipt);
  assert.deepEqual((await db.doc('customers/a').get()).data(),customerBefore);
  // An Admin can finish planning without replacing the other shop's invoice or receipts.
  await db.doc('dispatchMasterData/vehicles_van').set({kind:'vehicles',id:'van',value:{id:'van',registration:'FIXTURE',active:true,baseline:0,expectedMileage:12,homeShopId:'SHOP_A'}});
  await db.doc('dispatchIdentities/driver').set({actorId:'driver',name:'Fixture Driver',role:'DRIVER',active:true,shopIds:['SHOP_A']});
  state=(await db.doc('dispatchOperationalState/main').get()).data()!.state;
  const draft=state.trips.find((trip:any)=>trip.id===first.dailyRoute!.tripId);
  const updated={...draft,vehicleId:'van',primaryDriverId:'driver',stops:draft.stops.filter((stop:any)=>stop.customerId!=='cis-customer:c')};
  const cloud=await api.pull(admin);
  await operation(admin,{id:'fixture-save-draft',actorId:admin.actorId,capturedAt:'2026-11-06T00:00:00Z',command:{type:'saveTrip',value:updated}},cloud);
  assert.equal((await db.doc('dispatchDeliveryRequests/c').get()).data()!.tripId,null,'Removing a draft stop must clear its source assignment');
  assert.equal((await db.doc('dispatchDeliveryRequests/b').get()).data()!.tripId,draft.id);
  await operation(admin,{id:'fixture-release',actorId:admin.actorId,capturedAt:'2026-11-06T00:00:00Z',command:{type:'routeAction',id:draft.id,action:'Release',note:'Vehicle and driver reviewed'}},await api.pull(admin));
  const released=(await db.doc('dispatchTrips/'+draft.id).get()).data()!;
  assert.equal(released.status,'Released');assert.equal(released.primaryDriverId,'driver');
  const driver={uid:'driver',issuer:'delivery-28165',actorId:'driver',name:'Fixture Driver',role:'DRIVER' as const,shopIds:['SHOP_A']};
  const driverCloud=await api.pull(driver);
  assert.equal(driverCloud.trips.length,1);assert.equal(driverCloud.requests.length,1);assert.equal(driverCloud.requests[0].id,'b');
  const releasedBefore=JSON.stringify(released);
  const late=await api.markDelivery(staff,request('c'));
  assert.notEqual(late.dailyRoute!.tripId,draft.id,'A released route must not receive automatic unreviewed stops');
  assert.equal(JSON.stringify((await db.doc('dispatchTrips/'+draft.id).get()).data()),releasedBefore);
  assert.equal((await api.pull(driver)).requests.some((row:any)=>row.sourceInvoiceId==='c'),false,'New drafts stay hidden from drivers until release');

});

