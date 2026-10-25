import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
const manager = {
  uid: "manager-a",
  issuer: "cisapp-236ab",
  actorId: "manager-a",
  role: "MANAGER" as const,
  shopIds: ["SHOP_A"],
  name: "Fictional manager",
};
const driver = {
  uid: "driver-a",
  issuer: "delivery-28165",
  actorId: "driver-a",
  role: "DRIVER" as const,
  shopIds: ["SHOP_A"],
  name: "Fictional driver",
};
test(
  "Dispatch emulator: scoped projections, concurrent idempotent posting, external payment and review safety",
  { skip: !enabled },
  async () => {
    assert.equal(process.env.GCLOUD_PROJECT, "demo-cis-dispatch");
    if (!getApps().length) initializeApp({ projectId: "demo-cis-dispatch" });
    const db = getFirestore();
    const { dispatchServiceForTests: api } = await import("./dispatchBridge");
    const collections = [
      "users",
      "customers",
      "invoices",
      "payments",
      "dispatchDeliveryRequests",
      "dispatchIdentities",
      "dispatchTrips",
      "dispatchVehicleLocks",
      "dispatchCollections",
      "dispatchApprovals",
      "dispatchAudit",
      "shopCash",
      "cashExpenses",
      "dispatchFuelPostings",
      "customerMonthlySnapshots",
      "businessMonthlySnapshots",
      "pcBalances",
      "loyaltyLedger",
      "dispatchPostingTasks",
      "dispatchOperationalState",
      "dispatchOperations",
      "dispatchMasterData",
      "dispatchRoles",
      "dispatchConfiguration",
    ];
    for (const c of collections)
      for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
    await db
      .doc("customers/customer-a")
      .set({
        name: "Fictional pharmacy",
        mobile: "0000000000",
        area: "Unverified area",
        tier: "Tier 4",
        previousOutstandingAmount: 0,
        advanceBalance: 200,
        totalOutstandingAmount: 2500,
        invoiceOutstandingAmount: 2000,
        openingBalanceOutstandingAmount: 500,
      });
    const source = {
      customerId: "customer-a",
      customerName: "Fictional pharmacy",
      date: "2026-10-19",
      dueDate: "2026-10-19",
      salesAmount: 2000,
      totalSales: 2000,
      costAmount: 1000,
      totalCost: 1000,
      totalProfit: 1000,
      shopId: "SHOP_A",
      branchSystemVersion: 1,
      invoiceNumber: "A-001",
      createdAt: "2026-10-19T06:00:00Z",
    };
    await db.doc("invoices/invoice-a").set(source);
    await db
      .doc("invoices/opening-a")
      .set({
        ...source,
        invoiceNumber: "0000-OPENING-test",
        date: "2026-10-19",
        totalSales: 500,
        isOpeningBalance: true,
      });
    const details = {
      invoiceId: "invoice-a",
      scheduledDate: "2026-10-19",
      address: "Verified fictional delivery location",
      contact: "0000000000",
      packages: 2,
    };
    await api.markDelivery(manager, details);
    await api.markDelivery(manager, details);
    assert.equal(
      (await db.collection("dispatchDeliveryRequests").get()).size,
      1,
    );
    await assert.rejects(
      () => api.markDelivery(manager, { ...details, invoiceId: "opening-a" }),
      /Opening/,
    );
    await assert.rejects(() => api.markDelivery(driver, details), /Permission/);
    await db
      .doc("dispatchIdentities/fictional-driver")
      .set({
        active: true,
        actorId: "driver-a",
        role: "DRIVER",
        shopIds: ["SHOP_A"],
        name: "Fictional driver",
      });
    await api.publishTrip(manager, {
      id: "trip-a",
      name: "Fictional route",
      date: "2026-10-19",
      startShopId: "SHOP_A",
      endShopId: "SHOP_S",
      vehicleId: "van-a",
      primaryDriverId: "driver-a",
      companionId: null,
      status: "Released",
      openingAdvance: 10000,
      stops: [
        {
          id: "stop-a",
          kind: "Delivery",
          customerId: "customer-a",
          jobId: "invoice-a",
        },
      ],
    });
    await assert.rejects(
      () =>
        api.publishTrip(manager, {
          id: "overlap",
          name: "Other route",
          date: "2026-10-19",
          startShopId: "SHOP_A",
          endShopId: "SHOP_S",
          vehicleId: "van-a",
          primaryDriverId: "driver-a",
          status: "Released",
          openingAdvance: 0,
          stops: [
            {
              id: "stop-a",
              kind: "Delivery",
              customerId: "customer-a",
              jobId: "invoice-a",
            },
          ],
        }),
      /Vehicle/,
    );
    const pulled = await api.pull(driver);
    const raw = JSON.stringify(pulled);
    assert.ok(
      !raw.includes("costAmount") &&
        !raw.includes("totalProfit") &&
        !raw.includes("advanceBalance"),
    );
    assert.equal(pulled.requests.length, 1);
    await api.markDelivery(manager, details);
    assert.equal((await api.pull(driver)).requests.length, 1, "editing delivery details must preserve authorised driver assignments");
    assert.equal(
      (await api.pull({ ...driver, actorId: "unassigned" })).requests.length,
      0,
    );
    const routeBase = {id:'trip-a',name:'Revised route',date:'2026-10-19',startShopId:'SHOP_A',endShopId:'SHOP_S',vehicleId:'van-a',primaryDriverId:'driver-a',status:'Released',openingAdvance:10000};
    await api.publishTrip(manager,{...routeBase,stops:[{id:'visit-a',kind:'Collection',customerId:'customer-a',jobId:null}]});
    assert.equal((await db.doc('dispatchDeliveryRequests/invoice-a').get()).data()?.tripId,null,'removing a released stop must release its assignment');
    await api.publishTrip(manager,{...routeBase,stops:[{id:'stop-a',kind:'Delivery',customerId:'customer-a',jobId:'invoice-a'}]});
    const cash = {
      tripId: "trip-a",
      customerId: "customer-a",
      submissionId: "submission-a",
      localId: "local-a",
      mode: "Cash",
      amount: 200000,
      reference: "",
      note: "Fictional collection",
      collectedAt: "2026-10-19T07:00:00Z",
    };
    const submitted = await api.submitCollection(driver, cash);
    assert.equal((await api.submitCollection(driver, cash)).id, submitted.id);
    await assert.rejects(
      () => api.submitCollection(driver, { ...cash, amount: 100 }),
      /different details/,
    );
    await assert.rejects(
      () => api.submitCollection({ ...driver, actorId: "unassigned" }, cash),
      /assigned/,
    );
    await assert.rejects(
      () =>
        api.approveCollection(driver, {
          id: submitted.id,
          approvalId: "approve-a",
          note: "Verified cash",
          date: "2026-10-19",
        }),
      /Permission/,
    );
    // An external receipt arrives after dispatch was downloaded.
    await db
      .doc("payments/external")
      .set({
        invoiceId: "invoice-a",
        customerId: "customer-a",
        amount: 1000,
        amountAppliedToInvoice: 1000,
        cashDiscount: 0,
        date: "2026-10-19",
        createdAt: "2026-10-19T06:30:00Z",
      });
    await db
      .doc("customers/customer-a")
      .update({ totalOutstandingAmount: 1500, invoiceOutstandingAmount: 1000 });
    const approval = {
      id: submitted.id,
      approvalId: "approve-a",
      note: "Physical cash independently verified",
      date: "2026-10-19",
    };
    const [first, retry] = await Promise.all([
      api.approveCollection(manager, approval),
      api.approveCollection(manager, approval),
    ]);
    assert.ok(first);
    assert.deepEqual(first, retry);
    assert.equal(first.postedAmount, 150000);
    assert.equal(first.unallocated, 50000);
    assert.equal(first.receiptIds.length, 2);
    assert.equal((await db.collection("payments").get()).size, 3);
    const customer = (await db.doc("customers/customer-a").get()).data()!;
    assert.equal(customer.totalOutstandingAmount, 0);
    assert.equal(customer.advanceBalance, 200);
    const funds = (await db.doc("shopCash/SHOP_A").get()).data()!;
    assert.equal(funds.availableBalance, 1500);
    assert.equal(funds.totalCollections, 1500);
    assert.equal(
      (await db.doc("businessMonthlySnapshots/2026-10").get()).data()
        ?.paymentsReceived,
      1500,
    );
    await assert.rejects(
      () =>
        api.approveCollection(manager, {
          ...approval,
          approvalId: "different",
        }),
      /already/,
    );
    const upi = await api.submitCollection(driver, {
      ...cash,
      submissionId: "upi",
      localId: "upi",
      mode: "UPI",
      amount: 100,
      reference: "Fictional-independent-bank-reference",
    });
    await assert.rejects(
      () =>
        api.approveCollection(manager, {
          ...approval,
          id: upi.id,
          approvalId: "upi-approve",
        }),
      /independent/,
    );
    const credit = await api.submitCollection(driver, {
      ...cash,
      submissionId: "credit",
      localId: "credit",
      mode: "Credit",
      amount: 0,
    });
    const credited = await api.approveCollection(manager, {
      ...approval,
      id: credit.id,
      approvalId: "credit-approve",
    });
    assert.ok(credited);
    assert.equal(credited.status, "Credit authorised");
    assert.equal(credited.receiptIds.length, 0);
    assert.equal((await db.collection("payments").get()).size, 3);
    await assert.rejects(
      () =>
        api.approveCollection(
          { ...manager, shopIds: ["SHOP_S"] },
          { ...approval, id: upi.id },
        ),
      /Permission/,
    );
    await api.approveCollection(manager, {
      ...approval,
      id: upi.id,
      approvalId: "upi-reject",
      reject: true,
      note: "Not verified",
    });
    await assert.rejects(
      () => api.closeRouteAssignment(driver, { id: "trip-a" }),
      /Permission/,
    );
    await api.closeRouteAssignment(manager, {
      id: "trip-a",
      note: "Reviewed original local evidence and settlements",
      reviewedLocalEvidence: true,
      opening: 25000,
      closing: 25040,
    });
    assert.equal(
      (await db.doc("dispatchVehicleLocks/van-a").get()).exists,
      false,
    );
    assert.equal(
      (await db.doc("dispatchTrips/trip-a").get()).data()?.closureReview
        .approvedDistance,
      40,
    );
    await db.doc(`payments/${first.receiptIds[0]}`).delete();
    const corrected = await api.pull(manager);
    assert.match(
      String(
        corrected.claims.find((c: any) => c.id === submitted.id)?.sourceIssue,
      ),
      /edited, moved or deleted/,
    );
    assert.deepEqual(await api.approveCollection(manager, approval), first);
    assert.equal((await db.collection("payments").get()).size, 2);
    // Reuse the released vehicle and verify source PC and medical-credit helpers.
    await db.doc('customers/customer-b').set({name:'Fictional medical shop',mobile:'0000000000',area:'Area',tier:'Tier 4',customerType:'medical',previousOutstandingAmount:0,advanceBalance:0,totalOutstandingAmount:1000,invoiceOutstandingAmount:1000,openingBalanceOutstandingAmount:0});
    await db.doc('invoices/invoice-b').set({...source,customerId:'customer-b',invoiceNumber:'A-002',salesAmount:1000,totalSales:1000,costAmount:500,totalCost:500,totalProfit:500,pcPolicyVersionAtInvoice:1,pcPercentageAtInvoice:5,creditDaysAtInvoice:15,bufferDaysAtInvoice:2,savedDueDate:'2026-11-03',dueDate:'2026-11-03',finalPcCutoffDate:'2026-11-05'});
    await api.markDelivery(manager,{...details,invoiceId:'invoice-b'});
    await api.publishTrip(manager,{id:'trip-b',name:'Next route',date:'2026-10-19',startShopId:'SHOP_A',endShopId:'SHOP_S',vehicleId:'van-a',primaryDriverId:'driver-a',status:'Released',openingAdvance:0,stops:[{id:'stop-b',kind:'Delivery',customerId:'customer-b',jobId:'invoice-b'}]});
    const second=await api.submitCollection(driver,{...cash,tripId:'trip-b',customerId:'customer-b',submissionId:'payment-b',localId:'payment-b',amount:100000});
    await api.approveCollection(manager,{...approval,id:second.id,approvalId:'approve-b'});
    await api.approveCollection(manager,{...approval,id:second.id,approvalId:'approve-b'});
    assert.equal((await db.doc('loyaltyLedger/customer-b_invoice-b_invoice_pc').get()).data()?.points,25);
    assert.equal((await db.doc('pcBalances/customer-b').get()).data()?.availablePc,25);
    const { refreshDispatchCustomer } = await import('./dispatchBridge');
    await refreshDispatchCustomer.run({params:{id:second.id}} as any);
    await refreshDispatchCustomer.run({params:{id:second.id}} as any);
    assert.equal((await db.doc('customerCreditSummaries/customer-b').get()).data()?.creditDays,15);
    assert.equal((await db.doc('dispatchPostingTasks/'+second.id).get()).data()?.status,'Complete');
    assert.equal((await db.doc('businessMonthlySnapshots/2026-10').get()).data()?.paymentsReceived,2500);
    assert.equal((await db.doc('pcBalances/customer-b').get()).data()?.availablePc,25);

    // Connected persistence: no client-side authority for operational or financial records.
    const admin={...manager,uid:'admin-test',actorId:'admin-test',role:'ADMIN' as const,shopIds:['SHOP_A','SHOP_S']};
    const ops=await import('./dispatchOperations');const adm=await import('./dispatchAdmin');
    const {stableId:identityKey}=await import('./dispatchCore');await db.doc('dispatchIdentities/'+identityKey('identity','delivery-28165:one-shop-admin')).set({active:true,role:'ADMIN',roleId:'ADMIN',actorId:'one-shop-admin',name:'Test Admin',shopIds:['SHOP_A']});assert.deepEqual((await adm.resolveAccount('delivery-28165','one-shop-admin')).shopIds,['SHOP_A','SHOP_S']);
    await adm.saveRole(admin,{id:'limited-driver',name:'Delivery only',baseRole:'DRIVER',permissions:['viewOperations','recordDeliveries'],active:true});
    await assert.rejects(()=>adm.saveRole(admin,{id:'unsafe',name:'Escalation',baseRole:'DRIVER',permissions:['viewOperations','manageUsers']}),/exceed/);
    await assert.rejects(()=>adm.saveMaster(driver,{kind:'vehicles',id:'van-live',value:{}}),/Admin/);
    await adm.saveMaster(admin,{kind:'vehicles',id:'van-live',value:{registration:'TEST-ONLY',type:'Van',fuelType:'Diesel',baseline:100,expectedMileage:15,homeShopId:'SHOP_A',active:true}});
    await db.doc('invoices/invoice-c').set({...source,invoiceNumber:'A-003'});
    await db.doc('dispatchRouteTemplates/integration-route').set({id:'integration-route',name:'Route 1',from:'A',to:'B',shopIds:['SHOP_A'],stops:[{id:'integration-stop',name:'Middle road'}],days:[1],active:true,revision:1});
    await api.markDelivery(manager,{...details,invoiceId:'invoice-c',routeId:'integration-route',routeStopId:'integration-stop'});
    let seq=0;
    async function command(who:any,c:any,id='live-op-'+(++seq)){return ops.operation(who,{id,actorId:who.actorId,command:c},await api.pull(who));}
    const t={routeTemplateId:'integration-route',id:'trip-live',name:'Connected route',date:'2026-10-19',startShopId:'SHOP_A',endShopId:'SHOP_S',vehicleId:'van-live',primaryDriverId:'driver-a',companionId:null,openingAdvance:0,revision:0,stops:[{id:'live-stop',customerId:'cis-customer:customer-a',jobId:'cis-job:invoice-c',kind:'Delivery',completed:true}],status:'Closed',closing:9999,cashReceived:999999,approvedOdometer:true};
    await assert.rejects(()=>command(manager,{type:'saveTrip',value:{...t,routeTemplateId:'missing-template'}}),/Weekly route/);
    await command(manager,{type:'saveTrip',value:t});
    let stored=(await db.doc('dispatchOperationalState/main').get()).data()!.state;
    assert.equal(stored.trips.find((x:any)=>x.id===t.id).routeTemplateId,'integration-route');
    assert.equal(stored.jobs.find((x:any)=>x.id==='cis-job:invoice-c').routeStopName,'Middle road');
    assert.equal(stored.trips.find((x:any)=>x.id===t.id).status,'Draft');
    assert.equal(stored.trips.find((x:any)=>x.id===t.id).closing,null);
    assert.equal(stored.trips.find((x:any)=>x.id===t.id).stops[0].completed,false);
    await assert.rejects(()=>command({...manager,uid:'destination-manager',actorId:'destination-manager',shopIds:['SHOP_S']},{type:'routeAction',id:t.id,action:'Release',note:'Wrong departure shop'}),/Manager access/);
    await command(manager,{type:'routeAction',id:t.id,action:'Release',note:'Release verified route'});
    const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=';
    await assert.rejects(()=>ops.putEvidence({...driver,actorId:'unassigned'},{id:'bad',tripId:t.id,dataUrl:pixel}),/assigned/);
    await ops.putEvidence(driver,{id:'live-proof',tripId:t.id,dataUrl:pixel,name:'Test evidence'});
    assert.equal((await ops.getEvidence(driver,{id:'live-proof'})).dataUrl,pixel);
    await command(driver,{type:'startTrip',id:t.id,opening:100,photo:'live-proof',note:''});
    await command(driver,{type:'load',id:t.id});
    await command(driver,{type:'delivery',id:'cis-job:invoice-c',outcome:'Delivered',delivered:2,reason:'',note:'Acknowledged',evidenceId:'live-proof'});
    await command(driver,{type:'submitCollection',value:{id:'live-cash',submissionId:'live-cash',tripId:t.id,customerId:'cis-customer:customer-a',shopId:'SHOP_A',driverId:'driver-a',invoiceIds:['cis-invoice:invoice-c'],amount:200000,mode:'Cash',reference:'',note:'Counted cash',evidenceId:null,createdAt:'2026-10-19T10:00:00Z'}});
    const claim=(await api.pull(manager)).claims.find((c:any)=>c.localId==='live-cash');
    assert.ok(claim); await api.approveCollection(manager,{...approval,id:claim.id,approvalId:'live-approval'});
    const receiptCount=(await db.collection('payments').get()).size;
    await command(driver,{type:'submitFuel',value:{id:'live-fuel',tripId:t.id,vehicleId:'van-live',driverId:'driver-a',shopId:'SHOP_A',at:'2026-10-19T10:30:00Z',litres:1,rate:10000,amount:10000,pump:'Fictional',odometer:105,receiptId:'live-proof',source:'Personal',fullTank:false}});
    await command(driver,{type:'endTrip',id:t.id,closing:140,photo:'live-proof',returns:true,note:'Shift submitted'});
    await db.doc('shopCash/SHOP_A').set({initializedAt:'2026-10-19T00:00:00Z',totalExpenses:0},{merge:true});
    await command(manager,{type:'reviewFuel',id:'live-fuel',action:'Approve',note:'Verified'});
    const beforeFuel=(await db.doc('shopCash/SHOP_A').get()).data()!;
    await command(manager,{type:'reviewFuel',id:'live-fuel',action:'Settle',note:''},'fuel-settlement-once');
    await command(manager,{type:'reviewFuel',id:'live-fuel',action:'Settle',note:''},'fuel-settlement-once');
    assert.equal((await db.doc('shopCash/SHOP_A').get()).data()?.availableBalance,beforeFuel.availableBalance-100);
    assert.equal((await db.collection('cashExpenses').where('dispatchFuelId','==','live-fuel').get()).size,1);

    await command(manager,{type:'handover',id:t.id,amount:200000,note:'Physical cash counted'});
    await command(manager,{type:'closeTrip',id:t.id,note:'Odometer reviewed'},'close-live-once');
    await command(manager,{type:'closeTrip',id:t.id,note:'Odometer reviewed'},'close-live-once');
    await assert.rejects(()=>command({...manager,shopIds:['SHOP_S']},{type:'closeTrip',id:t.id,note:'Odometer reviewed'},'close-live-once'),/authorised shops/);
    assert.equal((await db.collection('payments').get()).size,receiptCount,'Cash handover never creates another receipt');
    assert.equal((await db.doc('dispatchVehicleLocks/van-live').get()).exists,false);
    stored=(await db.doc('dispatchOperationalState/main').get()).data()!.state;
    assert.equal(stored.trips.find((x:any)=>x.id===t.id).closing-stored.trips.find((x:any)=>x.id===t.id).opening,40);
    assert.equal(stored.fuels.find((f:any)=>f.id==='live-fuel').status,'Approved');
    const limited={...driver,permissions:['viewOperations']};
    await assert.rejects(()=>command(limited,{type:'load',id:t.id}),/Permission/);
    assert.equal(ops.scopedState({...driver,actorId:'unassigned'},stored).collections.length,0);
    await adm.saveRole(admin,{id:'limited-driver',remove:true});
    await db.doc('invoices/other-shop-private').set({...source,invoiceNumber:'S-PRIVATE',shopId:'SHOP_S'});
    assert.equal((await api.pull(manager)).customers.find((c:any)=>c.id==='customer-a')?.invoices.some((r:any)=>r.id==='other-shop-private'),false);
    // A driver authorised at the departure shop still receives each explicitly assigned cross-shop job.
    await db.doc('invoices/cross-shop-assigned').set({...source,invoiceNumber:'S-ASSIGNED',shopId:'SHOP_S'});
    await api.markDelivery(admin,{...details,invoiceId:'cross-shop-assigned'});
    await adm.saveMaster(admin,{kind:'vehicles',id:'van-cross',value:{registration:'TEST-CROSS',type:'Van',fuelType:'Diesel',baseline:100,expectedMileage:15,homeShopId:'SHOP_A',active:true}});
    const cross={...t,routeTemplateId:undefined,id:'cross-shop-trip',vehicleId:'van-cross',stops:[{id:'cross-delivery',customerId:'cis-customer:customer-a',jobId:'cis-job:cross-shop-assigned',kind:'Delivery',completed:false},{id:'cross-collection',customerId:'cis-customer:customer-a',jobId:null,kind:'Collection',completed:false}]};
    await command(admin,{type:'saveTrip',value:cross});
    await command(admin,{type:'routeAction',id:cross.id,action:'Release',note:'Cross-shop assigned route'});
    let driverCloud=await api.pull(driver);
    assert.ok(driverCloud.customers.find((c:any)=>c.id==='customer-a')?.invoices.some((r:any)=>r.id==='cross-shop-assigned'));
    assert.equal(driverCloud.customers.find((c:any)=>c.id==='customer-a')?.invoices.some((r:any)=>r.id==='other-shop-private'),false,'Unassigned other-shop invoices stay private');
    let driverState=ops.scopedState(driver,await ops.workspace(driver,driverCloud));
    assert.ok(driverState.jobs.some(j=>j.id==='cis-job:cross-shop-assigned'),'Assigned cross-shop delivery must be downloaded');
    assert.equal(driverState.invoices.some(r=>r.id==='cis-invoice:other-shop-private'),false);
    assert.equal(ops.scopedState({...driver,actorId:'unassigned'},await ops.workspace(driver,driverCloud)).jobs.some(j=>j.id==='cis-job:cross-shop-assigned'),false);
    await ops.putEvidence(driver,{id:'cross-proof',tripId:cross.id,dataUrl:pixel,name:'Cross-shop test evidence'});
    await command(driver,{type:'startTrip',id:cross.id,opening:100,photo:'cross-proof',note:''});
    await command(driver,{type:'load',id:cross.id},'cross-load-once');
    await command(driver,{type:'load',id:cross.id},'cross-load-once');
    driverCloud=await api.pull(driver);driverState=ops.scopedState(driver,await ops.workspace(driver,driverCloud));
    assert.equal(driverState.trips.find(x=>x.id===cross.id)?.loaded,true);
    assert.equal(driverState.jobs.find(j=>j.id==='cis-job:cross-shop-assigned')?.status,'Out for delivery');



  },
);


