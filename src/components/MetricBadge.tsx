import React from 'react';

interface MetricBadgeProps {
  label: string;
  value: string;
  highlight?: boolean;
}

const MetricBadge = ({ label, value, highlight }: MetricBadgeProps) => {
  const badgeStyle = {
    borderRadius: 12,
    padding: '10px 14px',
    background: highlight ? '#D4AF37' : '#142B4C',
    color: highlight ? '#0B1F3A' : '#FFFFFF',
    display: 'inline-flex',
    alignItems: 'center',
    marginRight: 10,
    marginBottom: 10
  };

  const labelStyle = {
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginRight: 8,
    opacity: 0.8
  };

  const valueStyle = {
    fontSize: 14,
    fontWeight: 700
  };

  return (
    <div style={badgeStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
};

export default MetricBadge;
