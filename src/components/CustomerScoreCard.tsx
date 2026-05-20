import ScoreBar from './ScoreBar';
import TierBadge from './TierBadge';
import type { CustomerScore } from '../types';
import { formatMoney } from '../utils/formatters';

interface CustomerScoreCardProps {
  customer: CustomerScore;
}

const getMovementColor = (movement: CustomerScore['movement']) => {
  if (movement === 'Promoted') return '#27AE60';
  if (movement === 'Demoted') return '#EB5757';
  if (movement === 'New') return '#56CCF2';
  return '#BFC8D9';
};

const CustomerScoreCard = ({ customer }: CustomerScoreCardProps) => {
  const cardStyle = {
    background: '#0F2748',
    borderRadius: 16,
    padding: 18,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(0,0,0,0.14)'
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 14,
    alignItems: 'flex-start',
    marginBottom: 14
  };

  const metaStyle = {
    color: '#BFC8D9',
    fontSize: 13,
    marginTop: 5
  };

  const scoreStyle = {
    color: '#D4AF37',
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 1
  };

  const movementStyle = {
    color: getMovementColor(customer.movement),
    fontWeight: 700,
    fontSize: 13,
    marginTop: 10
  };

  const targetGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
    marginBottom: 14
  };

  const targetBoxStyle = {
    background: '#102F57',
    borderRadius: 12,
    padding: 10
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontWeight: 800 }}>{customer.customerName}</div>
          <div style={metaStyle}>{customer.customerArea}</div>
        </div>
        <TierBadge tier={customer.tier} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 14 }}>
        <div>
          <div style={scoreStyle}>{customer.intelligenceScore}</div>
          <div style={metaStyle}>Rank #{customer.rank}</div>
        </div>
        <div style={{ textAlign: 'right' as const }}>
          <div style={{ color: '#E8EDF5', fontWeight: 700 }}>{formatMoney(customer.totalProfit)}</div>
          <div style={metaStyle}>Profit</div>
        </div>
      </div>

      <div style={targetGridStyle}>
        <div style={targetBoxStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800 }}>Sales Target</div>
          <div style={{ fontWeight: 800 }}>{formatMoney(customer.customerMonthlySales)} / {formatMoney(customer.monthlySalesTarget)}</div>
          <div style={metaStyle}>{customer.salesTargetAchievement}% achievement</div>
        </div>
        <div style={targetBoxStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800 }}>Order Target</div>
          <div style={{ fontWeight: 800 }}>{customer.customerMonthlyOrders.toFixed(1)} / {customer.monthlyOrderTarget}</div>
          <div style={metaStyle}>{customer.orderTargetAchievement}% achievement</div>
        </div>
      </div>

      {customer.scoreBreakdown.map((item) => (
        <ScoreBar
          key={item.key}
          label={`${item.label} (${Math.round(item.weight * 100)}%)`}
          value={item.score}
          helperText={
            item.targetValue !== undefined && item.actualValue !== undefined
              ? `${item.achievementPercent}% target achievement | ${item.weightedScore.toFixed(1)} weighted points`
              : `${item.weightedScore.toFixed(1)} weighted points`
          }
        />
      ))}

      <div style={movementStyle}>{customer.movement}: {customer.movementReason}</div>
      {customer.insights.length > 0 ? (
        <div style={{ ...metaStyle, color: '#E8EDF5' }}>{customer.insights.slice(0, 3).join(' | ')}</div>
      ) : null}
      <div style={metaStyle}>{customer.recommendedAction}</div>
    </div>
  );
};

export default CustomerScoreCard;
