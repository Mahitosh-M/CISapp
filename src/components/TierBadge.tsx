import type { CustomerTier } from '../types';

interface TierBadgeProps {
  tier: CustomerTier;
}

const getTierColors = (tier: CustomerTier) => {
  if (tier === 'Tier 1') {
    return { background: '#D4AF37', color: '#0B1F3A', border: '#D4AF37' };
  }

  if (tier === 'Tier 2') {
    return { background: '#E8EDF5', color: '#0B1F3A', border: '#BFC8D9' };
  }

  return { background: '#FDECEC', color: '#B42318', border: '#F5B5B5' };
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

  return <span style={badgeStyle}>{tier}</span>;
};

export default TierBadge;
