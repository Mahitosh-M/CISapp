import type {
  AppState,
  Collection,
  Allocation,
  Trip,
  User,
  DeliveryJob,
  Fuel,
} from "./domain";
import { uuid, now } from "./domain";
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function integer(n: number, label: string, min = 0) {
  assert(
    Number.isSafeInteger(n) && n >= min,
    `${label} must be an integer of at least ${min}`,
  );
}
export function positive(n: number, label: string) {
  assert(Number.isFinite(n) && n > 0, `${label} must be positive`);
}
export function dateOnly(v: string) {
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
    "A valid date is required",
  );
}
export function manager(actor: User, shopId: string) {
  assert(
    actor.active &&
      actor.role !== "DRIVER" &&
      (actor.role === "ADMIN" || actor.shopIds.includes(shopId)),
    "Manager access to this shop is required",
  );
}
export function driver(actor: User, trip: Trip) {
  assert(
    actor.active &&
      actor.role === "DRIVER" &&
      [trip.primaryDriverId, trip.companionId].includes(actor.id),
    "Assigned driver access is required",
  );
}
export function find<T extends { id: string }>(
  items: T[],
  id: string,
  label = "Record",
): T {
  const value = items.find((i) => i.id === id);
  assert(value, `${label} not found`);
  return value;
}
export function editableTrip(t: Trip) {
  assert(
    ["Draft", "Released"].includes(t.status),
    "Route is no longer editable",
  );
}
export function allocateOldest(
  state: AppState,
  customerId: string,
  amount: number,
  invoiceIds?: string[],
): Allocation[] {
  integer(amount, "Amount");
  let remaining = amount;
  return state.invoices
    .filter(
      (i) =>
        i.customerId === customerId &&
        i.outstanding > 0 &&
        (!invoiceIds || invoiceIds.includes(i.id)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .flatMap((i) => {
      const allocated = Math.min(remaining, i.outstanding);
      remaining -= allocated;
      return allocated ? [{ invoiceId: i.id, amount: allocated }] : [];
    });
}
// Unposted open claims with no advance used a misleading legacy default.
// Completed custody and posted history retain their original funding source.
export function fuelSource(s: AppState, f: Fuel): Fuel["source"] {
  const t = s.trips.find(t => t.id === f.tripId);
  return f.source === "Shop advance" && t && t.openingAdvance === 0 &&
    !t.handoverConfirmed && t.status !== "Closed" && !f.cashExpenseId
    ? "Personal" : f.source;
}
export const fuelNeedsReview = (f: Fuel) =>
  ["Submitted", "Clarification"].includes(f.status) ||
  (f.status === "Approved" && f.reimbursement === "Pending");
export function advanceRemaining(s: AppState, t: Trip, excludeId?: string) {
  return t.openingAdvance - s.fuels.filter(f => f.tripId === t.id &&
    f.id !== excludeId && fuelSource(s, f) === "Shop advance")
    .reduce((total, f) => total + f.amount, 0);
}
export function closingSteps(s: AppState, t: Trip) {
  const fuels = s.fuels.filter(f => f.tripId === t.id).sort((a,b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const pendingFuel = fuels.find(fuelNeedsReview);
  const pendingCollections = s.collections.filter(c => c.tripId === t.id && c.status === "Pending").length;
  const returns = s.jobs.filter(j => j.tripId === t.id && !j.returnsReconciled).length;
  return {fuels, pendingFuel, pendingCollections, returns, cashDone: t.handoverConfirmed,
    fuelDone: !pendingFuel, ready: t.handoverConfirmed && !pendingFuel && !pendingCollections && !returns};
}
export function cashSummary(s: AppState, t: Trip) {
  const cash = s.collections
    .filter((c) => c.tripId === t.id && c.mode === "Cash")
    .reduce((n, c) => n + c.amount, 0);
  const spent = s.fuels
    .filter((f) => f.tripId === t.id && fuelSource(s, f) === "Shop advance")
    .reduce((n, f) => n + f.amount, 0);
  return {
    // Review decisions do not reverse reported physical cash movement.
    // Custody remains separate from receipt approval and shared shop funds.
    approvedCash: s.collections
      .filter(
        (c) =>
          c.tripId === t.id && c.mode === "Cash" && c.status === "Approved",
      )
      .reduce(
        (n, c) =>
          n + (s.integration?.collectionLinks[c.id]?.postedAmount ?? c.amount),
        0,
      ),
    rejectedCash: s.collections
      .filter(
        (c) =>
          c.tripId === t.id && c.mode === "Cash" && c.status === "Rejected",
      )
      .reduce((n, c) => n + c.amount, 0),
    rejectedSpending: s.fuels
      .filter(
        (f) =>
          f.tripId === t.id &&
          fuelSource(s, f) === "Shop advance" &&
          f.status === "Rejected",
      )
      .reduce((n, f) => n + f.amount, 0),
    held:
      t.openingAdvance +
      cash -
      spent -
      (t.handoverConfirmed ? t.cashReceived : 0),
    advance: t.openingAdvance,
    reported: cash,
    spent,
    expected: t.openingAdvance + cash - spent,
    received: t.cashReceived,
    difference: t.cashReceived - (t.openingAdvance + cash - spent),
  };
}
export function approvedReadings(t: Trip) {
  const corrected = t.corrections?.at(-1);
  return {
    opening: corrected?.opening ?? t.opening,
    closing: corrected?.closing ?? t.closing,
  };
}
export function distance(t: Trip) {
  const r = approvedReadings(t);
  return t.approvedOdometer && r.opening !== null && r.closing !== null
    ? r.closing - r.opening
    : 0;
}
export function fuelEfficiency(s: AppState, vehicleId: string) {
  const fills = s.fuels
    .filter(
      (f) =>
        f.vehicleId === vehicleId &&
        f.status === "Approved" &&
        f.odometer !== null,
    )
    .sort((a, b) => a.odometer! - b.odometer!);
  const first = fills.findIndex((f) => f.fullTank);
  let last = -1;
  for (let i = fills.length - 1; i > first; i--)
    if (fills[i].fullTank) {
      last = i;
      break;
    }
  if (first < 0 || last < 0) return null;
  const km = fills[last].odometer! - fills[first].odometer!;
  if (s.fuels.some(f => f.vehicleId === vehicleId && f.status === "Approved" && f.at > fills[first].at && f.at <= fills[last].at && f.litres === null)) return null;
  const litres = fills
    .slice(first + 1, last + 1)
    .reduce((n, f) => n + (f.litres ?? 0), 0);
  return km > 0 && litres > 0 ? km / litres : null;
}
export function audit(
  s: AppState,
  actor: User,
  type: string,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  const eventId = uuid(),
    at = now();
  s.audit.push({
    id: eventId,
    entityType: type,
    entityId: id,
    action,
    actorId: actor.id,
    at,
    before: JSON.stringify(before),
    after: JSON.stringify(after),
  });
  s.outbox.push({
    id: eventId,
    entityId: id,
    action,
    at,
    status: "Saved locally",
  });
}
export function jobAccess(s: AppState, actor: User, j: DeliveryJob) {
  if (actor.role !== "DRIVER") return manager(actor, j.shopId);
  assert(j.tripId, "Delivery is not assigned");
  driver(actor, find(s.trips, j.tripId));
}
export function visibleCollections(s: AppState, u: User): Collection[] {
  return s.collections.filter(
    (c) =>
      u.role === "ADMIN" ||
      (u.role === "DRIVER"
        ? c.driverId === u.id
        : u.shopIds.includes(c.shopId)),
  );
}
