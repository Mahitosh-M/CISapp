import type { CSSProperties } from 'react';

type DateLike = string | number | Date | { toDate: () => Date } | null | undefined;

const getDateMs = (value: DateLike) => {
  if (!value) return 0;

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  }

  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }

  const date = new Date(value as string | number | Date);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
};

export const getRecordDateMs = (record: unknown, preferredKeys: string[] = []) => {
  const source = record && typeof record === 'object' ? (record as Record<string, unknown>) : {};
  const keys = [
    ...preferredKeys,
    'updatedAt',
    'createdAt',
    'invoiceDate',
    'paymentDate',
    'giftGivenDate',
    'giftedDate',
    'date',
    'periodEnd'
  ];

  for (const key of keys) {
    const timestamp = getDateMs(source[key] as DateLike);
    if (timestamp > 0) return timestamp;
  }

  return 0;
};

export const sortNewestFirst = <T,>(rows: T[], preferredKeys: string[] = []) => {
  // Newest-first sorting keeps the first visible rows aligned with the latest business activity.
  return [...rows].sort((left, right) => getRecordDateMs(right, preferredKeys) - getRecordDateMs(left, preferredKeys));
};

export const latestEntriesNotice = 'Showing latest entries first. Scroll to view older records.';

export const latestFiveScrollStyle: CSSProperties = {
  // Adjust this height later if the owner wants more or fewer than roughly five rows visible.
  maxHeight: 340,
  overflowY: 'auto'
};
