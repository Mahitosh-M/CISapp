import React from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
}

const SectionHeader = ({ title, description }: SectionHeaderProps) => {
  const containerStyle = {
    marginBottom: 20
  };

  const titleStyle = {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 6
  };

  const descriptionStyle = {
    color: '#BFC8D9',
    fontSize: 14,
    lineHeight: 1.5
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{title}</div>
      {description ? <div style={descriptionStyle}>{description}</div> : null}
    </div>
  );
};

export default SectionHeader;
