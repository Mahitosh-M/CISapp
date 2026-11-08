import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { executeCashExpense, executeCashTransfer } from './cashTransfers';
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;
test('cash transfers: Staff scope, private balances, exact-once retries, corrections and financial safety',{skip:!enabled},async()=>{
 assert.match(process.env.FIRESTORE_EMULATOR_HOST!,/^127[.]0[.]0[.]1:[0-9]+$/);
 const db=getFirestore(initializeApp({projectId:'demo-cash-transfer-backend'},'cash-transfer-test'));
 for(const c of ['users','shopCash','shopTransfers','cashAdjustments','cashTransferOperations'])
  for(const row of (await db.collection(c).get()).docs)await row.ref.delete();
 for(const [uid,role,shopId,active] of [['staff-a','Staff','SHOP_A',true],['staff-s','Staff','SHOP_S',true],['admin','Admin','SHOP_A',true],['customer','customer','SHOP_A',true],['medical','Medical','SHOP_A',true],['inactive','Staff','SHOP_A',false],['unassigned','Staff',null,true]] as const)
  await db.doc('users/'+uid).set({uid,role,shopId,active});
 for(const shopId of ['SHOP_A','SHOP_S'])
  await db.doc('shopCash/'+shopId).set({shopId,availableBalance:1000,totalCollections:1000,totalExpenses:0,totalTransferredIn:0,totalTransferredOut:0,openingBalance:0,initializedAt:FieldValue.serverTimestamp(),initializedBy:'admin',roundingDelta:0.2,roundingAuditId:'old-rounding',updatedAt:new Date().toISOString()});
 const create={action:'create',id:'transfer',fromShopId:'SHOP_A',toShopId:'SHOP_S',amount:100,note:'Fictional transfer'};
 const denied=(uid:string|undefined,input:unknown)=>assert.rejects(()=>executeCashTransfer(uid,input,db));
 for(const uid of [undefined,'customer','medical','inactive','unassigned','staff-s','unknown'])await denied(uid,create);
 await denied('staff-a',{...create,createdBy:'admin'});
 for(const amount of [0,-1,1.5,NaN,Infinity,100000001])await denied('staff-a',{...create,amount});
 await denied('staff-a',{...create,toShopId:'SHOP_A'});
 await denied('staff-a',{...create,id:'bad/id'});
 await denied('staff-a',{...create,note:'x'.repeat(161)});
 const results=await Promise.all([executeCashTransfer('staff-a',create,db),executeCashTransfer('staff-a',create,db),executeCashTransfer('staff-a',create,db)]);
 assert.equal(results.length,3);assert.equal((await db.collection('shopTransfers').get()).size,1);
 let sender=(await db.doc('shopCash/SHOP_A').get()).data()!,receiver=(await db.doc('shopCash/SHOP_S').get()).data()!;
 assert.equal(sender.availableBalance,900);assert.equal(receiver.availableBalance,1100);
 assert.equal(sender.roundingDelta,0);assert.equal(receiver.roundingAuditId,null);
 assert.equal(sender.totalTransferredOut,100);assert.equal(receiver.totalTransferredIn,100);
 assert.ok(results.every(r=>!('availableBalance' in r)&&!('receiverBalance' in r)),'Never return another shop balance');
 await denied('staff-a',{...create,amount:200});
 await denied('staff-s',{action:'update',id:'transfer',amount:150,note:'Forbidden'});
 const corrected=await executeCashTransfer('staff-a',{action:'update',id:'transfer',amount:150,note:'Corrected'},db);
 assert.equal(corrected.amount,150);
 await executeCashTransfer('staff-a',{action:'update',id:'transfer',amount:150,note:'Corrected'},db);
 assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.availableBalance,850);
 await executeCashTransfer('admin',{action:'update',id:'transfer',amount:50,note:'Admin correction'},db);
 assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.availableBalance,950);
 await denied('staff-a',{...create,id:'insufficient',amount:1000});
 assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.availableBalance,950);
 await denied('staff-a',{action:'delete',id:'transfer'});
 await executeCashTransfer('admin',{action:'delete',id:'transfer'},db);
 await executeCashTransfer('admin',{action:'delete',id:'transfer'},db);
 sender=(await db.doc('shopCash/SHOP_A').get()).data()!;receiver=(await db.doc('shopCash/SHOP_S').get()).data()!;
 assert.equal(sender.availableBalance,1000);assert.equal(receiver.availableBalance,1000);
 assert.equal(sender.totalTransferredOut,0);assert.equal(receiver.totalTransferredIn,0);
 await denied('staff-a',create);await denied('staff-s',{action:'delete',id:'transfer'});
 // A legacy fractional balance is corrected with a matching immutable rounding audit only when money moves.
 await db.doc('shopCash/SHOP_A').update({availableBalance:1000.25});
 await db.doc('shopCash/SHOP_S').update({availableBalance:1000.75});
 await executeCashTransfer('staff-a',{...create,id:'legacy'},db);
 sender=(await db.doc('shopCash/SHOP_A').get()).data()!;receiver=(await db.doc('shopCash/SHOP_S').get()).data()!;
 assert.equal(sender.availableBalance,900);assert.equal(sender.roundingDelta,-0.25);
 assert.equal(receiver.availableBalance,1101);assert.equal(receiver.roundingDelta,0.25);
 assert.equal((await db.doc('cashAdjustments/'+sender.roundingAuditId).get()).data()?.amount,0.25);
 assert.equal((await db.doc('cashAdjustments/'+receiver.roundingAuditId).get()).data()?.direction,'add');
 // Concurrent different transfers both debit from the latest balance.
 await Promise.all(['parallel-1','parallel-2'].map(id=>executeCashTransfer('staff-a',{...create,id,amount:10},db)));
 assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.availableBalance,880);
 assert.equal((await db.doc('shopCash/SHOP_S').get()).data()?.availableBalance,1121);
 assert.equal((await db.collection('payments').get()).size,0);
 assert.equal((await db.collection('invoices').get()).size,0);
});