test('Admin account lifecycle is enforced by trusted Auth and role records',{skip:!enabled||!process.env.FIREBASE_AUTH_EMULATOR_HOST},async()=>{
 assert.equal(process.env.GCLOUD_PROJECT,'demo-cis-dispatch');
 const adm=await import('./dispatchAdmin');const {getAuth}=await import('firebase-admin/auth');const {stableId}=await import('./dispatchCore');
 const db=getFirestore();const admin={...manager,uid:'admin-root',actorId:'admin-root',role:'ADMIN' as const,shopIds:['SHOP_A','SHOP_S']};
 await assert.rejects(()=>adm.saveAccount(driver,{name:'Denied'}),/Admin/);
 const value={operationId:'new-account-test',name:'Fictional account',email:'fictional-test@example.invalid',password:'TestOnly-NotARealPassword',roleId:'DRIVER',shopIds:['SHOP_A'],active:true};
 const created=await adm.saveAccount(admin,value);const again=await adm.saveAccount(admin,value);assert.equal(created.uid,again.uid);
 const auth=getAuth(getApps().find(a=>a.name==='dispatch-driver-verifier')!);
 assert.equal((await auth.getUser(created.uid)).disabled,false);
 assert.equal((await adm.resolveAccount('delivery-28165',created.uid)).role,'DRIVER');
 await adm.saveRole(admin,{id:'delivery-only',name:'Delivery only',baseRole:'DRIVER',permissions:['viewOperations','recordDeliveries'],active:true});
 await adm.saveAccount(admin,{...value,uid:created.uid,roleId:'delivery-only'});
 const linked=await adm.resolveAccount('delivery-28165',created.uid);assert.equal(linked.permissions?.includes('recordCollections'),false);
 await assert.rejects(()=>adm.saveRole(admin,{id:'delivery-only',remove:true}),/Reassign/);
 await adm.saveAccount(admin,{...value,uid:created.uid,active:false});
 assert.equal((await auth.getUser(created.uid)).disabled,true);
 await assert.rejects(()=>adm.resolveAccount('delivery-28165',created.uid),/active/);
 await adm.removeAccount(admin,{key:stableId('identity',`delivery-28165:${created.uid}`)});
 assert.equal((await db.doc(`dispatchIdentities/${stableId('identity',`delivery-28165:${created.uid}`)}`).get()).exists,false);
 await adm.saveRole(admin,{id:'delivery-only',remove:true});
});
