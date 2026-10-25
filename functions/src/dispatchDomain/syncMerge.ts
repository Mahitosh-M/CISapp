import type { AppState, Trip, User } from "./domain";
import { now } from "./domain";
interface ConnectedIdentity { uid:string;issuer:'cisapp-236ab'|'delivery-28165';actorId:string;role:'ADMIN'|'MANAGER'|'DRIVER';shopIds:string[];name:string; }
export interface CloudClaim {
  id: string;
  localId: string;
  tripId: string;
  customerId: string;
  shopId: string;
  actorId: string;
  submissionId: string;
  amount: number;
  mode: "Cash" | "UPI" | "Bank transfer" | "Credit";
  status: string;
  reference: string;
  note: string;
  collectedAt: string;
  postedAmount?: number;
  currentReceiptAmount?: number;
  sourceIssue?: string;
  allocations?: Array<{ invoiceId: string; amount: number }>;
  unallocated?: number;
  receiptIds?: string[];
}
export interface CloudRequest {
  routeId?: string; routeName?: string; routeDays?: number[]; routeStopId?: string | null; routeStopName?: string | null;
  id: string;
  sourceInvoiceId: string;
  sourceCustomerId: string;
  invoiceNumber: string;
  customerName: string;
  shopId: string;
  sourceRevision: number;
  scheduledDate: string;
  address: string;
  contact: string;
  packages: number;
  instructions: string;
  active: boolean;
  sourceIssue?: string;
  tripId: string | null;
}
export interface CloudSnapshot {
  identity: ConnectedIdentity;
  customers: Array<{
    id: string;
    name: string;
    phone: string;
    area: string;
    invoices: Array<{
      id: string;
      number: string;
      date: string;
      due: string;
      amount: number;
      outstanding: number;
      shopId: string | null;
      opening: boolean;
    }>;
  }>;
  requests: CloudRequest[];
  trips: Array<
    {routeTemplateId?: string} & Pick<
      Trip,
      | "id"
      | "name"
      | "date"
      | "startShopId"
      | "endShopId"
      | "vehicleId"
      | "primaryDriverId"
      | "companionId"
      | "status"
      | "openingAdvance"
      | "revision"
    > & {
      stops: Array<{
        id: string;
        kind: "Delivery" | "Collection" | "Sales visit";
        customerId: string;
        jobId: string | null;
        completed: boolean;
      }>;
      vehicle?: AppState["vehicles"][number];
      closedAt?: string;
      closureReview?: { opening: number; closing: number; note: string };
    }
  >;
  claims: CloudClaim[];
  drivers: User[];
  serverAt: string;
}
const cid = (id: string) => `cis-customer:${id}`;
const iid = (id: string) => `cis-invoice:${id}`;
const jid = (id: string) => `cis-job:${id}`;
function upsert<T extends { id: string }>(rows: T[], value: T) {
  const index = rows.findIndex((x) => x.id === value.id);
  if (index < 0) rows.push(value);
  else rows[index] = value;
}
/** Merge only explicit source IDs; never match customers by name or replay demo receipts. */
export function mergeCloudSnapshot(s: AppState, cloud: CloudSnapshot) {
  const identity = cloud.identity;
  upsert(s.users, {
    id: identity.actorId,
    name: identity.name,
    role: identity.role,
    phone: "",
    shopIds: identity.shopIds,
    active: true,
  });
  for (const driver of cloud.drivers) upsert(s.users, driver);
  const conflicts: string[] = [];
  for (const c of cloud.customers) {
    const old = s.customers.find((x) => x.id === cid(c.id));
    upsert(s.customers, {
      id: cid(c.id),
      externalId: c.id,
      name: c.name,
      phone: c.phone,
      alternate: old?.alternate ?? "",
      address: old?.address ?? "",
      area: c.area,
      landmark: old?.landmark ?? "",
      pin: old?.pin ?? "",
      instructions: old?.instructions ?? "",
      active: true,
    });
    for (const i of c.invoices) {
      // Legacy opening balances may have no shop. Scope them to this authorised customer's delivery shop for local display only.
      const scope =
        i.shopId ||
        cloud.requests.find((r) => r.sourceCustomerId === c.id)?.shopId ||
        cloud.trips.find((t) => t.stops.some((st) => st.customerId === c.id))
          ?.startShopId;
      if (!scope) {
        conflicts.push(`Invoice ${i.number}: source shop requires review`);
        continue;
      }
      upsert(s.invoices, {
        id: iid(i.id),
        externalId: i.id,
        openingBalance: i.opening,
        number: i.number,
        customerId: cid(c.id),
        shopId: scope,
        date: i.date,
        amount: i.amount,
        outstanding: i.outstanding,
        due: i.due,
        notes:
          "CISapp reference snapshot. Current financial authority: CISapp.",
      });
    }
  }
  for (const r of cloud.requests) {
    if (!s.invoices.some((i) => i.id === iid(r.sourceInvoiceId))) continue;
    const old = s.jobs.find((j) => j.id === jid(r.id));
    if(old?.purgedAt)continue; // Never recreate expired Dispatch details from unchanged CISapp projections.
    const sourceChanged =
      old &&
      (old.customerId !== cid(r.sourceCustomerId) ||
        old.shopId !== r.shopId ||
        (old.tripId &&
          (old.address !== r.address || old.packages !== r.packages || old.routeId !== r.routeId || old.routeStopId !== r.routeStopId)));
    if (r.sourceIssue || sourceChanged) {
      if (old)
        old.sourceBlocked =
          r.sourceIssue ||
          "Source delivery details changed; contact manager before proceeding";
      conflicts.push(
        `Delivery ${r.invoiceNumber}: ${r.sourceIssue || "source details changed after assignment; review required"}`,
      );
      continue;
    }
    if (old)
      old.sourceBlocked = r.active
        ? undefined
        : "Source invoice delivery request is inactive; manager review required";
    if (!old)
      s.jobs.push({
        id: jid(r.id),
        invoiceId: iid(r.sourceInvoiceId),
        customerId: cid(r.sourceCustomerId),
        shopId: r.shopId,
        date: r.scheduledDate,
        address: r.address,
        phone: r.contact,
        packages: r.packages,
        remaining: r.packages,
        description: "",
        instructions: r.instructions,
        routeId:r.routeId,routeName:r.routeName,routeDays:r.routeDays,routeStopId:r.routeStopId,routeStopName:r.routeStopName,
        priority: "Normal",
        status: !r.active ? "Cancelled" : r.tripId ? "Assigned" : "Ready",
        tripId: r.tripId ?? null,
        revision: r.sourceRevision,
        createdAt: now(),
        returnsReconciled: true,
      });
    else if (!r.active) {
      if (
        ["Delivered", "Partial", "Failed", "Returned pending"].includes(
          old.status,
        )
      )
        conflicts.push(
          `Delivery ${r.invoiceNumber}: source removed/cancelled; retain completed history`,
        );
      else old.status = "Cancelled";
    } else {
      old.date = r.scheduledDate;
      if (!old.tripId) {
        old.address = r.address;
        old.phone = r.contact;
        old.packages = r.packages;
        old.remaining = r.packages;
        old.instructions = r.instructions;
        old.routeId=r.routeId;old.routeName=r.routeName;old.routeDays=r.routeDays;old.routeStopId=r.routeStopId;old.routeStopName=r.routeStopName;
      }
    }
  }
  for (const t of cloud.trips) {
    const old = s.trips.find((x) => x.id === t.id);
    if (old) {
      if (t.status === "Closed" && old.status !== "Closed")
        conflicts.push(
          `Route ${t.name}: server assignment was closed; reconcile retained offline progress before further submissions`,
        );
      if (t.revision > old.revision) {
        const mappedStops = t.stops.map((st) => ({
          ...st,
          customerId: cid(st.customerId),
          jobId: st.jobId ? jid(st.jobId) : null,
        }));
        const complete = mappedStops.every(
          (st) =>
            s.customers.some((c) => c.id === st.customerId) &&
            (!st.jobId || s.jobs.some((j) => j.id === st.jobId)),
        );
        if (old.status === "Released" && !old.startedAt && complete) {
          for (const j of s.jobs.filter(
            (j) =>
              j.tripId === old.id &&
              !mappedStops.some((st) => st.jobId === j.id),
          )) {
            j.tripId = null;
            if (j.status === "Assigned") j.status = "Ready";
          }
          Object.assign(old, {
            routeTemplateId: t.routeTemplateId,
            name: t.name,
            date: t.date,
            startShopId: t.startShopId,
            endShopId: t.endShopId,
            vehicleId: t.vehicleId,
            primaryDriverId: t.primaryDriverId,
            companionId: t.companionId,
            stops: mappedStops,
            revision: t.revision,
          });
          for (const st of mappedStops)
            if (st.jobId) {
              const job = s.jobs.find((j) => j.id === st.jobId)!;
              job.tripId = old.id;
              if (job.status === "Ready") job.status = "Assigned";
            }
        } else {
          conflicts.push(
            `Route ${t.name}: changed after local departure; manager review required`,
          );
          for (const job of s.jobs.filter((j) => j.tripId === old.id))
            job.sourceBlocked =
              "Route changed after departure; contact manager";
        }
      }
      continue; // Offline progress is never overwritten by a route snapshot.
    }
    if (!s.users.some((u) => u.id === t.primaryDriverId))
      s.users.push({
        id: t.primaryDriverId,
        name: "Assigned driver",
        role: "DRIVER",
        phone: "",
        shopIds: [t.startShopId],
        active: true,
      });
    if (t.vehicle?.id === t.vehicleId) upsert(s.vehicles, t.vehicle);
    else if (!s.vehicles.some((v) => v.id === t.vehicleId))
      s.vehicles.push({
        id: t.vehicleId,
        registration: "Assigned delivery vehicle",
        type: "Delivery van",
        fuelType: "Diesel",
        expectedMileage: 15,
        baseline: 0,
        homeShopId: t.startShopId,
        active: true,
      });
    const stops = t.stops.map((st) => ({
      ...st,
      customerId: cid(st.customerId),
      jobId: st.jobId ? jid(st.jobId) : null,
    }));
    if (
      stops.some(
        (st) =>
          !s.customers.some((c) => c.id === st.customerId) ||
          (st.jobId && !s.jobs.some((j) => j.id === st.jobId)),
      )
    ) {
      conflicts.push(`Route ${t.name}: incomplete source references`);
      continue;
    }
    s.trips.push({
      ...t,
      stops,
      opening: t.closureReview?.opening ?? null,
      closing: t.closureReview?.closing ?? null,
      openingPhoto: null,
      closingPhoto: null,
      openingNote: "",
      endNote: "",
      startedAt: null,
      endedAt: t.closedAt ?? null,
      loaded: false,
      returnConfirmed: false,
      approvedOdometer: t.status === "Closed" && !!t.closureReview,
      cashReceived: 0,
      handoverConfirmed: false,
      cashExplanation: "",
      exceptions: [],
    });
    for (const st of stops)
      if (st.jobId) {
        const j = s.jobs.find((j) => j.id === st.jobId)!;
        j.tripId = t.id;
        if (j.status === "Ready") j.status = "Assigned";
      }
  }
  const links = s.integration?.collectionLinks ?? {};
  for (const claim of cloud.claims) {
    let local = s.collections.find(
      (c) =>
        c.id === claim.localId &&
        c.submissionId === claim.submissionId &&
        c.driverId === claim.actorId,
    );
    if (!local)
      local = s.collections.find(
        (c) => c.id === "cloud-collection:" + claim.id,
      );
    if (!local) {
      if (
        !s.customers.some((c) => c.id === cid(claim.customerId)) ||
        !s.trips.some((t) => t.id === claim.tripId)
      )
        continue;
      local = {
        id: "cloud-collection:" + claim.id,
        submissionId: claim.submissionId,
        tripId: claim.tripId,
        customerId: cid(claim.customerId),
        shopId: claim.shopId,
        driverId: claim.actorId,
        invoiceIds: s.invoices
          .filter((i) => i.customerId === cid(claim.customerId))
          .map((i) => i.id),
        amount: claim.amount,
        mode: claim.mode,
        reference: claim.reference,
        note: claim.note,
        evidenceId: null,
        status: "Pending",
        allocations: [],
        unallocated: claim.amount,
        createdAt: claim.collectedAt,
        approvedAt: null,
        approvalId: null,
        reviewNote: "",
        digitalVerified: false,
      };
      s.collections.push(local);
    }
    if (claim.sourceIssue) conflicts.push(claim.sourceIssue);
    links[local.id] = {
      cloudId: claim.id,
      status: claim.status,
      postedAmount: claim.currentReceiptAmount ?? claim.postedAmount ?? 0,
      receiptIds: claim.receiptIds ?? [],
      unallocated: claim.unallocated ?? claim.amount,
    };
    if (claim.status === "Posted" || claim.status === "Credit authorised") {
      local.status = "Approved";
      local.allocations = (claim.allocations ?? [])
        .map((a) => ({ invoiceId: iid(a.invoiceId), amount: a.amount }))
        .filter((a) => s.invoices.some((i) => i.id === a.invoiceId));
      local.approvedAt ??= cloud.serverAt;
      local.unallocated = claim.unallocated ?? 0;
      local.reviewNote = "Verified by CISapp trusted approval operation";
    }
    if (claim.status === "Rejected") {
      local.status = "Rejected";
      local.reviewNote =
        "Rejected by CISapp manager; physical cash still requires reconciliation";
    }
  }
  s.integration = {
    lastPull: cloud.serverAt,
    identityKey: `${identity.issuer}:${identity.uid}`,
    collectionLinks: links,
    publishedTripIds: [
      ...new Set([
        ...(s.integration?.publishedTripIds ?? []),
        ...cloud.trips.map((t) => t.id),
      ]),
    ],
    conflicts,
  };
}
