interface ScoreBarProps {
  label: string;
  value: number;
  helperText?: string;
  color?: string;
}

const ScoreBar = ({ label, value, helperText, color = '#D4AF37' }: ScoreBarProps) => {
  const safeValue = Math.min(100, Math.max(0, value));

  const rowStyle = {
    marginBottom: 12
  };

  const labelRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
    color: '#E8EDF5',
    fontSize: 13
  };

  const trackStyle = {
    height: 8,
    borderRadius: 999,
    background: 'rgba(255,255,255,0.12)',
    overflow: 'hidden'
  };

  const fillStyle = {
    height: '100%',
    width: `${safeValue}%`,
    background: color,
    borderRadius: 999
  };

  const helperStyle = {
    marginTop: 5,
    color: '#BFC8D9',
    fontSize: 12,
    lineHeight: 1.4
  };

  return (
    <div style={rowStyle}>
      <div style={labelRowStyle}>
        <span>{label}</span>
        <strong>{safeValue}</strong>
      </div>
      <div style={trackStyle}>
        <div style={fillStyle} />
      </div>
      {helperText ? <div style={helperStyle}>{helperText}</div> : null}
    </div>
  );
};

export default ScoreBar;
