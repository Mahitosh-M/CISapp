import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,getApps} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {emptyState} from './dispatchDomain/emptyState';
import {expireClosedDispatchData} from './dispatchRetention';
function state(tripId='expired-trip'){
 const s=emptyState();s.trips.push({id:tripId,name:'Completed Dispatch trip',date:'2026-10-01',startShopId:'SHOP_A',endShopId:'SHOP_S',vehicleId:'van',primaryDriverId:'driver',companionId:null,status:'Closed',stops:[{id:'stop',kind:'Delivery',customerId:'customer',jobId:'job',completed:true}],opening:100,closing:110,openingPhoto:'proof',closingPhoto:'proof',openingNote:'Private operational note',endNote:'Done',openingAdvance:0,startedAt:'2026-10-01T01:00:00Z',endedAt:'2026-10-01T05:00:00Z',closedAt:'2026-10-01T06:00:00Z',loaded:true,returnConfirmed:true,approvedOdometer:true,cashReceived:0,handoverConfirmed:true,cashExplanation:'',exceptions:[],revision:8});
 s.jobs.push({id:'job',invoiceId:'invoice-ref',customerId:'customer',shopId:'SHOP_A',date:'2026-10-01',address:'Private delivery address',phone:'0000000000',packages:3,remaining:0,description:'Private package details',instructions:'Private directions',priority:'Normal',status:'Delivered',tripId,revision:1,createdAt:'2026-10-01T00:00:00Z',returnsReconciled:true});
 s.attempts.push({id:'attempt',jobId:'job',tripId,actorId:'driver',at:'2026-10-01T04:00:00Z',outcome:'Delivered',delivered:3,reason:'',note:'Private delivery note',evidenceId:'proof'});
 s.audit.push({id:'delivery-audit',entityId:'job',entityType:'delivery',action:'Delivered',actorId:'driver',at:'2026-10-01T04:00:00Z',before:'Private address',after:'Private contact'});
 return s;
}
test('Dispatch retention: exact seven-day cutoff, source CISapp isolation, image chunks and safe retries',{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
 assert.equal(process.env.GCLOUD_PROJECT,'demo-cis-dispatch');
 const app=getApps().find(a=>a.name==='retention-emulator')??initializeApp({projectId:'demo-cis-dispatch-retention'},'retention-emulator');const db=getFirestore(app);
 for(const c of ['dispatchOperationalState','dispatchTrips','dispatchRetention','dispatchEvidence','dispatchCollections','dispatchAudit'])for(const doc of (await db.collection(c).get()).docs)await db.recursiveDelete(doc.ref);
 const protectedDocs:Record<string,unknown>={
  'invoices/source-invoice':{totalSales:2000,deliveryRequired:true,deliveryDetails:{address:'Keep CISapp address',packages:3}},
  'customers/source-customer':{name:'Keep CISapp customer',mobile:'0000000000'},
  'payments/source-payment':{amount:2000,invoiceId:'source-invoice'},
  'dispatchDeliveryRequests/source-invoice':{address:'Keep CISapp delivery projection',active:true,tripId:'expired-trip'},
  'shopCash/SHOP_A':{amount:2000},'pcBalances/source-customer':{availablePc:25},
 };
 for(const [path,value]of Object.entries(protectedDocs))await db.doc(path).set(value as Record<string,unknown>);
 const s=state();await db.doc('dispatchOperationalState/main').set({state:s});await db.doc('dispatchTrips/expired-trip').set(s.trips[0]);
 for(const id of ['proof','fuel-photo','unlinked-trip-photo']){await db.doc('dispatchEvidence/'+id).set({tripId:'expired-trip',count:1});await db.doc('dispatchEvidence/'+id+'/chunks/0').set({value:'Private image bytes'});}
 assert.deepEqual(await expireClosedDispatchData('2026-10-08T05:59:59.999Z',db),{expired:0,images:0});
 assert.equal((await db.doc('dispatchEvidence/proof/chunks/0').get()).exists,true);
 assert.deepEqual(await expireClosedDispatchData('2026-10-08T06:00:00.000Z',db),{expired:1,images:3});
 const after=(await db.doc('dispatchOperationalState/main').get()).data()!.state;
 assert.equal(after.jobs[0].address,'');assert.equal(after.jobs[0].phone,'');assert.equal(after.jobs[0].deliveredPackages,3);assert.equal(after.attempts.length,0);assert.equal(after.trips[0].stops.length,0);assert.equal(after.trips[0].closing,110);assert.ok(after.audit[0].at);assert.doesNotMatch(after.audit[0].before,/Private/);
 assert.equal((await db.doc('dispatchEvidence/proof').get()).exists,false);assert.equal((await db.doc('dispatchEvidence/proof/chunks/0').get()).exists,false);
 for(const [path,value]of Object.entries(protectedDocs))assert.deepEqual((await db.doc(path).get()).data(),value,'CISapp data must remain unchanged: '+path);
 assert.deepEqual(await expireClosedDispatchData('2026-10-08T07:00:00Z',db),{expired:0,images:0});
 const task=(await db.collection('dispatchRetention').get()).docs[0];await task.ref.update({status:'PendingEvidence'});await db.doc('dispatchEvidence/interrupted').set({tripId:'expired-trip'});await db.doc('dispatchEvidence/interrupted/chunks/0').set({value:'Retry deletion'});
 assert.deepEqual(await expireClosedDispatchData('2026-10-08T08:00:00Z',db),{expired:0,images:1});assert.equal((await db.doc('dispatchEvidence/interrupted/chunks/0').get()).exists,false);
 const held=state('held-trip');await db.doc('dispatchOperationalState/main').set({state:held});await db.doc('dispatchCollections/pending').set({tripId:'held-trip',status:'Pending',amount:2000});assert.equal((await expireClosedDispatchData('2026-10-09T06:00:00Z',db)).expired,0);assert.equal((await db.doc('dispatchOperationalState/main').get()).data()!.state.jobs[0].address,'Private delivery address');
 const legacy=state('legacy-trip');delete legacy.trips[0].closedAt;await db.doc('dispatchOperationalState/main').set({state:legacy});await expireClosedDispatchData('2026-10-09T06:00:00Z',db);assert.equal((await db.doc('dispatchOperationalState/main').get()).data()!.state.trips[0].closedAt,'2026-10-09T06:00:00Z');
});
