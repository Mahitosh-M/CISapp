import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {prepareFuelCashPosting} from './dispatchFuelCash';
import {emptyState} from './dispatchDomain/emptyState';
import type {Fuel} from './dispatchDomain/domain';
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
test('Fuel CashApp posting: atomic, exactly once, funding-aware and no customer receipts',{skip:!enabled},async()=>{
 const db=getFirestore(initializeApp({projectId:'demo-dispatch-fuel'},'fuel-cash-tests'));
 for(const name of ['shopCash','cashExpenses','dispatchFuelPostings','dispatchAudit','payments'])
  for(const d of (await db.collection(name).get()).docs)await d.ref.delete();
 const s=emptyState();
 const actor={uid:'test-manager',actorId:'test-manager',issuer:'cisapp-236ab',role:'MANAGER' as const,shopIds:['SHOP_A'],name:'Fictional manager'};
 const base:Fuel={id:'fuel-1',tripId:'trip-1',vehicleId:'van-1',driverId:'driver-1',shopId:'SHOP_A',at:'2026-10-24T06:00:00Z',litres:10.25,rate:9599,amount:98390,pump:'',odometer:null,receiptId:'proof',source:'Shop advance',status:'Approved',reimbursement:'Not applicable',reviewNote:'',settledAt:null,fullTank:false};
 async function post(value:Fuel){return db.runTransaction(async tx=>{const f={...value};const plan=await prepareFuelCashPosting(tx,db,s,f,actor);plan?.commit();return f;});}
 await assert.rejects(()=>post(base),/Initialize this shop/);
 assert.equal((await db.collection('cashExpenses').get()).size,0);
 await db.doc('shopCash/SHOP_A').set({availableBalance:10000,totalExpenses:0,totalCollections:0,initializedAt:'2026-10-24'});
 const posted=await Promise.all([post(base),post(base),post(base)]);
 assert.equal(new Set(posted.map(f=>f.cashExpenseId)).size,1);
 assert.equal((await db.collection('cashExpenses').get()).size,1);
 assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.availableBalance,9016.1);
 assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.totalExpenses,983.9);
 const record=(await db.collection('cashExpenses').get()).docs[0].data();
 assert.equal(record.category,'fuel');assert.match(record.description,/Diesel/);
 assert.equal(record.amount,983.9);assert.equal(record.dispatchFuelId,base.id);
 const personal={...base,id:'personal',source:'Personal' as const,reimbursement:'Pending' as const};
 await post(personal);assert.equal((await db.collection('cashExpenses').get()).size,1,'Approval alone does not pay personal reimbursement');
 await post({...personal,reimbursement:'Settled'});await post({...personal,reimbursement:'Settled'});
 assert.equal((await db.collection('cashExpenses').get()).size,2);
 await post({...base,id:'rejected',status:'Rejected'});assert.equal((await db.collection('cashExpenses').get()).size,2);
 assert.equal((await db.collection('payments').get()).size,0,'Expenses never generate customer receipts');
 // An external correction/deletion must never cause automatic recreation/double deduction.
 await db.doc('cashExpenses/'+posted[0].cashExpenseId).delete();
 await assert.rejects(()=>post(base),/accounting review/);
 assert.equal(Math.round((await db.doc('shopCash/SHOP_A').get()).data()?.totalExpenses*100),196780);
});
