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

export const getTierColors = (tier: CustomerTier) => {
  if (tier === 'Tier 1') {
    return {
      background: 'linear-gradient(135deg, #F8FAFC 0%, #C7CDD5 48%, #E5E4E2 100%)',
      color: '#081426',
      border: '#F8FAFC'
    };
  }

  if (tier === 'Tier 2') {
    return {
      background: 'linear-gradient(135deg, #F7E7A6 0%, #D4AF37 56%, #B58A18 100%)',
      color: '#081426',
      border: '#F7E7A6'
    };
  }

  if (tier === 'Tier 3') {
    return {
      background: 'linear-gradient(135deg, #F4F4F5 0%, #C0C0C0 55%, #98A2B3 100%)',
      color: '#081426',
      border: '#F4F4F5'
    };
  }

  return {
    background: 'linear-gradient(135deg, #020202 0%, #18181B 52%, #000000 100%)',
    color: '#FFFFFF',
    border: '#52525B'
  };
};

export const getTierWithCodeLabel = (tier: CustomerTier) => `${getTierDisplayName(tier)} (${tier})`;
