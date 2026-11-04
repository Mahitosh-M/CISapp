import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const address=process.env.FIRESTORE_EMULATOR_HOST;
(address?describe:describe.skip)('Promotion audience Rules',()=>{
 let env:RulesTestEnvironment;
 const reward={name:'Reward',requiredPoints:20,levelRequired:'Active Partner',isActive:true};
 const offer={title:'Offer',imageUrl:'',startDate:'',endDate:'',isActive:true};
 beforeAll(async()=>{
  if(!/^127\.0\.0\.1:\d+$/.test(address!))throw Error('Loopback emulator required');
  const [host,port]=address!.split(':');
  env=await initializeTestEnvironment({projectId:'demo-promotion-audience',firestore:{host,port:Number(port),rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});
 },60000);
 beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await Promise.all([
    setDoc(doc(db,'users','admin'),{role:'Admin',active:true}),
    setDoc(doc(db,'users','staff'),{role:'Staff',active:true}),
    setDoc(doc(db,'users','customer'),{role:'customer',active:true,customerId:'regular'}),
    setDoc(doc(db,'users','medical'),{role:'Medical',active:true,customerId:'med'}),
    setDoc(doc(db,'customers','regular'),{name:'Regular'}),
    setDoc(doc(db,'customers','med'),{name:'Medical',customerType:'medical'}),
    ...['customer','medical','both'].map(customerAudience=>setDoc(doc(db,'rewardItems',customerAudience),{...reward,customerAudience})),
    setDoc(doc(db,'rewardItems','legacy'),reward)
   ]);
  });
 });
 afterAll(async()=>{await env?.cleanup();});
 const admin=()=>env.authenticatedContext('admin').firestore();
 it.each([['rewardItems',reward],['offers',offer]] as const)('validates audience for Admin creates and updates of %s',async(collection,payload)=>{
  for(const customerAudience of ['customer','medical','both']){
   const ref=doc(admin(),collection,'new-'+customerAudience);
   await assertSucceeds(setDoc(ref,{...payload,customerAudience}));
   await assertSucceeds(updateDoc(ref,{customerAudience:'both'}));
   for(const invalid of ['all','',null,1,['customer'],'x'.repeat(1000)]){
    await assertFails(updateDoc(ref,{customerAudience:invalid}));
    await assertFails(setDoc(doc(admin(),collection,'invalid'),{...payload,customerAudience:invalid}));
   }
  }
  await assertSucceeds(setDoc(doc(admin(),collection,'old'),payload));
  await assertSucceeds(updateDoc(doc(admin(),collection,'old'),{customerAudience:'medical'}));
 });
 it.each(['staff','customer','medical'])('denies %s catalogue creation and audience edits',async(uid)=>{
  const db=env.authenticatedContext(uid).firestore();
  await assertFails(setDoc(doc(db,'offers','forged'),{...offer,customerAudience:'both'}));
  await assertFails(updateDoc(doc(db,'rewardItems','medical'),{customerAudience:'both'}));
 });
 const request=(customerId:string,rewardId:string)=>({customerId,customerName:customerId,rewardId,rewardName:'Reward',points:20,status:'Pending',requestedAt:'2026-11-03T00:00:00Z'});
 it.each([['customer','regular'],['medical','med']])('allows %s requests only for its own audience, Both and legacy rewards',async(uid,customerId)=>{
  const db=env.authenticatedContext(uid).firestore();
  for(const target of ['customer','medical','both','legacy']){
   const write=setDoc(doc(db,'redemptionRequests',uid+'_'+target),request(customerId,target));
   if(target===uid||target==='both'||target==='legacy')await assertSucceeds(write);else await assertFails(write);
  }
  await assertFails(setDoc(doc(db,'redemptionRequests','forged-owner'),request(customerId==='med'?'regular':'med','both')));
  await assertFails(setDoc(doc(db,'redemptionRequests','forged-type'),{...request(customerId,'both'),customerAudience:'both'}));
 });
 it('rechecks the audience on a rejected-request retry and preserves approved history',async()=>{
  await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'redemptionRequests','retry'),{...request('regular','medical'),status:'Rejected'});
   await setDoc(doc(ctx.firestore(),'redemptionRequests','old-approved'),{...request('regular','legacy'),status:'Approved'});
  });
  const db=env.authenticatedContext('customer').firestore();
  await assertFails(updateDoc(doc(db,'redemptionRequests','retry'),{status:'Pending'}));
  await updateDoc(doc(admin(),'rewardItems','medical'),{customerAudience:'both'});
  await assertSucceeds(updateDoc(doc(db,'redemptionRequests','retry'),{status:'Pending'}));
  await updateDoc(doc(admin(),'rewardItems','legacy'),{customerAudience:'medical'});
  expect((await getDoc(doc(db,'redemptionRequests','old-approved'))).data()?.status).toBe('Approved');
 });
 it('denies unauthenticated catalogue writes and redemption requests',async()=>{
  const db=env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db,'offers','public'),{...offer,customerAudience:'both'}));
  await assertFails(setDoc(doc(db,'redemptionRequests','public'),request('regular','both')));
 });
});
