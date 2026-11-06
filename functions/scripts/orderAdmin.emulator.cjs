const assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'../..');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')) throw Error('Local Firestore emulator required.');
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9197';
const {initializeTestEnvironment,assertSucceeds,assertFails}=require(root+'/node_modules/@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,serverTimestamp,Timestamp}=require(root+'/node_modules/firebase/firestore');
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-cis-category-images',firestore:{host:'127.0.0.1',port:Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]),rules:require('fs').readFileSync(root+'/firestore.rules','utf8')}});
 try {
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const [id,role,active] of [['admin','Admin',true],['staff','Staff',true],['customer','customer',true],['disabled','Admin',false]])await setDoc(doc(db,'users',id),{uid:id,role,active});});
 const good=()=>({category:'Test medicines',imageUrl:'data:image/jpeg;base64,YWJj',width:512,height:512,updatedAt:serverTimestamp()});
 const admin=env.authenticatedContext('admin').firestore();
 for(const id of [null,'staff','customer','disabled','unknown']) {
 const db=id?env.authenticatedContext(id).firestore():env.unauthenticatedContext().firestore();
 await assertFails(setDoc(doc(db,'orderCategoryImages/test'),good()));
 }
 const ref=doc(admin,'orderCategoryImages/test');
 await assertSucceeds(setDoc(ref,good()));
 await assertSucceeds(updateDoc(ref,{category:'Updated',updatedAt:serverTimestamp()}));
 for(const patch of [{category:''},{category:5},{category:'x'.repeat(161)},{imageUrl:'data:image/svg+xml;base64,YWJj'},{imageUrl:'javascript:alert(1)'},{imageUrl:'data:image/jpeg;base64,'+'A'.repeat(240000)},{extra:'pollution'},{updatedAt:Timestamp.fromMillis(0)}])await assertFails(setDoc(ref,{...good(),...patch}));
 for(const id of ['staff','customer','disabled'])await assertFails(deleteDoc(doc(env.authenticatedContext(id).firestore(),'orderCategoryImages/test')));
 const publicDb=env.unauthenticatedContext().firestore();
 await assertSucceeds(getDoc(doc(publicDb,'orderCategoryImages/test')));
 await assertSucceeds(getDocs(collection(publicDb,'orderCategoryImages')));
 await assertFails(getDocs(collection(publicDb,'users')));
 await assertSucceeds(deleteDoc(ref));
 const product=()=>({productId:'product-test',name:'Test product',imageUrl:'data:image/webp;base64,YWJj',width:512,height:512,updatedAt:serverTimestamp()});
 const pref=doc(admin,'orderProductImages/product-test');
 await assertSucceeds(setDoc(pref,product()));
 await assertSucceeds(updateDoc(pref,{name:'Updated product',updatedAt:serverTimestamp()}));
 for(const id of [null,'staff','customer','disabled','unknown']) {
  const db=id?env.authenticatedContext(id).firestore():publicDb;
  await assertFails(setDoc(doc(db,'orderProductImages/product-test'),product()));
  await assertFails(deleteDoc(doc(db,'orderProductImages/product-test')));
 }
 await assertSucceeds(getDoc(doc(publicDb,'orderProductImages/product-test')));
 await assertFails(getDocs(collection(publicDb,'orderProductImages')));
 for(const patch of [{productId:''},{name:5},{name:'x'.repeat(201)},{width:256},{height:256},{imageUrl:'data:image/jpeg;base64,YWJj'},{imageUrl:'data:image/webp;base64,'+'A'.repeat(240000)},{extra:true},{updatedAt:Timestamp.fromMillis(0)}])await assertFails(setDoc(pref,{...product(),...patch}));
 await assertSucceeds(deleteDoc(pref));
 const {initializeApp}=require('node:module').createRequire(root+'/functions/package.json')('firebase-admin/app');
 initializeApp({projectId:'demo-cis-category-images'});
 const {createOrderAdminSession}=require(root+'/functions/lib/functions/src/orderAdminSession.js');
 await assert.rejects(createOrderAdminSession.run({data:{}}),e=>e.code==='unauthenticated');
 for(const uid of ['staff','customer','disabled','unknown'])await assert.rejects(createOrderAdminSession.run({data:{},auth:{uid}}),e=>e.code==='permission-denied');
 await assert.rejects(createOrderAdminSession.run({data:{role:'Admin'},auth:{uid:'admin'}}),e=>e.code==='invalid-argument');
 const session=await createOrderAdminSession.run({data:{},auth:{uid:'admin'}});
 const payload=JSON.parse(Buffer.from(session.token.split('.')[1],'base64url'));
 assert.equal(payload.uid,'admin');assert.equal(payload.claims.orderappAdmin,true);
 console.log('Admin session backend checks passed, including Staff/Customer/disabled rejection and verified Admin token.');
 console.log('Category image security checks passed: admin create/update/delete, public artwork read, staff/customer/disabled denial, schema, size, timestamp and unsafe content.');
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
