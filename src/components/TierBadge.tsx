import type { CustomerTier } from '../types';
import { getTierDisplayName } from '../utils/tiers';

interface TierBadgeProps {
  tier: CustomerTier;
}

const getTierColors = (tier: CustomerTier) => {
  if (tier === 'Tier 1') {
    return { background: '#D4AF37', color: '#11185A', border: '#D4AF37' };
  }

  if (tier === 'Tier 2') {
    return { background: '#FFF7D6', color: '#7A5A00', border: '#D4AF37' };
  }

  if (tier === 'Tier 3') {
    return { background: '#E8EDF5', color: '#11185A', border: '#BFC8D9' };
  }

  return { background: '#EAF8EE', color: '#166534', border: '#ABEFC6' };
};

const TierBadge = ({ tier }: TierBadgeProps) => {
  const colors = getTierColors(tier);

  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    border: `1px solid ${colors.border}`,
    background: colors.background,
    color: colors.color,
    fontSize: 12,
    fontWeight: 700,
    padding: '5px 10px',
    whiteSpace: 'nowrap' as const
  };

  return <span style={badgeStyle}>{getTierDisplayName(tier)}</span>;
};

export default TierBadge;
