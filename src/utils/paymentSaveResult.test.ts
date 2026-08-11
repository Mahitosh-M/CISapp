import { describe, expect, it } from 'vitest';
import { summarizePaymentSaveResults } from './paymentSaveResult';

describe('payment save result summary', () => {
  it('totals split-invoice PC credits and keeps the latest confirmed balance', () => {
    expect(summarizePaymentSaveResults([
      {
        pcAwards: [{ status: 'credited', points: 5, availablePc: 105 }],
        warnings: []
      },
      {
        pcAwards: [{ status: 'credited', points: 8, availablePc: 113 }],
        warnings: []
      }
    ])).toEqual({ creditedPc: 13, availablePc: 113, warnings: [] });
  });

  it('does not report old or zero-finalized awards as newly credited', () => {
    expect(summarizePaymentSaveResults([{
      pcAwards: [
        { status: 'already_finalized', points: 20 },
        { status: 'finalized_zero', points: 0, availablePc: 40 }
      ],
      warnings: []
    }])).toEqual({ creditedPc: 0, availablePc: undefined, warnings: [] });
  });

  it('deduplicates post-processing warnings from split payments', () => {
    const warning = 'Payment was saved, but PC posting is pending.';
    expect(summarizePaymentSaveResults([
      { pcAwards: [], warnings: [{ message: warning }] },
      { pcAwards: [], warnings: [{ message: warning }] }
    ]).warnings).toEqual([warning]);
  });
});
