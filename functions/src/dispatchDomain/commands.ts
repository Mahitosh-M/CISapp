import type {
  AppState,
  User,
  Shop,
  Vehicle,
  Customer,
  InvoiceReference,
  DeliveryJob,
  Trip,
  Stop,
  Collection,
  Allocation,
  Fuel,
  SalesRequest,
} from "./domain";
import { uuid, now, activeJob, fuelBill } from "./domain";
import {
  assert,
  integer,
  positive,
  dateOnly,
  manager,
  driver,
  find,
  editableTrip,
  allocateOldest,
  audit,
  cashSummary,
  fuelSource,
  advanceRemaining,
  approvedReadings,
} from "./rules";
function wholeAmount(value: number, label: string, min = 0) {
  integer(value, label, min);
  assert(value % 100 === 0, label + ' must be a whole rupee amount');
}
export type Command =
  | {
      type: "saveMaster";
      kind: "shops" | "vehicles" | "users";
      value: Shop | Vehicle | User;
    }
  | { type: "saveCustomer"; value: Customer }
  | { type: "createInvoice"; value: InvoiceReference }
  | { type: "createJob"; value: DeliveryJob }
  | {
      type: "jobAction";
      id: string;
      action: "Ready" | "Cancel" | "Reschedule" | "Reconcile returns";
      date?: string;
      note: string;
    }
  | { type: "saveTrip"; value: Trip }
  | {
      type: "routeAction";
      id: string;
      action: "Release" | "Cancel";
      note: string;
    }
  | {
      type: "changeDriver";
      id: string;
      driverId: string;
      companionId: string | null;
      note: string;
    }
  | {
      type: "startTrip";
      id: string;
      opening: number;
      photo: string | null;
      note: string;
    }
  | { type: "load"; id: string }
  | { type: "arrive"; tripId: string; stopId: string }
  | { type: "visitDone"; tripId: string; stopId: string }
  | {
      type: "delivery";
      id: string;
      outcome: "Delivered" | "Partial" | "Failed" | "Reschedule requested";
      delivered: number;
      reason: string;
      note: string;
      evidenceId: string | null;
      location?: string;
    }
  | { type: "submitCollection"; value: Collection }
  | {
      type: "reviewCollection";
      id: string;
      approve: boolean;
      approvalId: string;
      allocations: Allocation[];
      note: string;
      digitalVerified: boolean;
    }
  | { type: "submitFuel"; value: Fuel }
  | {
      type: "reviewFuel";
      id: string;
      action: "Approve" | "Approve & reimburse" | "Reject" | "Clarification" | "Settle";
      note: string;
    }
  | { type: "submitSales"; value: SalesRequest }
  | {
      type: "reviewSales";
      id: string;
      status: SalesRequest["status"];
      note: string;
    }
  | {
      type: "endTrip";
      id: string;
      closing: number;
      photo: string | null;
      returns?: boolean;
      note: string;
    }
  | { type: "handover"; id: string; amount: number; note: string }
  | { type: "exception"; id: string; note: string }
  | { type: "closeTrip"; id: string; note: string }
  | { type: "fuelTolerance"; value: number }
  | {
      type: "correctOdometer";
      id: string;
      opening: number;
      closing: number;
      note: string;
    };
