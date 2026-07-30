import React from 'react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
}

const StatCard = ({ title, value, subtitle, color = '#D4AF37' }: StatCardProps) => {
  const cardStyle = {
    background: 'var(--role-card-background)',
    borderRadius: 12,
    padding: 'clamp(14px, 4vw, 20px)',
    minWidth: 0,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const titleStyle = {
    fontSize: 'clamp(11px, 3vw, 14px)',
    textTransform: 'uppercase' as const,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 8,
    color: '#D7DEEA'
  };

  const valueStyle = {
    fontSize: 'clamp(20px, 6vw, 28px)',
    fontWeight: 700,
    color
  };

  const subtitleStyle = {
    marginTop: 8,
    color: '#D7DEEA',
    fontSize: 13
  };

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>{title}</div>
      <div style={valueStyle}>{value}</div>
      {subtitle ? <div style={subtitleStyle}>{subtitle}</div> : null}
    </div>
  );
};

export default StatCard;
