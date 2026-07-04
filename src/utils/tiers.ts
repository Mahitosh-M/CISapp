import type { CustomerTier } from '../types';

export const CUSTOMER_TIERS: CustomerTier[] = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'];

export const TIER_DISPLAY_NAMES: Record<CustomerTier, string> = {
  'Tier 1': 'Platinum Partner',
  'Tier 2': 'Gold Partner',
  'Tier 3': 'Silver Partner',
  'Tier 4': 'Active Partner'
};

export const getTierDisplayName = (tier?: CustomerTier) => {
  return tier ? TIER_DISPLAY_NAMES[tier] ?? tier : 'Active Partner';
};

export const getTierWithCodeLabel = (tier: CustomerTier) => `${getTierDisplayName(tier)} (${tier})`;
