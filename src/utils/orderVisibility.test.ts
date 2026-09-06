import { describe, expect, it } from 'vitest';
import { canUsePortalOrder } from './orderVisibility';
describe('portal order visibility', () => {
  it('shows orders only to Medical when Medical Order is enabled', () => {
    const settings = { turnOnOrder: true, medicalOrder: true };
    expect(canUsePortalOrder('Medical', settings)).toBe(true);
    expect(canUsePortalOrder('customer', settings)).toBe(false);
  });
  it('keeps the existing customer control when Medical Order is disabled', () => {
    expect(canUsePortalOrder('customer', { turnOnOrder: true, medicalOrder: false })).toBe(true);
    expect(canUsePortalOrder('Medical', { turnOnOrder: true, medicalOrder: false })).toBe(false);
  });
});