export function applyCommand(
  s: AppState,
  actor: User,
  c: Command,
  hasEvidence: (id: string | null) => boolean,
): void {
  assert(actor.active, "This account is inactive");
  switch (c.type) {
    case "saveMaster": {
      assert(actor.role === "ADMIN", "Admin access required");
      const v = c.value;
      assert(
        v.id.trim() && ("name" in v ? v.name.trim() : v.registration.trim()),
        "ID and name / registration are required",
      );
      const existing = (s[c.kind] as (Shop | Vehicle | User)[]).find(
        (x) => x.id === v.id,
      );
      if (c.kind === "vehicles") {
        const x = v as Vehicle;
        positive(x.expectedMileage, "Expected mileage");
        integer(x.baseline, "Odometer baseline");
        find(s.shops, x.homeShopId, "Home shop");
        if (existing) {
          const previous = existing as Vehicle;
          assert(
            !s.trips.some(
              (t) =>
                t.vehicleId === x.id &&
                ["Active", "End submitted"].includes(t.status),
            ) || x.active,
            "An active vehicle cannot be disabled during a shift",
          );
          assert(
            x.baseline === previous.baseline ||
              !s.trips.some((t) => t.vehicleId === x.id),
            "Use reviewed odometer records once vehicle history exists",
          );
        }
      }
      if (c.kind === "users") {
        const x = v as User;
        assert(["ADMIN", "MANAGER", "DRIVER"].includes(x.role), "Invalid role");
        assert(x.shopIds.length > 0, "Select authorised shops");
        x.shopIds.forEach((id) => find(s.shops, id));
        if (existing) {
          assert(
            !s.trips.some(
              (t) =>
                [t.primaryDriverId, t.companionId].includes(x.id) &&
                ["Released", "Active", "End submitted"].includes(t.status),
            ) ||
              (x.active && x.role === "DRIVER"),
            "Resolve assigned trips before changing this driver",
          );
          assert(
            x.id !== actor.id || (x.role === "ADMIN" && x.active),
            "Cannot remove your own Admin access",
          );
        }
      }
      if (c.kind === "shops") {
        const x = v as Shop;
        if (x.lat !== undefined || x.lng !== undefined)
          assert(
            Number.isFinite(x.lat) &&
              Number.isFinite(x.lng) &&
              Math.abs(x.lat!) <= 90 &&
              Math.abs(x.lng!) <= 180,
            "Valid coordinate pair required",
          );
      }
      const table = s[c.kind] as (Shop | Vehicle | User)[];
      audit(
        s,
        actor,
        c.kind,
        v.id,
        existing ? "Master updated" : "Master created",
        existing ?? null,
        v,
      );
      if (existing) table[table.findIndex((x) => x.id === v.id)] = v;
      else table.push(v);
      break;
    }
    case "saveCustomer": {
      assert(actor.role !== "DRIVER", "Manager access required");
      const v = c.value;
      assert(
        v.name.trim() && v.address.trim() && v.phone.trim(),
        "Customer name, address and phone are required",
      );
      if (v.lat !== undefined || v.lng !== undefined)
        assert(
          Number.isFinite(v.lat) &&
            Number.isFinite(v.lng) &&
            Math.abs(v.lat!) <= 90 &&
            Math.abs(v.lng!) <= 180,
          "Valid coordinate pair required",
        );
      const old = s.customers.find((x) => x.id === v.id);
      if (old) {
        const shops = s.invoices
          .filter((i) => i.customerId === old.id)
          .map((i) => i.shopId);
        assert(
          actor.role === "ADMIN" ||
            shops.length === 0 ||
            shops.every((id) => actor.shopIds.includes(id)),
          "Cross-shop customer changes require Admin",
        );
      }
      audit(s, actor, "customer", v.id, "Customer saved", old ?? null, v);
      if (old) s.customers[s.customers.indexOf(old)] = v;
      else s.customers.push(v);
      break;
    }
    case "createInvoice": {
      const v = c.value;
      manager(actor, v.shopId);
      assert(find(s.shops, v.shopId).active, "Shop is inactive");
      assert(find(s.customers, v.customerId).active, "Customer is inactive");
      assert(
        !s.invoices.some((i) => i.id === v.id),
        "Reference already exists",
      );
      assert(v.number.trim(), "Invoice reference required");
      wholeAmount(v.amount, "Reference value", 1);
      wholeAmount(v.outstanding, "Outstanding");
      assert(
        v.outstanding <= v.amount,
        "Outstanding cannot exceed reference amount",
      );
      dateOnly(v.date);
      dateOnly(v.due);
      s.invoices.push(v);
      audit(
        s,
        actor,
        "invoiceReference",
        v.id,
        "Local reference created",
        null,
        v,
      );
      break;
    }
    case "createJob": {
      const v = c.value;
      const inv = find(s.invoices, v.invoiceId, "Invoice reference");
      assert(
        !inv.openingBalance,
        "Opening balances are collection references, not delivery invoices",
      );
      manager(actor, inv.shopId);
      assert(
        inv.customerId === v.customerId && inv.shopId === v.shopId,
        "Invoice, customer and shop must match",
      );
      assert(
        !s.jobs.some(
          (j) => j.id === v.id || (j.invoiceId === v.invoiceId && activeJob(j)),
        ),
        "An active delivery already exists for this reference",
      );
      integer(v.packages, "Packages", 1);
      assert(
        v.address.trim() && v.phone.trim(),
        "Delivery address and contact required",
      );
      dateOnly(v.date);
      v.remaining = v.packages;
      v.tripId = null;
      v.status = "Ready";
      v.revision = 1;
      v.returnsReconciled = true;
      s.jobs.push(v);
      audit(s, actor, "delivery", v.id, "Delivery created", null, v);
      break;
    }
    case "jobAction": {
      const j = find(s.jobs, c.id);
      manager(actor, j.shopId);
      const before = { ...j };
      assert(c.note.trim(), "A reason is required");
      if (c.action === "Cancel") {
        assert(
          !["Delivered", "Cancelled"].includes(j.status),
          "Cannot cancel a terminal job",
        );
        if (j.tripId)
          assert(
            !["Active", "End submitted"].includes(
              find(s.trips, j.tripId).status,
            ),
            "Resolve active trip before cancellation",
          );
        j.status = "Cancelled";
        if (j.tripId) {
          const t = find(s.trips, j.tripId);
          t.stops = t.stops.filter((st) => st.jobId !== j.id);
          audit(
            s,
            actor,
            "trip",
            t.id,
            "Cancelled job removed from route",
            j.id,
            c.note,
          );
        }
        j.tripId = null;
      } else if (c.action === "Reschedule") {
        assert(
          [
            "Failed",
            "Partial",
            "Returned pending",
            "Ready",
            "Pending",
          ].includes(j.status),
          "Only undelivered packages can be rescheduled",
        );
        assert(j.remaining > 0, "No packages remaining");
        assert(
          j.returnsReconciled,
          "Reconcile returned / undelivered packages first",
        );
        if (j.tripId)
          assert(
            !["Active", "End submitted"].includes(
              find(s.trips, j.tripId).status,
            ),
            "Complete the current shift before rescheduling",
          );
        assert(c.date, "Date required");
        dateOnly(c.date);
        j.date = c.date;
        j.status = "Ready";
        j.tripId = null;
      } else if (c.action === "Reconcile returns") {
        assert(
          ["Failed", "Partial", "Returned pending"].includes(j.status),
          "No returns awaiting reconciliation",
        );
        j.returnsReconciled = true;
      } else {
        assert(j.status === "Pending", "Only pending jobs can become ready");
        j.status = "Ready";
      }
      j.revision++;
      audit(s, actor, "delivery", j.id, c.action, before, {
        ...j,
        reason: c.note,
      });
      break;
    }
    case "saveTrip": {
      const v = c.value;
      manager(actor, v.startShopId);
      const old = s.trips.find((t) => t.id === v.id);
      if (old) {
        editableTrip(old);
        assert(
          old.revision === v.revision,
          "Route changed. Reopen before saving.",
        );
      }
      find(s.shops, v.endShopId, "Ending shop");
      assert(find(s.vehicles, v.vehicleId).active, "Vehicle inactive");
      const primary = find(s.users, v.primaryDriverId, "Primary driver");
      assert(
        primary.active &&
          primary.role === "DRIVER" &&
          primary.shopIds.includes(v.startShopId),
        "Select an active driver authorised for starting shop",
      );
      if (v.companionId) {
        const companion = find(s.users, v.companionId);
        assert(
          companion.active &&
            companion.role === "DRIVER" &&
            companion.id !== primary.id &&
            companion.shopIds.includes(v.startShopId),
          "Accompanying driver must be different and authorised",
        );
      }
      dateOnly(v.date);
      assert(
        v.name.trim() && v.stops.length > 0,
        "Route name and at least one stop required",
      );
      wholeAmount(v.openingAdvance, "Cash advance");
      const jobIds = new Set<string>();
      for (const stop of v.stops) {
        assert(find(s.customers, stop.customerId).active, "Customer inactive");
        if (stop.kind === "Delivery") {
          assert(stop.jobId, "Delivery job required");
          const j = find(s.jobs, stop.jobId);
          manager(actor, j.shopId);
          assert(!jobIds.has(j.id), "Duplicate job in route");
          jobIds.add(j.id);
          assert(
            j.status === "Ready" ||
              (j.tripId === v.id && j.status === "Assigned"),
            "Job is not available",
          );
          assert(
            !j.tripId || j.tripId === v.id,
            "Job already assigned to another route",
          );
          assert(j.date === v.date, "Delivery schedule must match trip date");
        }
      }
      if (old)
        for (const st of old.stops)
          if (st.jobId && !jobIds.has(st.jobId)) {
            const j = find(s.jobs, st.jobId);
            j.tripId = null;
            j.status = "Ready";
            j.revision++;
          }
      for (const id of jobIds) {
        const j = find(s.jobs, id);
        j.tripId = v.id;
        j.status = "Assigned";
        j.revision++;
      }
      v.revision = (old?.revision ?? 0) + 1;
      v.status = old?.status ?? "Draft";
      audit(s, actor, "trip", v.id, "Route saved", old ?? null, v);
      if (old) s.trips[s.trips.indexOf(old)] = v;
      else s.trips.push(v);
      break;
    }
    case "routeAction": {
      const t = find(s.trips, c.id);
      manager(actor, t.startShopId);
      editableTrip(t);
      assert(c.note.trim(), "Reason required");
      const before = { ...t };
      if (c.action === "Release") {
        assert(t.status === "Draft", "Already released");
        assert(t.stops.length, "Route has no stops");
        t.status = "Released";
      } else {
        t.status = "Cancelled";
        for (const stop of t.stops)
          if (stop.jobId) {
            const j = find(s.jobs, stop.jobId);
            j.tripId = null;
            j.status = "Ready";
            j.revision++;
          }
      }
      t.revision++;
      audit(s, actor, "trip", t.id, c.action, before, { ...t, note: c.note });
      break;
    }
    case "changeDriver": {
      const t = find(s.trips, c.id);
      manager(actor, t.startShopId);
      assert(
        !["Closed", "Cancelled", "End submitted"].includes(t.status),
        "Driver cannot change in this trip state",
      );
      assert(
        c.note.trim(),
        "Record responsibility and cash custody handover note",
      );
      const d = find(s.users, c.driverId);
      assert(
        d.active && d.role === "DRIVER" && d.shopIds.includes(t.startShopId),
        "Driver is not authorised",
      );
      assert(
        !s.trips.some(
          (x) =>
            x.id !== t.id &&
            ["Active", "End submitted"].includes(x.status) &&
            [x.primaryDriverId, x.companionId].includes(d.id),
        ),
        "Driver has another active shift",
      );
      if (c.companionId) {
        const companion = find(s.users, c.companionId);
        assert(
          companion.active &&
            companion.role === "DRIVER" &&
            companion.id !== d.id &&
            companion.shopIds.includes(t.startShopId),
          "Invalid accompanying driver",
        );
        assert(
          !s.trips.some(
            (x) =>
              x.id !== t.id &&
              ["Active", "End submitted"].includes(x.status) &&
              [x.primaryDriverId, x.companionId].includes(companion.id),
          ),
          "Companion has another active shift",
        );
      }
      const before = {
        primary: t.primaryDriverId,
        companion: t.companionId,
        cash: cashSummary(s, t),
      };
      t.primaryDriverId = d.id;
      t.companionId = c.companionId;
      t.revision++;
      audit(s, actor, "trip", t.id, "Driver / cash custody handover", before, {
        primary: d.id,
        companion: c.companionId,
        note: c.note,
      });
      break;
    }
    case "startTrip": {
      const t = find(s.trips, c.id);
      driver(actor, t);
      assert(
        t.status === "Released",
        "Trip must be released and not already started",
      );
      assert(
        actor.id === t.primaryDriverId,
        "Primary responsible driver must start the shift",
      );
      integer(c.opening, "Opening odometer");
      assert(
        !s.trips.some(
          (x) =>
            x.id !== t.id &&
            x.vehicleId === t.vehicleId &&
            ["Active", "End submitted"].includes(x.status),
        ),
        "Vehicle already has an active shift",
      );
      for (const id of [t.primaryDriverId, t.companionId].filter(Boolean))
        assert(
          !s.trips.some(
            (x) =>
              x.id !== t.id &&
              ["Active", "End submitted"].includes(x.status) &&
              [x.primaryDriverId, x.companionId].includes(id),
          ),
          "A driver already has an active shift",
        );
      const prev = s.trips
        .filter(
          (x) =>
            x.vehicleId === t.vehicleId &&
            x.status === "Closed" &&
            x.closing !== null,
        )
        .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))[0];
      const baseline =
        (prev ? approvedReadings(prev).closing : null) ??
        find(s.vehicles, t.vehicleId).baseline;
      assert(
        c.opening >= baseline,
        "Opening reading cannot go below the previous closing / baseline; request manager correction",
      );
      if (c.opening !== baseline)
        assert(c.note.trim(), "Explain odometer continuity difference");
      assert(
        hasEvidence(c.photo) ||
          t.exceptions.some((x) => x.startsWith("Opening photo:")),
        "Opening photograph required, or manager Opening photo exception",
      );
      t.opening = c.opening;
      t.openingPhoto = c.photo;
      t.openingNote = c.note;
      t.status = "Active";
      t.startedAt = now();
      audit(s, actor, "trip", t.id, "Trip started", null, {
        opening: c.opening,
        note: c.note,
      });
      break;
    }
    case "load": {
      const t = find(s.trips, c.id);
      driver(actor, t);
      assert(t.status === "Active", "Start shift before loading");
      assert(!t.loaded, "Packages already confirmed");
      const jobs = t.stops.filter(stop=>!!stop.jobId).map(stop=>s.jobs.find(job=>job.id===stop.jobId));
      assert(jobs.every(Boolean), "Assigned delivery details are missing. Open Connection & pending work and synchronise before confirming packages loaded.");
      t.loaded = true;
      for (const job of jobs) job!.status = "Out for delivery";
      audit(s, actor, "trip", t.id, "Packages loaded", false, true);
      break;
    }
    case "arrive":
    case "visitDone": {
      const t = find(s.trips, c.tripId);
      driver(actor, t);
      assert(t.status === "Active" && t.loaded, "Active loaded trip required");
      const stop = find(t.stops, c.stopId);
      assert(!stop.completed, "Stop already completed");
      if (c.type === "arrive") {
        assert(!stop.arrivedAt, "Arrival already recorded");
        stop.arrivedAt = now();
      } else {
        assert(stop.kind !== "Delivery", "Record a delivery outcome instead");
        stop.completed = true;
      }
      audit(s, actor, "stop", stop.id, c.type, null, stop);
      break;
    }
    case "delivery": {
      const j = find(s.jobs, c.id);
      assert(
        !j.sourceBlocked,
        j.sourceBlocked || "Source delivery needs manager review",
      );
      assert(
        j.status !== "Cancelled",
        "Delivery was cancelled; refresh and request manager review",
      );
      assert(j.tripId, "Job not assigned");
      const t = find(s.trips, j.tripId);
      driver(actor, t);
      assert(
        t.status === "Active" && t.loaded,
        "Start shift and confirm loading first",
      );
      const stop = t.stops.find((x) => x.jobId === j.id);
      assert(stop && !stop.completed, "Delivery attempt already completed");
      integer(c.delivered, "Delivered packages");
      assert(
        c.delivered <= j.remaining,
        "Cannot deliver more packages than remaining",
      );
      if (c.outcome === "Delivered")
        assert(
          c.delivered === j.remaining,
          "Delivered outcome must include all remaining packages",
        );
      if (c.outcome === "Partial")
        assert(
          c.delivered > 0 && c.delivered < j.remaining,
          "Partial delivery requires some packages remaining",
        );
      if (["Failed", "Reschedule requested"].includes(c.outcome))
        assert(
          c.delivered === 0 && c.reason.trim(),
          "Failure / reschedule requires reason and zero delivered packages",
        );
      if (c.reason === "Other")
        assert(c.note.trim(), "Other reason requires a note");
      if (c.delivered > 0)
        assert(
          hasEvidence(c.evidenceId) ||
            t.exceptions.some((x) => x.startsWith(`Proof ${j.id}:`)),
          "Signature / acknowledgement photo required, or manager proof exception",
        );
      const before = { ...j };
      j.remaining -= c.delivered;
      j.status =
        c.outcome === "Reschedule requested" ? "Returned pending" : c.outcome;
      j.returnsReconciled = j.remaining === 0;
      j.revision++;
      stop.completed = true;
      s.attempts.push({
        id: uuid(),
        jobId: j.id,
        tripId: t.id,
        actorId: actor.id,
        at: now(),
        outcome: c.outcome,
        delivered: c.delivered,
        reason: c.reason,
        note: c.note,
        evidenceId: c.evidenceId,
        location: c.location,
      });
      audit(s, actor, "delivery", j.id, `Delivery ${c.outcome}`, before, j);
      break;
    }
    case "submitCollection": {
      const v = c.value;
      const t = find(s.trips, v.tripId);
      driver(actor, t);
      assert(
        t.status === "Active",
        "Record collections during an active shift",
      );
      assert(
        t.stops.some((st) => st.customerId === v.customerId),
        "Customer is not assigned to this trip",
      );
      assert(!t.handoverConfirmed, "Cash handover already confirmed");
      if (s.collections.some((x) => x.submissionId === v.submissionId)) break;
      assert(
        v.driverId === actor.id && v.id === v.submissionId,
        "Invalid submission identity",
      );
      managerScope(s, t, v.shopId);
      assert(
        ["Cash", "UPI", "Bank transfer", "Credit"].includes(v.mode),
        "Invalid mode",
      );
      wholeAmount(v.amount, "Amount");
      assert(v.invoiceIds.length > 0, "Select invoice references");
      for (const id of v.invoiceIds) {
        const inv = find(s.invoices, id);
        assert(
          inv.customerId === v.customerId && inv.shopId === v.shopId,
          "Selected references must belong to this customer and shop",
        );
      }
      if (v.mode === "Credit")
        assert(
          v.amount === 0 && v.note.trim(),
          "Credit is no collection: zero amount and authorisation note required",
        );
      else assert(v.amount > 0, "Collection amount must be positive");
      if (["UPI", "Bank transfer"].includes(v.mode))
        assert(v.reference.trim(), "Digital payment reference required");
      if (v.evidenceId) assert(hasEvidence(v.evidenceId), "Evidence not found");
      v.status = "Pending";
      v.allocations = [];
      v.unallocated = v.amount;
      v.approvalId = null;
      v.approvedAt = null;
      v.digitalVerified = false;
      s.collections.push(v);
      audit(s, actor, "collection", v.id, "Collection recorded", null, {
        ...v,
      });
      break;
    }
    case "reviewCollection": {
      const v = find(s.collections, c.id);
      assert(
        !s.invoices.some(
          (i) =>
            i.customerId === v.customerId && i.id.startsWith("cis-invoice:"),
        ),
        "Connected collections must be reviewed and posted through CISapp Dispatch, not local approval",
      );
      manager(actor, v.shopId);
      assert(c.approvalId.trim(), "Approval operation ID required");
      assert(
        !s.collections.some(
          (other) => other.id !== v.id && other.approvalId === c.approvalId,
        ),
        "Approval identifier already used by another submission",
      );
      if (v.status === "Approved" && v.approvalId === c.approvalId) break;
      assert(v.status === "Pending", "Collection has already been reviewed");
      assert(c.note.trim(), "Verification / rejection note required");
      const before = JSON.parse(JSON.stringify(v));
      if (c.approve) {
        if (["UPI", "Bank transfer"].includes(v.mode))
          assert(
            c.digitalVerified,
            "Confirm independent manual verification; a screenshot is insufficient",
          );
        const allocations = v.mode === "Credit" ? [] : c.allocations;
        const seen = new Set<string>();
        let total = 0;
        for (const a of allocations) {
          assert(!seen.has(a.invoiceId), "Duplicate allocation");
          seen.add(a.invoiceId);
          const inv = find(s.invoices, a.invoiceId);
          assert(
            inv.customerId === v.customerId && inv.shopId === v.shopId,
            "Allocation outside authorised customer / shop",
          );
          wholeAmount(a.amount, "Allocation", 1);
          assert(
            a.amount <= inv.outstanding,
            "Balance changed / allocation exceeds latest outstanding",
          );
          total += a.amount;
          wholeAmount(total, "Allocation total");
        }
        assert(total <= v.amount, "Allocations exceed amount received");
        for (const a of allocations)
          find(s.invoices, a.invoiceId).outstanding -= a.amount;
        v.status = "Approved";
        v.allocations = allocations;
        v.unallocated = v.amount - total;
        v.approvedAt = now();
        v.approvalId = c.approvalId;
        v.digitalVerified = c.digitalVerified;
      } else {
        v.status = "Rejected";
        v.allocations = [];
        v.unallocated = v.amount;
      }
      v.reviewNote = c.note;
      audit(
        s,
        actor,
        "collection",
        v.id,
        c.approve ? "Collection approved locally" : "Collection rejected",
        before,
        v,
      );
      break;
    }
    case "submitFuel": {
      const v = c.value;
      const t = find(s.trips, v.tripId);
      driver(actor, t);
      assert(
        (t.status === "Active" ||
          (t.status === "End submitted" &&
            s.fuels.some(
              (f) => f.id === v.id && f.status === "Clarification",
            ))) &&
          !t.handoverConfirmed,
        "Fuel requires active shift, or a clarification before handover",
      );
      assert(
        v.vehicleId === t.vehicleId &&
          v.driverId === actor.id &&
          v.shopId === t.startShopId,
        "Fuel trip details mismatch",
      );
      const existing = s.fuels.find((x) => x.id === v.id);
      if (existing && existing.status !== "Clarification") break;
      if (existing)
        assert(
          existing.driverId === actor.id && existing.tripId === v.tripId,
          "Claim ownership mismatch",
        );
      wholeAmount(v.amount, "Bill", 100);
      if (v.litres === null && v.rate === null) {
        v.entryMode = "bill_amount";
        v.calculatedAmount = v.amount;
        v.roundingAdjustment = 0;
        v.fullTank = false;
      } else {
        assert(v.litres !== null && v.rate !== null, "Use amount-only entry or provide both calculation inputs");
        positive(v.litres, "Litres");integer(v.rate, "Rate", 1);
        assert(v.amount === fuelBill(v.litres, v.rate), "Litres times rate does not match bill");
        v.entryMode = "quantity_rate";
        v.calculatedAmount = Math.round((Math.round(v.litres * 100) * v.rate) / 100);
        v.roundingAdjustment = v.amount - v.calculatedAmount;
      }
      assert(hasEvidence(v.receiptId), "Receipt photograph required");
      assert(!Number.isNaN(Date.parse(v.at)), "Purchase timestamp required");
      if (v.odometer !== null) {
        integer(v.odometer, "Refuelling odometer");
        assert(
          v.odometer >= (t.opening ?? 0),
          "Refuelling odometer below opening",
        );
      }
      assert(
        ["Shop advance", "Personal"].includes(v.source),
        "Invalid payment source",
      );
      delete v.cashExpenseId;
      delete v.cashPostedAt;
      v.source = fuelSource(s, v);
      if (v.source === "Shop advance")
        assert(v.amount <= advanceRemaining(s, t, v.id), "Not enough shop advance remains. Select Personal funds.");
      v.status = "Submitted";
      v.reimbursement = v.source === "Personal" ? "Pending" : "Not applicable";
      if (existing) s.fuels[s.fuels.indexOf(existing)] = v;
      else s.fuels.push(v);
      audit(
        s,
        actor,
        "fuel",
        v.id,
        existing ? "Fuel clarified and resubmitted" : "Fuel submitted",
        existing ?? null,
        v,
      );
      break;
    }
    case "reviewFuel": {
      const v = find(s.fuels, c.id);
      manager(actor, v.shopId);
      const before = { ...v };
      assert(c.action !== "Clarification" || !find(s.trips, v.tripId).handoverConfirmed, "Request clarification before cash handover; approve or reject this claim now");
      const resolvedSource = fuelSource(s, v);
      if (resolvedSource !== v.source) {
        v.source = resolvedSource;
        v.reimbursement = v.status === "Rejected" ? "Not applicable" : "Pending";
        audit(s, actor, "fuel", v.id, "Unfunded shop claim corrected to personal funds", before, v);
      }
      if (c.action === "Approve & reimburse")
        assert(v.source === "Personal", "Only personal fuel requires reimbursement");
      if (c.action === "Settle") {
        assert(
          v.status === "Approved" &&
            v.source === "Personal" &&
            v.reimbursement === "Pending",
          "Only approved pending reimbursement can settle",
        );
        v.reimbursement = "Settled";
        v.settledAt = now();
      } else {
        assert(
          ["Submitted", "Clarification"].includes(v.status),
          "Expense already reviewed",
        );
        v.status =
          ["Approve", "Approve & reimburse"].includes(c.action)
            ? "Approved"
            : c.action === "Reject"
              ? "Rejected"
              : "Clarification";
        if (v.status === "Rejected") v.reimbursement = "Not applicable";
      }
      if (c.action === "Approve & reimburse") {
        v.reimbursement = "Settled";
        v.settledAt = now();
      }
      v.reviewNote = c.note;
      audit(s, actor, "fuel", v.id, `Fuel ${c.action}`, before, v);
      break;
    }
    case "submitSales": {
      const v = c.value;
      const t = find(s.trips, v.tripId);
      driver(actor, t);
      assert(t.status === "Active", "Sales requests require active trip");
      assert(
        v.driverId === actor.id && v.shopId === t.startShopId,
        "Invalid request identity",
      );
      if (v.customerId)
        assert(
          t.stops.some((st) => st.customerId === v.customerId),
          "Customer not assigned",
        );
      assert(
        (v.customerId || v.leadName.trim()) &&
          v.phone.trim() &&
          v.products.trim(),
        "Customer / lead, contact and requested products required",
      );
      dateOnly(v.date);
      assert(
        !s.salesRequests.some((x) => x.id === v.id),
        "Request already submitted",
      );
      v.status = "Submitted";
      s.salesRequests.push(v);
      audit(s, actor, "salesRequest", v.id, "Sales request submitted", null, v);
      break;
    }
    case "reviewSales": {
      const v = find(s.salesRequests, c.id);
      manager(actor, v.shopId);
      assert(c.note.trim(), "Decision note required");
      const allowed: Record<SalesRequest["status"], SalesRequest["status"][]> =
        {
          Submitted: ["Under review", "Accepted", "Rejected"],
          "Under review": ["Accepted", "Rejected"],
          Accepted: ["Converted externally"],
          Rejected: [],
          "Converted externally": [],
        };
      assert(
        allowed[v.status].includes(c.status),
        "Invalid sales request transition",
      );
      const before = { ...v };
      v.status = c.status;
      v.decision = c.note;
      audit(
        s,
        actor,
        "salesRequest",
        v.id,
        "Sales request reviewed",
        before,
        v,
      );
      break;
    }
    case "endTrip": {
      const t = find(s.trips, c.id);
      driver(actor, t);
      assert(
        actor.id === t.primaryDriverId,
        "Primary driver must submit shift end",
      );
      assert(t.status === "Active", "Shift already ended or not active");
      integer(c.closing, "Closing odometer");
      assert(
        t.opening !== null && c.closing >= t.opening,
        "Closing odometer cannot be below opening",
      );
      assert(
        !s.fuels.some(
          (f) =>
            f.tripId === t.id && f.odometer !== null && f.odometer > c.closing,
        ),
        "Closing reading is below a refuelling reading",
      );
      assert(
        hasEvidence(c.photo) ||
          t.exceptions.some((x) => x.startsWith("Closing photo:")),
        "Closing photo required, or manager Closing photo exception",
      );
      assert(t.loaded, "Confirm packages loaded");
      assert(
        t.stops.every((st) => st.completed) ||
          t.exceptions.some((x) => x.startsWith("Unfinished stops:")),
        "Complete stops or request manager Unfinished stops exception",
      );
      t.closing = c.closing;
      t.closingPhoto = c.photo;
      t.returnConfirmed = !s.jobs.some(j => j.tripId === t.id && !j.returnsReconciled);
      t.endNote = c.note;
      t.endedAt = now();
      t.status = "End submitted";
      audit(s, actor, "trip", t.id, "Shift end submitted", null, {
        closing: c.closing,
        note: c.note,
      });
      break;
    }
    case "handover": {
      const t = find(s.trips, c.id);
      manager(actor, t.startShopId);
      assert(t.status === "End submitted", "Submit end-of-shift report first");
      assert(!t.handoverConfirmed, "Handover already confirmed");
      assert(
        !s.collections.some((x) => x.tripId === t.id && x.status === "Pending"),
        "Review collections before physical handover",
      );
      wholeAmount(c.amount, "Cash physically received");
      const expected = cashSummary(s, t).expected;
      // Confirming the numeric discrepancy records review even without a note.
      t.cashReviewedExpected = expected;
      for (const f of s.fuels.filter(f => f.tripId === t.id)) {
        const source = fuelSource(s, f);
        if (source !== f.source) {
          const before = {...f};
          f.source = source;
          f.reimbursement = f.status === "Rejected" ? "Not applicable" : "Pending";
          audit(s, actor, "fuel", f.id, "Unfunded shop claim corrected to personal funds", before, f);
        }
      }
      t.cashReceived = c.amount;
      t.handoverConfirmed = true;
      t.cashExplanation = c.note;
      audit(
        s,
        actor,
        "trip",
        t.id,
        "Physical cash handover (not a customer receipt)",
        { expected },
        { received: c.amount, difference: c.amount - expected, note: c.note },
      );
      break;
    }
    case "exception": {
      const t = find(s.trips, c.id);
      manager(actor, t.startShopId);
      assert(!["Closed", "Cancelled"].includes(t.status), "Trip is terminal");
      assert(
        /^(Opening photo:|Closing photo:|Unfinished stops:|Proof [^:]+:|Settlement:)/.test(
          c.note,
        ) && c.note.split(":").slice(1).join(":").trim().length >= 5,
        "Use a recognised exception prefix and a meaningful reason",
      );
      t.exceptions.push(`${c.note} [${actor.name}]`);
      audit(s, actor, "trip", t.id, "Manager exception approved", null, c.note);
      break;
    }
    case "closeTrip": {
      const t = find(s.trips, c.id);
      manager(actor, t.startShopId);
      assert(t.status === "End submitted", "Shift is not awaiting closure");
      assert(t.handoverConfirmed, "Confirm physical cash handover");
      assert(
        !s.collections.some((x) => x.tripId === t.id && x.status === "Pending"),
        "Review pending collections",
      );
      assert(
        !s.fuels.some(
          (x) =>
            x.tripId === t.id &&
            ["Submitted", "Clarification"].includes(x.status),
        ),
        "Review pending fuel submissions",
      );
      assert(
        !s.jobs.some((j) => j.tripId === t.id && !j.returnsReconciled),
        "Reconcile returned / undelivered packages",
      );
      assert(
        !s.fuels.some(
          (x) => x.tripId === t.id && x.reimbursement === "Pending",
        ) || t.exceptions.some((x) => x.startsWith("Settlement:")),
        "Settle reimbursement or record Settlement exception",
      );
      assert(
        cashSummary(s, t).difference === 0 ||
          t.cashReviewedExpected === cashSummary(s, t).expected ||
          t.cashExplanation.trim() ||
          t.exceptions.some((x) => x.startsWith("Settlement:")),
        "Review changed cash discrepancy with Settlement exception",
      );
      assert(c.note.trim(), "Manager odometer review note required");
      assert(
        t.opening !== null && t.closing !== null && t.closing >= t.opening,
        "Invalid odometer",
      );
      t.approvedOdometer = true;
      t.returnConfirmed = true;
      t.status = "Closed";
      t.closedAt = now();
      audit(
        s,
        actor,
        "trip",
        t.id,
        "Shift closed and odometer verified",
        null,
        { distance: t.closing - t.opening, note: c.note },
      );
      break;
    }
    case "correctOdometer": {
      const t = find(s.trips, c.id);
      manager(actor, t.startShopId);
      assert(
        t.status === "Closed",
        "Only a closed approved shift can receive an odometer correction",
      );
      integer(c.opening, "Corrected opening");
      integer(c.closing, "Corrected closing");
      assert(
        c.closing >= c.opening && c.note.trim().length >= 5,
        "Valid readings and a meaningful correction reason required",
      );
      const shifts = s.trips
        .filter(
          (x) => x.id !== t.id && x.vehicleId === t.vehicleId && x.startedAt,
        )
        .sort((a, b) => a.startedAt!.localeCompare(b.startedAt!));
      const previous = shifts.filter((x) => x.startedAt! < t.startedAt!).at(-1);
      const next = shifts.find((x) => x.startedAt! > t.startedAt!);
      if (previous)
        assert(
          c.opening >= (approvedReadings(previous).closing ?? 0),
          "Correction conflicts with preceding shift",
        );
      if (next)
        assert(
          c.closing <= (approvedReadings(next).opening ?? Infinity),
          "Correction conflicts with following shift",
        );
      assert(
        !s.fuels.some(
          (f) =>
            f.tripId === t.id &&
            f.odometer !== null &&
            (f.odometer < c.opening || f.odometer > c.closing),
        ),
        "Correction conflicts with recorded fuel odometer",
      );
      const before = approvedReadings(t);
      const correction = {
        id: uuid(),
        opening: c.opening,
        closing: c.closing,
        note: c.note,
        actorId: actor.id,
        at: now(),
      };
      t.corrections ??= [];
      t.corrections.push(correction);
      audit(
        s,
        actor,
        "trip",
        t.id,
        "Approved odometer correction; original readings retained",
        before,
        correction,
      );
      break;
    }
    case "fuelTolerance": {
      assert(actor.role === "ADMIN", "Admin required");
      integer(c.value, "Rounding tolerance");
      const before = s.settings.fuelTolerance;
      s.settings.fuelTolerance = c.value;
      audit(
        s,
        actor,
        "settings",
        "fuelTolerance",
        "Tolerance changed",
        before,
        c.value,
      );
      break;
    }
  }
}
function managerScope(s: AppState, t: Trip, shopId: string) {
  assert(
    shopId === t.startShopId ||
      t.stops.some(
        (st) => st.jobId && find(s.jobs, st.jobId).shopId === shopId,
      ),
    "Shop not represented on trip",
  );
}
export function defaultAllocation(s: AppState, c: Collection) {
  return allocateOldest(
    s,
    c.customerId,
    c.amount,
    s.invoices
      .filter((i) => i.customerId === c.customerId && i.shopId === c.shopId)
      .map((i) => i.id),
  );
}
