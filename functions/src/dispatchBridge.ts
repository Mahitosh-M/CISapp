import {serverCashBalanceFields} from './cashRounding';
import {routeCatalog,saveWeeklyRoute} from './dispatchRouteCatalog';
import {allowed,resolveAccount,administration,saveRole,saveAccount,removeAccount,saveMaster} from "./dispatchAdmin";
import {workspace,scopedState,operation,putEvidence,getEvidence} from "./dispatchOperations";
import {
  mapCustomerDoc,
  mapInvoiceDoc as mappedInvoice,
  mapPaymentDoc as mappedPayment,
} from "../../src/utils/financialDocuments";
import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  getFirestore,
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import {
  onDocumentWritten,
  onDocumentCreated,
} from "firebase-functions/v2/firestore";
import type {
  Customer,
  Invoice,
  Payment,
  CustomerIntelligenceSummary,
} from "../../src/types";
import { applyCustomerOutstandingDelta } from "../../src/utils/customerOutstanding";
import { isOpeningBalanceInvoice } from "../../src/utils/openingBalance";
import {
  getNextCashSyncedAmount,
  BRANCH_SYSTEM_VERSION,
} from "../../src/utils/shops";
import {
  calculateInvoiceApcInfo,
  getInvoiceFullPaymentEvent,
} from "../../src/utils/customerPortal";
import {
  CURRENT_PC_POLICY_VERSION,
  canPostInvoicePcForSettlement,
  decideImmutableInvoicePcAward,
} from "../../src/utils/pcAwardPolicy";
import {
  mergeWithDefaultSettings,
  getPaymentTermsLabel,
} from "../../src/utils/settings";
import { calculateCustomerCredit } from "../../src/utils/creditCalculation";
import { buildSingleCustomerScore } from "../../src/utils/customerAnalytics";
import {
  type Data,
  requireValue,
  text,
  identifier,
  paise,
  money,
  date,
  shops,
  stableId,
  deliveryFields,
  assertDeliverable,
  invoiceBalances,
  planReceipt,
} from "./dispatchCore";
const CIS = "cisapp-236ab",
  DELIVERY = "delivery-28165";
