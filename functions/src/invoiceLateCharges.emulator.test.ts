import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {registerInvoiceChargePolicy,postInvoiceLateCharges,reopenInvoiceChargeSchedule} from './invoiceLateCharges';
const enabled=!!process.env.FIRESTORE_EMULATOR_HOST;

test('late charges are atomic, compound only unpaid debt, and never duplicate cash or sales',{skip:!enabled},async()=>{
 const db=getFirestore(initializeApp({projectId:'demo-invoice-charges'},'charge-tests'));
 for(const name of ['invoices','payments','customers','invoiceLateCharges','shopCash','cashExpenses'])for(const d of (await db.collection(name).get()).docs)await d.ref.delete();
 await db.doc('customers/c').set({invoiceOutstandingAmount:500,totalOutstandingAmount:500});
 const base={customerId:'c',shopId:'SHOP_A',invoiceNumber:'INV-1',date:'2026-01-01',createdAt:'2026-01-01T06:00:00Z',totalSales:1000,totalProfit:100};
 await db.doc('invoices/i').set(base);
 await db.doc('payments/p1').set({invoiceId:'i',customerId:'c',date:'2026-01-20',amount:500,createdAt:'2026-01-20T06:00:00Z'});
 const policy={enabled:true,scope:'existing_from_invoice' as const,effectiveDate:'2026-01-31',revision:1};
 assert.equal(await registerInvoiceChargePolicy(db,'i',policy),true);
 assert.equal(await registerInvoiceChargePolicy(db,'i',policy),false);
 await Promise.all([postInvoiceLateCharges(db,'i','2026-01-31'),postInvoiceLateCharges(db,'i','2026-01-31'),postInvoiceLateCharges(db,'i','2026-01-31')]);
 assert.equal((await db.collection('invoiceLateCharges').get()).size,1);
 assert.equal((await db.doc('invoices/i').get()).data()?.lateChargesTotal,10);
 await db.doc('payments/p2').set({invoiceId:'i',customerId:'c',date:'2026-02-10',amount:300,createdAt:'2026-02-10T06:00:00Z'});
 await db.doc('customers/c').update({invoiceOutstandingAmount:210,totalOutstandingAmount:210});
 await postInvoiceLateCharges(db,'i','2026-02-15');
 const invoice=(await db.doc('invoices/i').get()).data()!;
 assert.equal(invoice.lateChargesTotal,12);assert.equal(invoice.totalSales,1000);assert.equal(invoice.totalProfit,100);
 assert.equal((await db.doc('customers/c').get()).data()?.totalOutstandingAmount,212);
 assert.equal((await db.collection('payments').get()).size,2);
 assert.equal((await db.collection('shopCash').get()).size,0);
 assert.equal((await db.collection('cashExpenses').get()).size,0);
 await db.doc('payments/p3').set({invoiceId:'i',customerId:'c',date:'2026-02-16',amount:212,createdAt:'2026-02-16T06:00:00Z'});
 await postInvoiceLateCharges(db,'i','2026-03-02');
 assert.equal((await db.doc('invoices/i').get()).data()?.nextLateChargeDate,null);
 assert.equal((await db.collection('invoiceLateCharges').get()).size,2);
 await db.doc('invoices/paid').set({...base,invoiceNumber:'PAID'});
 await db.doc('payments/paid').set({invoiceId:'paid',date:'2026-02-10',amount:1000});
 assert.equal(await registerInvoiceChargePolicy(db,'paid',policy),false,'Already settled history is excluded');
 await db.doc('invoices/opening').set({...base,invoiceNumber:'0000-OPENING-c',isOpeningBalance:true});
 assert.equal(await registerInvoiceChargePolicy(db,'opening',policy),false);
 await db.doc('invoices/new-only').set(base);
 assert.equal(await registerInvoiceChargePolicy(db,'new-only',{...policy,scope:'new_only'}),false);
 await db.doc('invoices/start-only').set(base);
 assert.equal(await registerInvoiceChargePolicy(db,'start-only',{...policy,scope:'existing_from_start',effectiveDate:'2026-03-01'}),true);
 assert.equal((await db.doc('invoices/start-only').get()).data()?.nextLateChargeDate,'2026-03-01');
});