test('cash expenses: active own-shop Staff only, bounded inputs and exactly-once debit',{skip:!enabled},async()=>{
 assert.match(process.env.FIRESTORE_EMULATOR_HOST!,/^127[.]0[.]0[.]1:[0-9]+$/);
 const db=getFirestore(initializeApp({projectId:'demo-cash-expense-backend'},'cash-expense-test'));
 for(const c of ['users','shopCash','cashExpenses','cashAdjustments'])for(const row of (await db.collection(c).get()).docs)await row.ref.delete();
 for(const [uid,role,shopId,active] of [['staff','Staff','SHOP_A',true],['other','Staff','SHOP_S',true],['customer','customer','SHOP_A',true],['medical','Medical','SHOP_A',true],['inactive','Staff','SHOP_A',false],['admin','Admin','SHOP_A',true]] as const)
  await db.doc('users/'+uid).set({uid,role,shopId,active});
 await db.doc('shopCash/SHOP_A').set({shopId:'SHOP_A',availableBalance:1000.25,totalCollections:1000,totalExpenses:0,initializedAt:FieldValue.serverTimestamp(),initializedBy:'admin',roundingDelta:0.2,roundingAuditId:'old',updatedAt:new Date().toISOString()});
 const expense={id:'expense',shopId:'SHOP_A',amount:100,category:'purchases',description:'Fictional purchase'};
 for(const uid of [undefined,'other','customer','medical','inactive','unknown'])await assert.rejects(()=>executeCashExpense(uid,expense,db));
 for(const change of [{amount:1.5},{amount:0},{amount:-1},{amount:100000001},{category:'invalid'},{description:''},{description:'x'.repeat(161)},{createdBy:'admin'},{shopId:'INVALID'}])
  await assert.rejects(()=>executeCashExpense('staff',{...expense,...change},db));
 await Promise.all([executeCashExpense('staff',expense,db),executeCashExpense('staff',expense,db),executeCashExpense('staff',expense,db)]);
 let summary=(await db.doc('shopCash/SHOP_A').get()).data()!;
 assert.equal(summary.availableBalance,900);assert.equal(summary.totalExpenses,100);assert.equal(summary.roundingDelta,-0.25);
 assert.equal((await db.collection('cashExpenses').get()).size,1);
 assert.equal((await db.doc('cashExpenses/expense').get()).data()?.createdBy,'staff');
 await assert.rejects(()=>executeCashExpense('staff',{...expense,amount:200},db));
 for(const category of ['emi','fuel','other'])await executeCashExpense('staff',{...expense,id:category,category,amount:10},db);
 await executeCashExpense('admin',{...expense,id:'admin',amount:10},db);
 summary=(await db.doc('shopCash/SHOP_A').get()).data()!;
 assert.equal(summary.availableBalance,860);assert.equal(summary.totalExpenses,140);assert.equal(summary.roundingDelta,0);
 assert.equal((await db.collection('payments').get()).size,0);
 assert.equal((await db.collection('invoices').get()).size,0);
});
