import { describe, expect, it } from 'vitest';
import {
  CURRENT_PC_POLICY_VERSION,
  LEGACY_PC_POLICY_VERSION,
  canPostInvoicePcForSettlement,
  decideImmutableInvoicePcAward,
  getInvoicePcPolicyVersion,
  getPaymentPcPolicyVersion
} from './pcAwardPolicy';

describe('immutable invoice PC awards', () => {
  it('keeps a posted award when a later calculation is lower', () => {
    expect(decideImmutableInvoicePcAward(true, 15, 5)).toEqual({
      action: 'keep',
      awardedPoints: 15,
      pointsToAdd: 0
    });
  });

  it('never reverses a posted award when an edit recalculates it to zero', () => {
    expect(decideImmutableInvoicePcAward(true, 15, 0)).toEqual({
      action: 'keep',
      awardedPoints: 15,
      pointsToAdd: 0
    });
  });

  it('keeps a posted award when a later calculation is higher', () => {
    expect(decideImmutableInvoicePcAward(true, 15, 25)).toEqual({
      action: 'keep',
      awardedPoints: 15,
      pointsToAdd: 0
    });
  });

  it('creates one positive award when no ledger exists', () => {
    expect(decideImmutableInvoicePcAward(false, undefined, 10.6)).toEqual({
      action: 'award',
      awardedPoints: 11,
      pointsToAdd: 11
    });
  });

  it('permanently finalizes zero PC when a fully paid invoice earns nothing', () => {
    expect(decideImmutableInvoicePcAward(false, undefined, -4)).toEqual({
      action: 'finalize',
      awardedPoints: 0,
      pointsToAdd: 0
    });
  });

  it('reserves a new immutable policy version for new transactions', () => {
    expect(CURRENT_PC_POLICY_VERSION).toBeGreaterThan(LEGACY_PC_POLICY_VERSION);
    expect(getInvoicePcPolicyVersion({})).toBe(LEGACY_PC_POLICY_VERSION);
    expect(getInvoicePcPolicyVersion({ pcPolicyVersionAtInvoice: CURRENT_PC_POLICY_VERSION })).toBe(CURRENT_PC_POLICY_VERSION);
    expect(getPaymentPcPolicyVersion()).toBe(LEGACY_PC_POLICY_VERSION);
    expect(getPaymentPcPolicyVersion({ pcPolicyVersionAtPayment: CURRENT_PC_POLICY_VERSION })).toBe(CURRENT_PC_POLICY_VERSION);
  });

  it('posts for an invoice created under the current policy', () => {
    expect(canPostInvoicePcForSettlement(
      { pcPolicyVersionAtInvoice: CURRENT_PC_POLICY_VERSION },
      { createdAt: '2026-08-01T00:00:00.000Z' },
      '2026-08-02T00:00:00.000Z'
    )).toBe(true);
  });

  it('treats every explicit non-legacy policy as a protected transaction', () => {
    expect(canPostInvoicePcForSettlement(
      { pcPolicyVersionAtInvoice: 1 },
      undefined
    )).toBe(true);
  });

  it('posts for a current-policy payment against a legacy invoice', () => {
    expect(canPostInvoicePcForSettlement(
      {},
      {
        pcPolicyVersionAtPayment: CURRENT_PC_POLICY_VERSION,
        createdAt: '2026-08-03T00:00:00.000Z'
      },
      '2026-08-02T00:00:00.000Z'
    )).toBe(true);
  });

  it('posts a transition payment genuinely created after balance protection', () => {
    expect(canPostInvoicePcForSettlement(
      {},
      { createdAt: '2026-08-03T00:00:00.000Z' },
      '2026-08-02T00:00:00.000Z'
    )).toBe(true);
  });

  it('does not treat an edit to an old payment as a new settlement', () => {
    expect(canPostInvoicePcForSettlement(
      {},
      { createdAt: '2026-08-01T00:00:00.000Z' },
      '2026-08-02T00:00:00.000Z'
    )).toBe(false);
  });

  it('does not import an unversioned legacy settlement without a recovery boundary', () => {
    expect(canPostInvoicePcForSettlement(
      {},
      { createdAt: '2026-08-01T00:00:00.000Z' }
    )).toBe(false);
  });
});
