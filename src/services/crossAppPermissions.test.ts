import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
const address=process.env.FIRESTORE_EMULATOR_HOST;
(address?describe:describe.skip)('Cross-app active role and catalogue permission matrix',()=>{
 let env:RulesTestEnvironment;
 beforeAll(async()=>{if(!/^127[.]0[.]0[.]1:[0-9]+$/.test(address!))throw Error('Loopback emulator required');const [host,port]=address!.split(':');env=await initializeTestEnvironment({projectId:'demo-cross-app-permissions',firestore:{host,port:Number(port),rules:readFileSync('firestore.rules','utf8')}});},60000);
 beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.firestore();
   for(const [uid,role,active] of [['admin','Admin',true],['staff','Staff',true],['customer','customer',true],['medical','Medical',true],['inactive','Admin',false]] as const)
    await setDoc(doc(db,'users',uid),{uid,role,active,shopId:'SHOP_A',customerId:uid});
   for(const id of ['customer','medical','another']){
    await setDoc(doc(db,'customers',id),{name:id,customerType:id==='medical'?'medical':'customer'});
    await setDoc(doc(db,'invoices',id),{customerId:id,invoiceNumber:'Test',totalSales:100});
    await setDoc(doc(db,'payments',id),{customerId:id,invoiceId:id,amount:20});
   }
   await setDoc(doc(db,'offers','active'),{isActive:true,title:'Public active offer'});
   await setDoc(doc(db,'offers','inactive'),{isActive:false,title:'Hidden offer'});
   await setDoc(doc(db,'rewardItems','active'),{isActive:true,name:'Public active reward'});
   await setDoc(doc(db,'rewardItems','inactive'),{isActive:false,name:'Hidden reward'});
  });
 });
 afterAll(async()=>{await env?.cleanup();});
 it.each(['customer','medical'])('allows %s own invoice/payment queries and active offers/rewards',async uid=>{
  const db=env.authenticatedContext(uid).firestore();
  for(const name of ['invoices','payments']){
   await assertSucceeds(getDocs(query(collection(db,name),where('customerId','==',uid))));
   await assertFails(getDoc(doc(db,name,'another')));
   await assertFails(getDocs(collection(db,name)));
  }
  for(const name of ['offers','rewardItems']){
   await assertSucceeds(getDocs(query(collection(db,name),where('isActive','==',true))));
   await assertFails(getDoc(doc(db,name,'inactive')));
  }
 });
 const image=(product:boolean)=>({...product?{productId:'product',name:'Product'}:{category:'Category'},imageUrl:'data:image/'+(product?'webp':'jpeg')+';base64,AA==',width:512,height:512,updatedAt:serverTimestamp()});
 it.each([false,true])('allows verified active Admin image create/update/reset (product %s)',async product=>{
  const db=env.authenticatedContext('admin',{orderappAdmin:true}).firestore(),name=product?'orderProductImages':'orderCategoryImages',ref=doc(db,name,'image');
  await assertSucceeds(setDoc(ref,image(product)));
  await assertSucceeds(setDoc(ref,image(product)));
  await assertFails(setDoc(ref,{...image(product),width:1024}));
  await assertFails(setDoc(ref,{...image(product),imageUrl:'javascript:alert(1)'}));
  await assertSucceeds(deleteDoc(ref));
 });
 it.each(['staff','customer','medical','inactive'])('denies %s image administration even with forged client admin claims',async uid=>{
  const db=env.authenticatedContext(uid,{admin:true,orderappAdmin:true}).firestore();
  for(const product of [false,true])await assertFails(setDoc(doc(db,product?'orderProductImages':'orderCategoryImages','forged'),image(product)));
 });
 it('keeps catalogue artwork readable without exposing cash or transfer operation documents',async()=>{
  const db=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDocs(collection(db,'orderCategoryImages')));
  await assertSucceeds(getDoc(doc(db,'orderProductImages','product')));
  for(const name of ['shopCash','cashExpenses','cashTransferOperations','dispatchOperationalState'])
   await assertFails(getDoc(doc(db,name,'private')));
 });
});
