import type { Stop, Trip } from './domain';

/** Existing loaded trips retain their meaning; new trips track each delivery. */
export const isDeliveryLoaded = (trip: Trip, stop: Stop): boolean =>
  stop.kind !== 'Delivery' || !!stop.loadedAt || (trip.loadingMode !== 'perDelivery' && trip.loaded);
export const allDeliveriesLoaded = (trip: Trip): boolean =>
  trip.stops.filter(stop => stop.kind === 'Delivery').every(stop => isDeliveryLoaded(trip, stop));
export const canTravelWithLoad = (trip: Trip): boolean =>
  trip.loadingMode !== 'perDelivery' ? trip.loaded :
    !trip.stops.some(stop => stop.kind === 'Delivery') || trip.stops.some(stop => stop.kind === 'Delivery' && isDeliveryLoaded(trip, stop));
