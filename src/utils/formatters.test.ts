import { describe, expect, it } from 'vitest';
import { formatShortDate } from './formatters';

describe('short record date formatting', () => {
  it('formats ISO dates as DD-MMM with an uppercase English month', () => {
    expect(formatShortDate('2026-01-01')).toBe('01-JAN');
    expect(formatShortDate('2026-09-12T08:30:00.000Z')).toBe('12-SEP');
  });

  it('keeps empty and invalid values readable', () => {
    expect(formatShortDate()).toBe('-');
    expect(formatShortDate('not-a-date')).toBe('not-a-date');
  });
});
