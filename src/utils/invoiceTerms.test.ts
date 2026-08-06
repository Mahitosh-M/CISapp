import { describe, expect, it } from 'vitest';
import type { Invoice } from '../types';
import { buildInvoiceTimeTerms, DEFAULT_SETTINGS, mergeWithDefaultSettings } from './settings';

const historicalTerms: Partial<Invoice> = {
  tierAtInvoice: 'Tier 1',
  pcPercentageAtInvoice: 4,
  creditDaysAtInvoice: 15,
  bufferDaysAtInvoice: 3,
  savedDueDate: '2026-07-16'
};

describe('stable invoice-time terms', () => {
  it('does not replace historical tier, PC rate, credit days, or buffer days after a tier change', () => {
    const changedSettings = mergeWithDefaultSettings({
      giftPercentages: { ...DEFAULT_SETTINGS.giftPercentages, 'Tier 4': 1 },
      creditDays: { ...DEFAULT_SETTINGS.creditDays, 'Tier 4': 0 },
      paymentBuffers: { ...DEFAULT_SETTINGS.paymentBuffers, 'Tier 4': 0 }
    });
    const terms = buildInvoiceTimeTerms('2026-07-01', '2026-07-16', 'Tier 4', changedSettings, historicalTerms);

    expect(terms.tierAtInvoice).toBe('Tier 1');
    expect(terms.pcPercentageAtInvoice).toBe(4);
    expect(terms.creditDaysAtInvoice).toBe(15);
    expect(terms.bufferDaysAtInvoice).toBe(3);
  });

  it('makes a manual due-date edit authoritative and recalculates the final PC cutoff', () => {
    const terms = buildInvoiceTimeTerms('2026-07-01', '2026-07-20', 'Tier 4', DEFAULT_SETTINGS, historicalTerms);

    expect(terms.savedDueDate).toBe('2026-07-20');
    expect(terms.finalPcCutoffDate).toBe('2026-07-23');
  });

  it('creates a due date from credit days only and keeps buffer days separate', () => {
    const terms = buildInvoiceTimeTerms('2026-07-01', '', 'Tier 1', DEFAULT_SETTINGS);

    expect(terms.savedDueDate).toBe('2026-07-16');
    expect(terms.finalPcCutoffDate).toBe('2026-07-19');
  });
});