test('December policy includes opening debt, protects younger invoices and keeps outstanding buckets separate',{skip:!enabled},async()=>{
 const db=getFirestore(initializeApp({projectId:'demo-december-charges'},'december-charge-tests'));
 for(const name of ['invoices','payments','customers','invoiceLateCharges','shopCash'])for(const d of (await db.collection(name).get()).docs)await d.ref.delete();
 const policy={enabled:true,scope:'existing_from_start' as const,effectiveDate:'2026-12-01',includeOpeningBalances:true,revision:1};
 await db.doc('customers/c').set({invoiceOutstandingAmount:2500,openingBalanceOutstandingAmount:500,totalOutstandingAmount:3000});
 const base={customerId:'c',shopId:'SHOP_A',invoiceNumber:'INV',date:'2026-10-01',createdAt:'2026-10-01T06:00:00Z',totalSales:1000,totalProfit:100};
 for(const id of ['old','opening','november','december','cleared']){
  await db.doc('invoices/'+id).set({...base,...(id==='opening'?{invoiceNumber:'0000-OPENING-c',isOpeningBalance:true,invoiceType:'opening_balance',date:'2026-11-20',totalProfit:0}:{}),...(id==='november'?{date:'2026-11-20'}:{}),...(id==='december'?{date:'2026-12-01'}:{})});
 }
 for(const id of ['old','opening'])await db.doc('payments/p-'+id).set({invoiceId:id,customerId:'c',date:'2026-11-30',amount:500});
 await db.doc('payments/cleared').set({invoiceId:'cleared',customerId:'c',date:'2026-11-30',amount:1000});
 assert.equal(await registerInvoiceChargePolicy(db,'cleared',policy),false);
 for(const id of ['old','opening','november','december'])assert.equal(await registerInvoiceChargePolicy(db,id,policy),true);
 assert.equal((await db.doc('invoices/november').get()).data()?.nextLateChargeDate,'2026-12-20');
 assert.equal((await db.doc('invoices/december').get()).data()?.nextLateChargeDate,'2026-12-31');
 for(const id of ['old','opening','november','december'])await postInvoiceLateCharges(db,id,'2026-11-30');
 assert.equal((await db.collection('invoiceLateCharges').get()).size,0,'No charges during the grace period');
 await Promise.all([postInvoiceLateCharges(db,'old','2026-12-01'),postInvoiceLateCharges(db,'opening','2026-12-01'),postInvoiceLateCharges(db,'opening','2026-12-01')]);
 assert.equal((await db.collection('invoiceLateCharges').get()).size,2,'Exactly one opening and one invoice assessment');
 const customer=(await db.doc('customers/c').get()).data()!;
 assert.equal(customer.invoiceOutstandingAmount,2510);assert.equal(customer.openingBalanceOutstandingAmount,510);assert.equal(customer.totalOutstandingAmount,3020);
 assert.equal((await db.doc('invoices/opening').get()).data()?.totalSales,1000,'Opening principal is not rewritten');
 await db.doc('payments/opening-partial').set({invoiceId:'opening',customerId:'c',date:'2026-12-10',amount:200});
 await db.doc('customers/c').update({openingBalanceOutstandingAmount:310,totalOutstandingAmount:2820});
 await postInvoiceLateCharges(db,'opening','2026-12-16');
 assert.equal((await db.doc('invoices/opening').get()).data()?.lateChargesTotal,13,'Next 1% uses remaining 310');
 assert.equal((await db.doc('customers/c').get()).data()?.openingBalanceOutstandingAmount,313);
 assert.equal((await db.collection('shopCash').get()).size,0,'Assessment does not create cash');
});


test('Medical invoices never enrol, assess or reopen while posted history is preserved',{skip:!enabled},async()=>{
 const db=getFirestore(initializeApp({projectId:'demo-medical-no-charges'},'medical-no-charges'));
 const policy={enabled:true,scope:'existing_from_start' as const,effectiveDate:'2026-12-01',includeOpeningBalances:true,revision:1};
 await db.doc('customers/med').set({customerType:'medical',invoiceOutstandingAmount:1020,totalOutstandingAmount:1020});
 await db.doc('customers/regular').set({customerType:'customer',invoiceOutstandingAmount:1000,totalOutstandingAmount:1000});
 const base={customerId:'med',invoiceNumber:'MED-1',date:'2026-10-01',createdAt:'2026-10-01',totalSales:1000,totalProfit:100};
 for(const extra of [{id:'ordinary'},{id:'opening',isOpeningBalance:true,invoiceNumber:'0000-OPENING-med'},{id:'new',createdAt:'2026-12-02'}]){
  const {id,...data}=extra;await db.doc('invoices/'+id).set({...base,...data});assert.equal(await registerInvoiceChargePolicy(db,id,policy),false);
  assert.equal((await db.doc('invoices/'+id).get()).data()?.lateChargePolicy,undefined);
 }
 const event={id:'old:0',date:'2026-10-31',index:0,rateBasisPoints:200,baseAmount:1000,amount:20,roundingPaise:0,createdAt:'2026-10-31'};
 await db.doc('invoices/old').set({...base,lateChargePolicy:{version:1,firstChargeDate:'2026-10-31',nextIndex:1},lateChargeEvents:[event],lateChargesTotal:20,nextLateChargeDate:'2026-11-15'});
 await db.doc('invoiceLateCharges/posted').set(event);
 const customerBefore=(await db.doc('customers/med').get()).data();
 await postInvoiceLateCharges(db,'old','2026-12-31');
 const after=(await db.doc('invoices/old').get()).data()!;
 assert.equal(after.nextLateChargeDate,null);assert.equal(after.lateChargesTotal,20);assert.deepEqual(after.lateChargeEvents,[event]);assert.deepEqual((await db.doc('customers/med').get()).data(),customerBefore);assert.equal((await db.collection('invoiceLateCharges').get()).size,1);
 await reopenInvoiceChargeSchedule(db,'old');assert.equal((await db.doc('invoices/old').get()).data()?.nextLateChargeDate,null);
 await db.doc('invoices/saved-medical').set({...base,customerId:'regular',medicalReward:{version:1}});assert.equal(await registerInvoiceChargePolicy(db,'saved-medical',policy),false,'A saved Medical invoice remains exempt after customer reclassification');
 await db.doc('invoices/regular').set({...base,customerId:'regular'});assert.equal(await registerInvoiceChargePolicy(db,'regular',policy),true);await postInvoiceLateCharges(db,'regular','2026-12-01');assert.equal((await db.doc('invoices/regular').get()).data()?.lateChargesTotal,20);
});
