import React from 'react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
}

const StatCard = ({ title, value, subtitle, color = '#D4AF37' }: StatCardProps) => {
  const cardStyle = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    minWidth: 190,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const titleStyle = {
    fontSize: 14,
    textTransform: 'uppercase' as const,
    fontWeight: 700,
    letterSpacing: 0.8,
    marginBottom: 8,
    color: '#5C6A84'
  };

  const valueStyle = {
    fontSize: 28,
    fontWeight: 700,
    color
  };

  const subtitleStyle = {
    marginTop: 8,
    color: '#67738E',
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