const REGION = "asia-south1";
// The authoritative date-only credit/PC helpers use the business-local calendar.
process.env.TZ = "Asia/Kolkata";
const db = () => getFirestore();
const now = () => new Date().toISOString();
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface Identity {
  uid: string;
  issuer: string;
  actorId: string;
  role: "ADMIN" | "MANAGER" | "DRIVER";
  shopIds: string[];
  name: string;
  roleId?: string;
  permissions?: string[];
}
function manager(identity: Identity, shopId?: string) {
  requireValue(
    identity.role !== "DRIVER" &&
      (!shopId || identity.shopIds.includes(shopId)),
    "Permission denied for this shop",
  );
}
function audit(
  tx: Transaction,
  identity: Identity,
  action: string,
  entityId: string,
  details: Data = {},
) {
  tx.create(db().collection("dispatchAudit").doc(), {
    action,
    entityId,
    actorId: identity.actorId,
    uid: identity.uid,
    issuer: identity.issuer,
    at: now(),
    details: clean(details),
  });
}
async function authenticate(token: string, issuer: string): Promise<Identity> {
  requireValue(
    issuer === CIS || issuer === DELIVERY,
    "Unsupported identity issuer",
  );
  const app =
    issuer === CIS
      ? getApp()
      : (getApps().find((a) => a.name === "dispatch-driver-verifier") ??
        initializeApp({ projectId: DELIVERY }, "dispatch-driver-verifier"));
  const decoded = await getAuth(app).verifyIdToken(token, true);
  if (issuer === CIS) {
    const p = (await db().doc(`users/${decoded.uid}`).get()).data();
    requireValue(
      p?.active === true && ["Admin", "admin", "Staff"].includes(p.role),
      "Active CISapp staff account required",
    );
    const admin = p.role === "Admin" || p.role === "admin";
    requireValue(
      admin || shops.includes(p.shopId),
      "Staff shop is not configured",
    );
    return {
      uid: decoded.uid,
      issuer,
      actorId: `cis-user:${decoded.uid}`,
      role: admin ? "ADMIN" : "MANAGER",
      shopIds: admin ? shops : [p.shopId],
      name: String(p.name ?? "CISapp user"),
    };
  }
  return resolveAccount(issuer,decoded.uid);
}
async function scopedTrip(identity: Identity, tripId: string) {
  const t = (
    await db()
      .doc(`dispatchTrips/${identifier(tripId)}`)
      .get()
  ).data();
  requireValue(t, "Published trip not found");
  requireValue(
    identity.shopIds.includes(t.startShopId) &&
      (identity.role !== "DRIVER" ||
        [t.primaryDriverId, t.companionId].includes(identity.actorId)),
    "Trip is not assigned to this account",
  );
  return t;
}
async function sourceLedger(customerId: string, tx?: Transaction) {
  const iq = db().collection("invoices").where("customerId", "==", customerId);
  const pq = db().collection("payments").where("customerId", "==", customerId);
  const [i, p] = tx
    ? await Promise.all([tx.get(iq), tx.get(pq)])
    : await Promise.all([iq.get(), pq.get()]);
  requireValue(
    i.size <= 150 && p.size <= 5000,
    "Customer ledger requires extended review",
  );
  return {
    invoices: i.docs.map((x) => mappedInvoice(x.id, x.data())),
    payments: p.docs.map((x) => mappedPayment(x.id, x.data())),
  };
}
function projectRequest(
  id: string,
  i: Data,
  customer: Data,
  details: Data,
  revision: number,
) {
  return {
    id,
    sourceInvoiceId: id,
    sourceCustomerId: i.customerId,
    invoiceNumber: i.invoiceNumber,
    customerName: String(customer.name ?? i.customerName ?? ""),
    shopId: i.shopId,
    sourceUpdatedAt: String(i.updatedAt ?? i.createdAt ?? ""),
    sourceRevision: revision,
    ...details,
    active: true,
    updatedAt: now(),
  };
}
async function markDelivery(identity: Identity, p: Data) {
  const invoiceId = identifier(p.invoiceId),
    ref = db().doc(`invoices/${invoiceId}`),
    target = db().doc(`dispatchDeliveryRequests/${invoiceId}`);
  return db().runTransaction(async (tx) => {
    const [invoice, old] = await Promise.all([tx.get(ref), tx.get(target)]);
    requireValue(invoice.exists, "Save the invoice first");
    const i = invoice.data()!;
    manager(identity, i.shopId);
    assertDeliverable(i);
    const customer = await tx.get(
      db().doc(`customers/${identifier(i.customerId)}`),
    );
    requireValue(customer.exists, "Customer no longer exists");
    const previous = old.data();
    requireValue(
      !previous?.tripId || p.required !== false,
      "Assigned delivery must be cancelled through Dispatch",
    );
    const details =
      p.required === false
        ? { ...(previous ?? {}), required: false, active: false }
        : deliveryFields(p);
    // Resolve route metadata from the trusted catalogue, never trust client snapshots.
    if (p.required !== false && p.routeId) {
      const route=(await tx.get(db().doc(`dispatchRouteTemplates/${identifier(p.routeId)}`))).data();
      requireValue(route?.active===true && route.shopIds.includes(i.shopId),'Route is inactive or unavailable for this shop');
      const stop=p.routeStopId?route.stops.find((x:Data)=>x.id===p.routeStopId):null;
      requireValue(!p.routeStopId||stop,'Route stop no longer exists. Select the stop again.');
      requireValue(!previous?.tripId||previous.routeId===route.id,'Assigned route cannot change; review the trip in Dispatch first');
      Object.assign(details,{routeId:route.id,routeName:route.name,routeFrom:route.from,routeTo:route.to,routeDays:route.days,routeRevision:route.revision,routeStopId:stop?.id??null,routeStopName:stop?.name??null});
    } else if(p.required!==false) {
      requireValue(!previous?.tripId||!previous.routeId,'Assigned route cannot be removed; review the trip in Dispatch first');
    }
    const revision = (previous?.sourceRevision ?? 0) + 1;
    const projection = projectRequest(
      invoiceId,
      i,
      customer.data()!,
      details,
      revision,
    );
    if (p.required === false) projection.active = false;
    tx.set(target, { ...projection, tripId: previous?.tripId ?? null, assignedDriverIds: previous?.assignedDriverIds ?? [] });
    tx.update(ref, {
      deliveryRequired: p.required !== false,
      deliveryDetails: p.required === false ? null : details,
      deliveryRevision: revision,
    });
    audit(
      tx,
      identity,
      p.required === false
        ? "Delivery request removed"
        : "Invoice marked for delivery",
      invoiceId,
      { revision },
    );
    return { invoiceId, revision, saved: true };
  });
}
async function publishTrip(identity: Identity, p: Data) {
  manager(identity, p.startShopId);
  const id = identifier(p.id);
  requireValue(
    p.status === "Released",
    "Release the local route before publishing",
  );
  requireValue(
    Array.isArray(p.stops) && p.stops.length > 0 && p.stops.length <= 60,
    "Route must contain 1-60 stops",
  );
  const driverIds = [
    identifier(p.primaryDriverId),
    ...(p.companionId ? [identifier(p.companionId)] : []),
  ];
  requireValue(
    new Set(driverIds).size === driverIds.length,
    "Drivers must be distinct",
  );
  const drivers = await db()
    .collection("dispatchIdentities")
    .where("active", "==", true)
    .get();
  for (const driverId of driverIds)
    requireValue(
      drivers.docs.some(
        (x) =>
          x.data().role === "DRIVER" && x.data().actorId === driverId &&
          x.data().shopIds.includes(p.startShopId),
      ),
      "Assign Admin-linked driver accounts before publishing",
    );
  requireValue(shops.includes(p.endShopId), "Invalid destination shop");
  const stops = p.stops.map((s: Data) => ({
    id: identifier(s.id),
    kind: text(s.kind, "Stop type", 30),
    customerId: identifier(s.customerId),
    jobId: s.jobId ? identifier(s.jobId) : null,
    completed: false,
  }));
  requireValue(
    stops.every((s: Data) =>
      ["Delivery", "Collection", "Sales visit"].includes(s.kind),
    ),
    "Invalid stop type",
  );
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`dispatchTrips/${id}`),
      vehicleId = identifier(p.vehicleId),
      vehicleRef = db().doc(`dispatchVehicleLocks/${vehicleId}`);
    const [old, lock] = await Promise.all([tx.get(ref), tx.get(vehicleRef)]);
    const previous = old.data();
    requireValue(
      !previous || previous.status === "Released",
      "Started routes cannot be overwritten",
    );
    requireValue(
      !lock.exists || lock.data()?.tripId === id,
      "Vehicle already has a published active trip",
    );
    const requests = await Promise.all(
      stops
        .filter((s: Data) => s.jobId)
        .map((s: Data) =>
          tx.get(db().doc(`dispatchDeliveryRequests/${s.jobId}`)),
        ),
    );
    requests.forEach((r) => {
      const d = r.data();
      requireValue(
        d?.active === true &&
          identity.shopIds.includes(d.shopId) &&
          (!d.tripId || d.tripId === id),
        "Delivery is unavailable, changed or assigned elsewhere",
      );
    });
    const sources = await Promise.all(
      requests.map((r) => tx.get(db().doc(`invoices/${r.id}`))),
    );
    sources.forEach((source, index) => {
      requireValue(source.exists, "Invoice was deleted; refresh route");
      const invoice = source.data()!,
        request = requests[index].data()!;
      assertDeliverable(invoice);
      requireValue(
        invoice.deliveryRequired === true &&
          invoice.customerId === request.sourceCustomerId &&
          invoice.shopId === request.shopId &&
          String(invoice.updatedAt ?? invoice.createdAt ?? "") ===
            request.sourceUpdatedAt,
        "Source invoice changed; refresh or re-mark delivery before publishing",
      );
    });
    for (const stop of stops) {
      const r = requests.find((r) => r.id === stop.jobId)?.data();
      if (stop.kind === "Delivery")
        requireValue(
          r && r.sourceCustomerId === stop.customerId,
          "Delivery/customer mismatch",
        );
      else
        requireValue(
          (await tx.get(db().doc(`customers/${stop.customerId}`))).exists,
          "Stop customer not found",
        );
    }
    const removedIds = (previous?.stops ?? []).filter((st: Data) => st.jobId && !stops.some((next: Data) => next.jobId === st.jobId)).map((st: Data) => st.jobId);
    const removedRequests = await Promise.all(removedIds.map((jobId: string) => tx.get(db().doc(`dispatchDeliveryRequests/${identifier(jobId)}`))));
    const previousVehicleLock = previous?.vehicleId && previous.vehicleId !== vehicleId ? await tx.get(db().doc(`dispatchVehicleLocks/${identifier(previous.vehicleId)}`)) : null;
    const value = {
      id,
      name: text(p.name, "Route name", 120),
      date: date(p.date),
      startShopId: p.startShopId,
      endShopId: p.endShopId,
      vehicleId,
      primaryDriverId: driverIds[0],
      companionId: driverIds[1] ?? null,
      stops,
      status: "Released",
      openingAdvance: paise(p.openingAdvance),
      vehicle: {
        id: vehicleId,
        registration: String(p.vehicle?.registration ?? "Assigned van").slice(
          0,
          50,
        ),
        type: "Delivery van",
        fuelType: "Diesel",
        expectedMileage:
          Number(p.vehicle?.expectedMileage) > 0
            ? Number(p.vehicle.expectedMileage)
            : 15,
        baseline:
          Number(p.vehicle?.baseline) >= 0 ? Number(p.vehicle.baseline) : 0,
        homeShopId: p.startShopId,
        active: true,
      },
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: now(),
    };
    tx.set(ref, value);
    for (const removed of removedRequests) if (removed.data()?.tripId === id) tx.update(removed.ref, { tripId: null, assignedDriverIds: [], updatedAt: now() });
    if (previousVehicleLock?.data()?.tripId === id) tx.delete(previousVehicleLock.ref);
    tx.set(vehicleRef, { tripId: id, updatedAt: now() });
    requests.forEach((r) =>
      tx.update(r.ref, {
        tripId: id,
        assignedDriverIds: driverIds,
        updatedAt: now(),
      }),
    );
    audit(tx, identity, "Route published", id, { driverIds, previous: previous ? { revision: previous.revision, stops: previous.stops, primaryDriverId: previous.primaryDriverId, companionId: previous.companionId } : null });
    return { id, revision: value.revision };
  });
}
async function pull(identity: Identity) {
  const tripsSnap =
    identity.role === "DRIVER"
      ? await db()
          .collection("dispatchTrips")
          .where("primaryDriverId", "==", identity.actorId)
          .get()
      : await db()
          .collection("dispatchTrips")
          .where("startShopId", "in", identity.shopIds)
          .get();
  const companion =
    identity.role === "DRIVER"
      ? await db()
          .collection("dispatchTrips")
          .where("companionId", "==", identity.actorId)
          .get()
      : null;
  const trips = [
    ...new Map(
      [...tripsSnap.docs, ...(companion?.docs ?? [])].map((x) => [
        x.id,
        x.data(),
      ]),
    ).values(),
  ];
  requireValue(trips.length <= 200, "Archive old trips before synchronising");
  const requestSnap =
    identity.role === "DRIVER"
      ? await db()
          .collection("dispatchDeliveryRequests")
          .where("assignedDriverIds", "array-contains", identity.actorId)
          .get()
      : await db()
          .collection("dispatchDeliveryRequests")
          .where("shopId", "in", identity.shopIds)
          .get();
  const requests = requestSnap.docs
    .map((x) => ({ ...x.data(), id: x.id }))
    .filter(
      (r: Data) =>
        identity.role !== "DRIVER" || trips.some((t) => t.id === r.tripId),
    );
  requireValue(
    requests.length <= 1000,
    "Delivery history requires pagination before further sync",
  );
  const customers = [
    ...new Set<string>([
      ...requests.map((r: Data) => r.sourceCustomerId),
      ...trips.flatMap((t) => t.stops.map((s: Data) => s.customerId)),
    ]),
  ];
  const assignedInvoiceIds = new Set(requests.map((r:Data)=>r.sourceInvoiceId));
  const catalog: Data[] = [];
  for (const customerId of customers) {
    const customer = (
      await db()
        .doc(`customers/${identifier(customerId)}`)
        .get()
    ).data();
    if (!customer) continue;
    const ledger = await sourceLedger(customerId);
    catalog.push({
      id: customerId,
      name: String(customer.name ?? ""),
      phone: String(customer.mobile ?? ""),
      area: String(customer.area ?? ""),
      invoices: invoiceBalances(ledger.invoices, ledger.payments).filter((i) => !i.shopId || identity.shopIds.includes(i.shopId) || (identity.role === "DRIVER" && assignedInvoiceIds.has(i.id))).map((i) => ({
        id: i.id,
        number: i.invoiceNumber,
        date: i.date,
        due: i.dueDate || i.date,
        amount: money(i.totalSales),
        outstanding: i.pendingPaise,
        shopId: i.shopId ?? null,
        opening: isOpeningBalanceInvoice(i),
      })),
    });
  }
  const claimsSnap =
    identity.role === "DRIVER"
      ? await db()
          .collection("dispatchCollections")
          .where("actorId", "==", identity.actorId)
          .get()
      : await db()
          .collection("dispatchCollections")
          .where("shopId", "in", identity.shopIds)
          .get();
  const drivers =
    identity.role === "DRIVER"
      ? []
      : (
          await db()
            .collection("dispatchIdentities")
            .where("active", "==", true)
            .get()
        ).docs
          .map((x) => x.data())
          .filter((d) =>
            d.role === "DRIVER" && d.shopIds.some((s: string) => identity.shopIds.includes(s)),
          )
          .map((d) => ({
            id: d.actorId,
            name: d.name,
            role: "DRIVER",
            phone: "",
            shopIds: d.shopIds,
            active: true,
          }));
  requireValue(
    claimsSnap.size <= 1000,
    "Collection history requires pagination before further sync",
  );
  const claims: Data[] = [];
  for (const snapshot of claimsSnap.docs) {
    const c = { ...snapshot.data(), id: snapshot.id } as Data;
    if (c.status === "Posted") {
      let current = 0,
        changed = false;
      for (const receiptId of c.receiptIds ?? []) {
        const r = (
          await db()
            .doc(`payments/${identifier(receiptId)}`)
            .get()
        ).data();
        if (!r || r.customerId !== c.customerId) {
          changed = true;
          continue;
        }
        if (r.shopId !== c.shopId) changed = true;
        current += money(r.amount ?? r.amountReceived);
      }
      c.currentReceiptAmount = current;
      if (changed || current !== c.postedAmount)
        c.sourceIssue =
          "A posted receipt was edited, moved or deleted in CISapp; review the authoritative payment history";
    }
    claims.push(c);
  }
  // Only safe operational fields and necessary invoice balances leave this endpoint.
  return clean({
    identity,
    trips,
    requests,
    customers: catalog,
    claims,
    drivers,
    serverAt: now(),
  });
}
async function submitCollection(identity: Identity, p: Data) {
  const trip = await scopedTrip(identity, p.tripId);
  requireValue(
    identity.role === "DRIVER",
    "Collections must be submitted by the assigned authenticated driver",
  );
  requireValue(
    ["Released", "Active", "End submitted"].includes(trip.status),
    "Trip is closed",
  );
  const customerId = identifier(p.customerId);
  requireValue(
    trip.stops.some((s: Data) => s.customerId === customerId),
    "Customer is not assigned to this trip",
  );
  const mode = text(p.mode, "Payment mode", 30);
  requireValue(
    ["Cash", "UPI", "Bank transfer", "Credit"].includes(mode),
    "Invalid payment mode",
  );
  requireValue(
    ["Cash", "Credit"].includes(mode) || String(p.reference ?? "").trim(),
    "Digital payment reference is required",
  );
  const amount = paise(p.amount, mode === "Credit");
  requireValue(
    mode !== "Credit" || amount === 0,
    "Credit does not create money",
  );
  const submissionId = identifier(p.submissionId),
    id = stableId(
      "collection",
      `${identity.issuer}:${identity.uid}:${submissionId}`,
    );
  const invoiceIds = p.invoiceIds ?? [];
  requireValue(
    Array.isArray(invoiceIds) && invoiceIds.length <= 150,
    "Invalid selected invoice references",
  );
  const ledger = await sourceLedger(customerId);
  for (const id of invoiceIds)
    requireValue(
      ledger.invoices.some((i) => i.id === identifier(id)),
      "Selected reference does not belong to this customer",
    );
  const value = {
    invoiceIds,
    submissionId,
    localId: identifier(p.localId),
    tripId: trip.id,
    customerId,
    shopId: trip.startShopId,
    actorId: identity.actorId,
    mode,
    amount,
    reference: String(p.reference ?? "").slice(0, 200),
    note: String(p.note ?? "").slice(0, 1500),
    collectedAt: text(p.collectedAt, "Collection timestamp", 40),
  };
  const hash = stableId("payload", JSON.stringify(value));
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`dispatchCollections/${id}`),
      old = await tx.get(ref);
    if (old.exists) {
      requireValue(
        old.data()?.payloadHash === hash,
        "Submission ID was already used with different details",
      );
      return { id, status: old.data()!.status };
    }
    tx.create(ref, {
      ...value,
      payloadHash: hash,
      status: "Pending",
      receivedAt: now(),
    });
    audit(tx, identity, "Collection submitted", id, { amount, mode });
    return { id, status: "Pending" };
  });
}
async function approveCollection(identity: Identity, p: Data) {
  manager(identity);
  const id = identifier(p.id),
    approvalId = identifier(p.approvalId);
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`dispatchCollections/${id}`),
      ackRef = db().doc(
        `dispatchApprovals/${stableId("approval", approvalId)}`,
      );
    const [claimSnap, ack] = await Promise.all([tx.get(ref), tx.get(ackRef)]);
    requireValue(claimSnap.exists, "Collection not found");
    const c = claimSnap.data()!;
    requireValue(c.actorId !== identity.actorId,"You cannot approve your own collection");
    manager(identity, c.shopId);
    if (ack.exists) {
      requireValue(
        ack.data()?.collectionId === id,
        "Approval ID belongs to another collection",
      );
      return ack.data();
    }
    requireValue(
      c.status === "Pending",
      "Collection has already been reviewed; refresh status",
    );
    const note = text(p.note, "Verification/review note", 1500);
    if (p.reject === true || c.mode === "Credit") {
      const status = p.reject ? "Rejected" : "Credit authorised";
      tx.update(ref, {
        status,
        reviewNote: note,
        reviewedAt: now(),
        reviewedBy: identity.actorId,
      });
      const result = {
        collectionId: id,
        status,
        receiptIds: [],
        postedAmount: 0,
        unallocated: c.amount,
        approvalId,
      };
      tx.create(ackRef, result);
      audit(tx, identity, status, id, { note });
      return result;
    }
    requireValue(
      c.mode === "Cash" || p.digitalVerified === true,
      "UPI/bank payment needs independent verification",
    );
    const customerRef = db().doc(`customers/${c.customerId}`),
      customerSnap = await tx.get(customerRef);
    requireValue(customerSnap.exists, "Customer not found");
    const customer = customerSnap.data()!;
    const { invoices, payments } = await sourceLedger(c.customerId, tx);
    const plan = planReceipt(
      invoices,
      payments,
      c.amount,
      p.allocations,
      p.discount ?? 0,
    );
    const timestamp = now(),
      paymentDate = date(p.date),
      month = paymentDate.slice(0, 7);
    const settingsSnap = await tx.get(db().doc("settings/appSettings"));
    const settings = mergeWithDefaultSettings(settingsSnap.data() ?? {});
    const balanceRef = db().doc(`pcBalances/${c.customerId}`),
      balanceSnap = await tx.get(balanceRef);
    const pcRefs = plan.rows.map((r) =>
      db().doc(`loyaltyLedger/${c.customerId}_${r.invoiceId}_invoice_pc`),
    );
    const pcSnaps = await Promise.all(pcRefs.map((r) => tx.get(r)));
    const customerMonthRef = db().doc(
        `customerMonthlySnapshots/${c.customerId}_${month}`,
      ),
      businessMonthRef = db().doc(`businessMonthlySnapshots/${month}`);
    const [customerMonth, businessMonth] = await Promise.all([
      tx.get(customerMonthRef),
      tx.get(businessMonthRef),
    ]);
    const cashSnapshot = await tx.get(db().doc(`shopCash/${c.shopId}`));
    const receiptIds: string[] = [],
      candidates: Payment[] = [];
    let invoiceDelta = 0,
      openingDelta = 0,
      points = 0,
      lastAwardInvoice = "",
      lastAwardLedger = "";
    plan.rows.forEach((r, index) => {
      const invoice = invoices.find((i) => i.id === r.invoiceId)!;
      requireValue(
        !["cancelled", "deleted", "void"].includes(
          String(invoice.recordStatus ?? "").toLowerCase(),
        ),
        "Invoice was cancelled",
      );
      const receiptId = stableId("dispatch_receipt", `${id}:${r.invoiceId}`);
      receiptIds.push(receiptId);
      const value = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: c.customerId,
        customerName: String(customer.name ?? ""),
        date: paymentDate,
        amount: r.amount / 100,
        amountAppliedToInvoice: r.amount / 100,
        cashDiscount: r.discount / 100,
        advanceCreatedAmount: 0,
        advanceAppliedAmount: 0,
        amountUsedForOldBalance: 0,
        oldBalanceBeforePayment: Number(
          customer.previousOutstandingAmount ?? 0,
        ),
        oldBalanceAfterPayment: Number(customer.previousOutstandingAmount ?? 0),
        paymentKind: "receipt" as const,
        mode: c.mode === "Bank transfer" ? "Bank Transfer" : c.mode,
        notes: `Dispatch collection ${id}. ${note}`,
        shopId: c.shopId,
        branchSystemVersion: BRANCH_SYSTEM_VERSION,
        affectsShopCash: true,
        cashSyncedAmount: 0,
        pcPolicyVersionAtPayment: CURRENT_PC_POLICY_VERSION,
        splitPaymentGroupId: id,
        splitPaymentTotalAmount: plan.allocated / 100,
        splitPaymentPart: index + 1,
        splitPaymentCount: plan.rows.length,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      value.cashSyncedAmount = getNextCashSyncedAmount(value);
      candidates.push({ ...value, id: receiptId } as Payment);
      if (isOpeningBalanceInvoice(invoice))
        openingDelta -= (r.amount + r.discount) / 100;
      else invoiceDelta -= (r.amount + r.discount) / 100;
    });
    // Every read completes before any transaction write. Source helper semantics are shared with CISapp.
    plan.rows.forEach((r, index) => {
      const invoice = invoices.find((i) => i.id === r.invoiceId)!;
      const ledger = pcSnaps[index];
      if (isOpeningBalanceInvoice(invoice) || ledger.exists) return;
      const settlement = getInvoiceFullPaymentEvent(
        invoice,
        [...payments, ...candidates].filter((x) => x.invoiceId === invoice.id),
      );
      if (
        !settlement ||
        !canPostInvoicePcForSettlement(
          invoice,
          settlement,
          String(balanceSnap.data()?.protectedAt ?? ""),
        )
      )
        return;
      const award = calculateInvoiceApcInfo(
        invoice,
        [...payments, ...candidates].filter((x) => x.invoiceId === invoice.id),
        customer.tier ?? "Tier 4",
        settings,
      );
      const decision = decideImmutableInvoicePcAward(
        false,
        undefined,
        award.earnedApc,
      );
      points += decision.pointsToAdd;
      if (decision.pointsToAdd > 0) {
        lastAwardInvoice = invoice.id;
        lastAwardLedger = ledger.id;
      }
      tx.create(ledger.ref, {
        customerId: c.customerId,
        type: "on_time_payment",
        points: decision.awardedPoints,
        reason: `Invoice ${invoice.invoiceNumber || invoice.id} PC permanently ${decision.awardedPoints > 0 ? "awarded" : "finalized at zero"}`,
        referenceId: invoice.id,
        month: settlement.date.slice(0, 7),
        createdAt: timestamp,
      });
    });
    if (points > 0) {
      const b = balanceSnap.data();
      tx.set(
        balanceRef,
        {
          customerId: c.customerId,
          availablePc: Number(b?.availablePc ?? 0) + points,
          incomingPc: Number(b?.incomingPc ?? 0) + points,
          redeemedPc: Number(b?.redeemedPc ?? 0),
          protectedAt: String(b?.protectedAt ?? ""),
          lastAwardReferenceId: lastAwardInvoice,
          lastMutationReferenceId: lastAwardLedger,
          updatedAt: timestamp,
        },
        { merge: true },
      );
    }
    candidates.forEach((r) => {
      const { id: receiptId, ...data } = r;
      tx.create(db().doc(`payments/${receiptId}`), data);
    });
    tx.update(customerRef, {
      ...applyCustomerOutstandingDelta(customer, {
        invoice: invoiceDelta,
        openingBalance: openingDelta,
      }),
      financialSummaryUpdatedAt: timestamp,
      updatedAt: timestamp,
    });
    tx.set(
      db().doc(`shopCash/${c.shopId}`),
      {
        shopId: c.shopId,
        ...serverCashBalanceFields(tx,db(),c.shopId,Number(cashSnapshot.data()?.availableBalance??0),plan.allocated/100,receiptIds[receiptIds.length-1],identity.uid),
        totalCollections: FieldValue.increment(plan.allocated / 100),
        updatedAt: timestamp,
        lastCashOperationId: receiptIds[receiptIds.length - 1],
        lastCashOperationType: "payment",
      },
      { merge: true },
    );
    for (const [ref, snap, extra] of [
      [customerMonthRef, customerMonth, { customerId: c.customerId }],
      [businessMonthRef, businessMonth, {}],
    ] as const) {
      const old = snap.data() ?? {};
      tx.set(ref, {
        ...extra,
        month,
        totalSales: Number(old.totalSales ?? 0),
        totalProfit: Number(old.totalProfit ?? 0),
        invoiceCount: Number(old.invoiceCount ?? 0),
        paymentsReceived:
          Number(old.paymentsReceived ?? 0) + plan.allocated / 100,
        needsBackfill: snap.exists ? old.needsBackfill === true : true,
        updatedAt: timestamp,
      });
    }
    const result = {
      collectionId: id,
      approvalId,
      status: "Posted",
      receiptIds,
      postedAmount: plan.allocated,
      discount: plan.discount,
      unallocated: plan.unallocated,
      allocations: plan.rows.map((r) => ({
        invoiceId: r.invoiceId,
        amount: r.amount,
        discount: r.discount,
      })),
      postedAt: timestamp,
      sourceProjectId: CIS,
    };
    tx.create(ackRef, result);
    tx.update(ref, {
      ...result,
      reviewNote: note,
      reviewedBy: identity.actorId,
      digitalVerified: c.mode !== "Cash",
    });
    tx.create(db().doc(`dispatchPostingTasks/${id}`), {
      customerId: c.customerId,
      status: "Pending",
      createdAt: timestamp,
    });
    audit(tx, identity, "Collection approved and receipts posted", id, result);
    return result;
  });
}
async function closeRouteAssignment(identity: Identity, p: Data) {
  const id = identifier(p.id);
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`dispatchTrips/${id}`),
      snap = await tx.get(ref);
    requireValue(snap.exists, "Published route not found");
    const t = snap.data()!;
    manager(identity, t.startShopId);
    if (t.status === "Closed") return { id, status: "Closed" };
    const note = text(p.note, "Manager closure review note", 1500);
    requireValue(
      p.reviewedLocalEvidence === true,
      "Manager must review local shift evidence and settlements before closing the assignment",
    );
    requireValue(
      Number.isFinite(p.opening) &&
        Number.isFinite(p.closing) &&
        p.opening >= 0 &&
        p.closing >= p.opening,
      "Invalid reviewed odometer readings",
    );
    const claims = await tx.get(
      db().collection("dispatchCollections").where("tripId", "==", id),
    );
    requireValue(
      !claims.docs.some((c) => c.data().status === "Pending"),
      "Review connected collection claims first",
    );
    const lockRef = db().doc(`dispatchVehicleLocks/${t.vehicleId}`),
      lock = await tx.get(lockRef);
    tx.update(ref, {
      status: "Closed",
      closedAt: now(),
      closureReview: {
        note,
        opening: p.opening,
        closing: p.closing,
        approvedDistance: p.closing - p.opening,
        reviewedBy: identity.actorId,
        evidenceLocation:
          "Retained in originating local installation; explicitly reviewed by manager",
      },
    });
    if (lock.data()?.tripId === id) tx.delete(lockRef);
    audit(
      tx,
      identity,
      "Published route closed after explicit local evidence review",
      id,
      { note },
    );
    return { id, status: "Closed" };
  });
}
async function linkDriver(identity: Identity, p: Data) {
  requireValue(identity.role === "ADMIN", "Admin required");
  const uid = identifier(p.uid),
    shopIds = p.shopIds;
  requireValue(
    Array.isArray(shopIds) &&
      shopIds.length > 0 &&
      shopIds.every((x) => shops.includes(x)),
    "Authorised shops required",
  );
  const actorId = stableId("driver", `${DELIVERY}:${uid}`),
    key = stableId("identity", `${DELIVERY}:${uid}`);
  await db().runTransaction(async (tx) => {
    tx.set(db().doc(`dispatchIdentities/${key}`), {
      issuer: DELIVERY,
      uid,
      actorId,
      role: "DRIVER",
      name: text(p.name, "Driver name", 120),
      shopIds,
      active: p.active !== false,
      approvedBy: identity.uid,
      updatedAt: now(),
    });
    audit(tx, identity, "Driver identity link updated", key, {
      actorId,
      shopIds,
      active: p.active !== false,
    });
  });
  return { actorId };
}
export const dispatchBridge = onRequest(
  { region: REGION, cors: true, invoker: "public", timeoutSeconds: 120, maxInstances: 10 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST required" });
      return;
    }
    try {
      requireValue(
        Buffer.byteLength(JSON.stringify(req.body ?? {})) < 4_200_000,
        "Request too large",
      );
      const token = req.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
      requireValue(token, "Sign in required: missing authentication token");
      const identity = await authenticate(
        token,
        String(req.get("x-dispatch-issuer") ?? CIS),
      );
      const { action, payload = {} } = req.body ?? {};
      requireValue(
        payload && typeof payload === "object" && !Array.isArray(payload),
        "Invalid request payload",
      );
      const caps:Record<string,string>={markDelivery:"manageDispatch",pull:"viewOperations",publishTrip:"manageDispatch",submitCollection:"recordCollections",approveCollection:"approveCollections",closeRouteAssignment:"reconcileCash",linkDriver:"manageUsers"};
      if(caps[action]) allowed(identity,caps[action]);
      let result: unknown;
      switch (action) {
        case "routeCatalog": result=await routeCatalog(identity); break;
        case "saveWeeklyRoute": result=await saveWeeklyRoute(identity,payload); break;
        case "administration": result=await administration(identity); break;
        case "saveRole": result=await saveRole(identity,payload); break;
        case "saveAccount": result=await saveAccount(identity,payload); break;
        case "removeAccount": result=await removeAccount(identity,payload); break;
        case "saveMaster": result=await saveMaster(identity,payload); break;
        case "operation": result=await operation(identity,payload,await pull(identity)); break;
        case "putEvidence": result=await putEvidence(identity,payload); break;
        case "getEvidence": result=await getEvidence(identity,payload); break;
        case "identity":
          result = identity;
          break;
        case "markDelivery":
          result = await markDelivery(identity, payload);
          break;
        case "pull":
          { const cloud = await pull(identity); result = {...cloud,operational:scopedState(identity,await workspace(identity,cloud))}; }
          break;
        case "publishTrip":
          throw new Error("This legacy write endpoint is retired. Use the current authenticated Dispatch application.");
        case "submitCollection":
          throw new Error("This legacy write endpoint is retired. Use the current authenticated Dispatch application.");
        case "approveCollection":
          result = await approveCollection(identity, payload);
          break;
        case "closeRouteAssignment":
          throw new Error("This legacy write endpoint is retired. Use the current authenticated Dispatch application.");
        case "linkDriver":
          throw new Error("This legacy write endpoint is retired. Use the current authenticated Dispatch application.");
        default:
          throw new Error("Unknown integration action");
      }
      res.json({ result });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Integration failed";
      // Never echo tokens, source documents, stack traces or internal SDK diagnostics.
      const authFailure = /auth\/|token|credential/i.test(message);
      res
        .status(
          authFailure
            ? 401
            : /Permission|assigned|Admin|account|authorised/i.test(message)
              ? 403
              : 409,
        )
        .json({
          error: authFailure
            ? "Session expired or invalid. Sign in again."
            : message.slice(0, 250),
        });
    }
  },
);
/** Retry-safe refresh after invoices are edited/cancelled/deleted outside Dispatch. */
export const refreshDispatchInvoice = onDocumentWritten(
  { document: "invoices/{invoiceId}", region: REGION, retry: true },
  async (event) => {
    const id = event.params.invoiceId;
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`dispatchDeliveryRequests/${id}`),
        request = await tx.get(ref);
      if (!request.exists) return;
      const source = await tx.get(db().doc(`invoices/${id}`));
      const old = request.data()!;
      if (!source.exists) {
        tx.update(ref, {
          active: false,
          sourceIssue: "Invoice deleted; retain delivery history",
          updatedAt: now(),
        });
        return;
      }
      const i = source.data()!;
      if (
        old.sourceUpdatedAt === String(i.updatedAt ?? i.createdAt ?? "") &&
        old.active === (i.deliveryRequired === true)
      )
        return;
      const identityChanged =
        i.customerId !== old.sourceCustomerId || i.shopId !== old.shopId;
      let issue = identityChanged
        ? "Invoice customer/shop changed; manager review required"
        : "";
      try {
        assertDeliverable(i);
      } catch (e) {
        issue = String((e as Error).message);
      }
      tx.update(ref, {
        active: !issue && i.deliveryRequired === true,
        sourceIssue: issue,
        sourceUpdatedAt: String(i.updatedAt ?? i.createdAt ?? ""),
        sourceRevision: (old.sourceRevision ?? 0) + 1,
        updatedAt: now(),
      });
    });
  },
);
/** Uses current frontend authority helpers, including the existing medical-credit changes. */
export const refreshDispatchCustomer = onDocumentCreated(
  {
    document: "dispatchPostingTasks/{id}",
    region: REGION,
    retry: true,
    timeoutSeconds: 120,
  },
  async (event) => {
    const taskRef = db().doc(`dispatchPostingTasks/${event.params.id}`);
    await db().runTransaction(async (tx) => {
      const task = await tx.get(taskRef);
      if (task.data()?.status === "Complete") return;
      const customerId = identifier(task.data()?.customerId),
        customerRef = db().doc(`customers/${customerId}`);
      const [cs, settingsSnap, previous, profile, pc] = await Promise.all([
        tx.get(customerRef),
        tx.get(db().doc("settings/appSettings")),
        tx.get(db().doc(`customerIntelligenceSummaries/${customerId}`)),
        tx.get(db().doc(`customerCreditProfiles/${customerId}`)),
        tx.get(db().doc(`pcBalances/${customerId}`)),
      ]);
      requireValue(cs.exists, "Customer no longer exists");
      const ledger = await sourceLedger(customerId, tx),
        settings = mergeWithDefaultSettings(settingsSnap.data() ?? {});
      const customer = mapCustomerDoc(customerId, cs.data()!);
      const score = buildSingleCustomerScore(
        customer,
        ledger.invoices,
        ledger.payments,
        new Date(),
        settings,
        previous.exists
          ? ({
              ...previous.data(),
              id: previous.id,
            } as CustomerIntelligenceSummary)
          : undefined,
      );
      const scored = score ? { ...customer, tier: score.tier } : customer;
      const credit = calculateCustomerCredit({
        customerId,
        customer: scored,
        invoices: ledger.invoices.map((i) => ({
          id: i.id,
          data: { ...i, status: i.recordStatus },
        })),
        payments: ledger.payments.map((p) => ({ id: p.id, data: p })),
        settings,
        existingProfile: profile.data() ?? {},
        reviewReason: "dispatch_collection_posted",
      });
      if (score) {
        tx.set(
          db().doc(`customerIntelligenceSummaries/${customerId}`),
          clean({
            ...score,
            giftBudget: Math.max(0, Number(pc.data()?.availablePc) || 0),
            calculatedAt: now(),
          }),
        );
        if (score.tier !== customer.tier)
          tx.update(customerRef, {
            tier: score.tier,
            paymentTerms:
              customer.customerType === "medical"
                ? getPaymentTermsLabel(score.tier,settings,"medical")
                : getPaymentTermsLabel(score.tier, settings),
            updatedAt: now(),
          });
      }
      tx.set(
        db().doc(`customerCreditProfiles/${customerId}`),
        clean(credit.profile),
      );
      tx.set(
        db().doc(`customerCreditSummaries/${customerId}`),
        clean(credit.summary),
      );
      tx.update(taskRef, { status: "Complete", completedAt: now() });
    });
  },
);
// Service entry points are exported only for isolated emulator regression tests;
// index.ts exposes only the authenticated HTTPS endpoint and trusted triggers.
export const dispatchServiceForTests = {
  markDelivery,
  publishTrip,
  pull,
  submitCollection,
  approveCollection,
  linkDriver,
  closeRouteAssignment,
};

