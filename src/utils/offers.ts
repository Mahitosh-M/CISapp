import type { Offer } from '../types';
import { formatDateRange } from './formatters';

const VIEWED_OFFER_KEY_PREFIX = 'viewedOfferIds';
const CUSTOMER_PORTAL_VIEWED_OFFER_KEY = 'viewedOfferIds_customerPortal';

const parseDateOnly = (dateString?: string) => {
  if (!dateString) return undefined;

  const [year, month, day] = dateString.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return undefined;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;

  date.setHours(0, 0, 0, 0);
  return date;
};

const getTodayDate = (todayString = new Date().toISOString().slice(0, 10)) => {
  const parsedToday = parseDateOnly(todayString) ?? new Date();
  parsedToday.setHours(0, 0, 0, 0);
  return parsedToday;
};

export const isOfferCurrentlyActive = (offer: Offer, todayString?: string) => {
  if (!offer.isActive) return false;

  const today = getTodayDate(todayString);
  const startDate = parseDateOnly(offer.startDate);
  const endDate = parseDateOnly(offer.endDate);

  // Active offer filtering: date bounds are applied only when valid dates exist.
  if (startDate && startDate > today) return false;
  if (endDate && endDate < today) return false;

  return true;
};

export const sortOffersByLatest = (offers: Offer[]) =>
  [...offers].sort((left, right) => {
    const leftDate = left.createdAt || left.updatedAt || left.startDate || '';
    const rightDate = right.createdAt || right.updatedAt || right.startDate || '';
    return rightDate.localeCompare(leftDate);
  });

export const getViewedOfferStorageKey = (userId?: string) =>
  userId ? `${VIEWED_OFFER_KEY_PREFIX}_${userId}` : CUSTOMER_PORTAL_VIEWED_OFFER_KEY;

export const getViewedOfferIds = (userId?: string) => {
  try {
    const storedValue = window.localStorage.getItem(getViewedOfferStorageKey(userId));
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];
    return Array.isArray(parsedValue) ? parsedValue.map(String) : [];
  } catch {
    return [];
  }
};

export const markOfferAsViewed = (offerId: string, userId?: string) => {
  try {
    const viewedOfferIds = new Set(getViewedOfferIds(userId));
    viewedOfferIds.add(offerId);

    // Local viewed offer tracking prevents the same offer popup repeating on this customer/device.
    window.localStorage.setItem(getViewedOfferStorageKey(userId), JSON.stringify([...viewedOfferIds]));
  } catch {
    // If localStorage is unavailable, the popup can still close for the current session.
  }
};

export const getLatestUnreadOffer = (offers: Offer[], userId?: string) => {
  const viewedOfferIds = new Set(getViewedOfferIds(userId));

  // Unread offer popup logic: latest active offer that this customer/device has not viewed.
  return sortOffersByLatest(offers.filter((offer) => isOfferCurrentlyActive(offer))).find((offer) => !viewedOfferIds.has(offer.id));
};

export const getOfferDateRangeLabel = (offer: Pick<Offer, 'startDate' | 'endDate'>) => {
  if (offer.startDate || offer.endDate) return formatDateRange(offer.startDate, offer.endDate);
  return 'Open offer';
};
