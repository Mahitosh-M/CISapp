import { expect, it } from 'vitest';
import { getPortalCustomerType, isPromotionVisibleToCustomer, validatePromotionAudience } from './promotionAudience';

it.each([
  ['customer', 'customer', true], ['customer', 'medical', false],
  ['medical', 'customer', false], ['medical', 'medical', true],
  ['both', 'customer', true], ['both', 'medical', true],
  [undefined, 'customer', true], [undefined, 'medical', true],
  [null, 'customer', false], ['unknown', 'medical', false]
] as const)('audience %s for %s is visible: %s', (audience, type, visible) => {
  expect(isPromotionVisibleToCustomer(audience, type)).toBe(visible);
});
it('uses the linked customer classification, with role fallback only without a customer', () => {
  expect(getPortalCustomerType({ customerType: 'medical' }, 'customer')).toBe('medical');
  expect(getPortalCustomerType({}, 'Medical')).toBe('customer');
  expect(getPortalCustomerType(undefined, 'Medical')).toBe('medical');
});
it('saves legacy omissions as Both and rejects malformed values', () => {
  expect(validatePromotionAudience(undefined)).toBe('both');
  expect(validatePromotionAudience('medical')).toBe('medical');
  for (const invalid of ['', null, ['customer'], 1, 'all']) {
    expect(() => validatePromotionAudience(invalid)).toThrow('Select Customer, Medical or Both');
  }
});
