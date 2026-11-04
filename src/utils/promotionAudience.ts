import type { Customer, PromotionAudience, UserRole } from '../types';

export type PortalCustomerType = 'customer' | 'medical';
export const PROMOTION_AUDIENCE_LABELS: Record<PromotionAudience, string> = {
  customer: 'Customer', medical: 'Medical', both: 'Both'
};
export const getPortalCustomerType = (customer?: Pick<Customer, 'customerType'>, role?: UserRole): PortalCustomerType =>
  customer ? (customer.customerType === 'medical' ? 'medical' : 'customer') : role === 'Medical' ? 'medical' : 'customer';

export const isPromotionVisibleToCustomer = (audience: unknown, customerType: PortalCustomerType) =>
  audience === undefined || audience === 'both' || audience === customerType;

export const validatePromotionAudience = (audience: unknown): PromotionAudience => {
  if (audience === undefined) return 'both';
  if (audience === 'customer' || audience === 'medical' || audience === 'both') return audience;
  throw new Error('Select Customer, Medical or Both for visibility.');
};
