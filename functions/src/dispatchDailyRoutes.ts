import { getFirestore } from 'firebase-admin/firestore';
import type { AppState, Trip } from './dispatchDomain/domain';
import { emptyState } from './dispatchDomain/emptyState';
import { mergeCloudSnapshot, type CloudSnapshot, type CloudRequest } from './dispatchDomain/syncMerge';
import type { WeeklyRoute } from '../../src/utils/dispatchRoutes';
import { allowed, type DispatchIdentity } from './dispatchAdmin';
import { identifier, requireValue, stableId, type Data } from './dispatchCore';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const jobId = (invoiceId: string) => `cis-job:${invoiceId}`;

export function isAutomaticDraft(state: AppState, tripId?: string | null) {
  const trip = state.trips.find(row => row.id === tripId);
  return !!trip?.autoCreated && trip.status === 'Draft';
}

/** Called only inside the source invoice/request transaction. Never releases a trip. */
export function planDailyDelivery(state: AppState, request: CloudRequest, route: WeeklyRoute | null,
  cloud: CloudSnapshot, at: string): { tripId: string | null; created: boolean; name?: string } {
  const existingJob = state.jobs.find(job => job.id === jobId(request.id));
  const previousTrip = state.trips.find(trip => trip.id === (existingJob?.tripId || request.tripId));
  if (request.tripId && !previousTrip) return { tripId: request.tripId, created: false };
  if (previousTrip && !isAutomaticDraft(state, previousTrip.id)) {
    return { tripId: request.tripId || previousTrip.id, created: false };
  }
  // Delivery attempts and completed work stay historical. Reschedule through Dispatch review.
  if (existingJob && state.attempts.some(attempt => attempt.jobId === existingJob.id)) {
    return { tripId: existingJob.tripId, created: false };
  }
  const stays = !!previousTrip && request.active && route?.id === previousTrip.routeTemplateId
    && request.scheduledDate === previousTrip.date;
  if (previousTrip && !stays) {
    previousTrip.stops = previousTrip.stops.filter(stop => stop.jobId !== jobId(request.id));
    previousTrip.revision++;
    previousTrip.planningShopIds = [...new Set(previousTrip.stops.flatMap(stop => { const job = state.jobs.find(row => row.id === stop.jobId); return job ? [job.shopId] : []; }))];
    if (!previousTrip.stops.length) previousTrip.status = 'Cancelled';
    if (existingJob) { existingJob.tripId = null; existingJob.status = request.active ? 'Ready' : 'Cancelled'; }
  }
  const projected = { ...request, tripId: stays ? previousTrip!.id : null };
  // Draft source edits are intentional and must replace this request's planning data.
  if (existingJob && (!previousTrip || previousTrip.status === 'Draft' || previousTrip.autoCreated)) {
    existingJob.customerId = `cis-customer:${request.sourceCustomerId}`;
    existingJob.shopId = request.shopId;
  }
  mergeCloudSnapshot(state, { ...cloud, requests: [projected] });
  const job = state.jobs.find(row => row.id === jobId(request.id));
  requireValue(job, 'Delivery reference could not be prepared');
  if (!request.active || !route) return { tripId: null, created: false };
  let trip = stays ? previousTrip : state.trips.find(row => row.autoCreated && !row.purgedAt
    && row.status === 'Draft' && row.routeTemplateId === route.id && row.date === request.scheduledDate
    && row.stops.length < 60);
  let created = false;
  if (!trip) {
    let sequence = 1;
    let id = stableId('daily-route', `${route.id}:${request.scheduledDate}:${sequence}`);
    while (state.trips.some(row => row.id === id)) {
      sequence++;
      id = stableId('daily-route', `${route.id}:${request.scheduledDate}:${sequence}`);
    }
    const startShopId = route.startShopId || route.stops[0]?.shopId || request.shopId;
    trip = {
      id, autoCreated: true, planningShopIds: [], name: route.name, date: request.scheduledDate,
      routeTemplateId: route.id, routeSnapshot: { template: clone(route), points: [], capturedAt: at, revision: 0 },
      startShopId, endShopId: route.endShopId || route.stops.at(-1)?.shopId || startShopId,
      vehicleId: '', primaryDriverId: '', companionId: null, status: 'Draft', stops: [],
      opening: null, closing: null, openingPhoto: null, closingPhoto: null, openingNote: '', endNote: '',
      openingAdvance: 0, startedAt: null, endedAt: null, loaded: false, returnConfirmed: false,
      approvedOdometer: false, cashReceived: 0, handoverConfirmed: false, cashExplanation: '', exceptions: [], revision: 0,
    };
    state.trips.push(trip);
    created = true;
  }
  trip.routeSnapshot = { template: clone(route), points: [], capturedAt: at, revision: trip.routeSnapshot?.revision || 0 };
  const stop = trip.stops.find(row => row.jobId === job.id);
  if (stop) stop.customerId = job.customerId;
  else {
    const rank = (stopId?: string | null) => { const index = route.stops.findIndex(row => row.id === stopId); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
    const newRank = rank(job.routeStopId);
    const index = trip.stops.findIndex(row => rank(state.jobs.find(j => j.id === row.jobId)?.routeStopId) > newRank);
    const added = { id: stableId('daily-stop', request.id), kind: 'Delivery' as const, customerId: job.customerId, jobId: job.id, completed: false };
    if (index < 0) trip.stops.push(added); else trip.stops.splice(index, 0, added);
  }
  job.tripId = trip.id; job.status = 'Assigned'; job.revision++;
  trip.planningShopIds = [...new Set(trip.stops.flatMap(row => { const found = state.jobs.find(j => j.id === row.jobId); return found ? [found.shopId] : []; }))];
  trip.revision++;
  return { tripId: trip.id, created, name: trip.name };
}

export function dailyPlansFor(identity: DispatchIdentity, state: AppState) {
  allowed(identity, 'viewOperations');
  requireValue(identity.role !== 'DRIVER', 'Staff or Admin access required');
  return state.trips.filter(trip => trip.autoCreated && trip.status === 'Draft' && !trip.purgedAt).flatMap(trip => {
    const stops = trip.stops.flatMap(stop => {
      const job = state.jobs.find(row => row.id === stop.jobId);
      if (!job || identity.role !== 'ADMIN' && !identity.shopIds.includes(job.shopId)) return [];
      const invoice = state.invoices.find(row => row.id === job.invoiceId);
      const customer = state.customers.find(row => row.id === job.customerId);
      return [{ id: stop.id, customerId: customer?.externalId || '', customerName: customer?.name || 'Customer',
        invoiceId: invoice?.externalId || '', invoiceNumber: invoice?.number || '', packages: job.remaining,
        shopId: job.shopId, routeStopName: job.routeStopName || '', locked: stop.locked === true }];
    });
    return stops.length ? [{ id: trip.id, name: trip.name, date: trip.date, revision: trip.revision,
      routeId: trip.routeTemplateId || '', stops }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export function reorderDailyPlan(identity: DispatchIdentity, state: AppState, payload: Data) {
  allowed(identity, 'manageDispatch');
  requireValue(identity.role !== 'DRIVER', 'Staff or Admin access required');
  const trip = state.trips.find(row => row.id === identifier(payload.id));
  requireValue(trip?.autoCreated && trip.status === 'Draft' && !trip.purgedAt, 'Only automatic draft routes can be edited here');
  requireValue(payload.revision === trip.revision, 'Route changed. Refresh and reopen it before saving.');
  const ids = payload.stopIds;
  requireValue(Array.isArray(ids) && ids.length > 0 && ids.length <= 60 && new Set(ids).size === ids.length, 'Select valid route stops');
  const ordered = ids.map(id => {
    const stop = trip.stops.find(row => row.id === identifier(id));
    const job = state.jobs.find(row => row.id === stop?.jobId);
    requireValue(stop && job && (identity.role === 'ADMIN' || identity.shopIds.includes(job.shopId)), 'Permission denied for this delivery');
    return stop;
  });
  const selected = new Set(ids);
  let index = 0;
  const next = trip.stops.map(stop => selected.has(stop.id) ? ordered[index++] : stop);
  requireValue(trip.stops.every((stop, n) => !stop.locked || stop.id === next[n].id), 'Locked stops cannot be moved');
  trip.stops = next; trip.revision++;
  return { id: trip.id, revision: trip.revision, saved: true };
}

export async function dailyRoutePlans(identity: DispatchIdentity) {
  const saved = (await getFirestore().doc('dispatchOperationalState/main').get()).data()?.state as AppState | undefined;
  return { plans: dailyPlansFor(identity, saved || emptyState()) };
}

export async function saveDailyRouteOrder(identity: DispatchIdentity, payload: Data) {
  return getFirestore().runTransaction(async tx => {
    const ref = getFirestore().doc('dispatchOperationalState/main');
    const state = (await tx.get(ref)).data()?.state as AppState | undefined;
    requireValue(state, 'Refresh daily routes before editing');
    const result = reorderDailyPlan(identity, state, payload);
    tx.set(ref, { state: clone(state), updatedAt: new Date().toISOString() });
    tx.create(getFirestore().collection('dispatchAudit').doc(), { action: 'Daily route stop order updated', entityId: result.id,
      actorId: identity.actorId, uid: identity.uid, issuer: identity.issuer, at: new Date().toISOString(), details: { stopIds: payload.stopIds } });
    return result;
  });
}
