import type { CustomerTier } from '../types';
import { getTierColors, getTierDisplayName } from '../utils/tiers';

interface TierBadgeProps {
  tier: CustomerTier;
}

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
