import type { CSSProperties } from 'react';
import { getDateRangeShortcut } from '../utils/dateUtils';
import type { DateRange, DateRangeShortcutKey } from '../utils/dateUtils';

interface DateRangeShortcutsProps {
  onSelect: (range: DateRange) => void;
  selectedRange?: DateRange;
}

const shortcuts: { key: DateRangeShortcutKey; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_quarter', label: 'Last Quarter' },
  { key: 'last_6_months', label: 'Last 6 Months' },
  { key: 'last_year', label: 'Last Year' }
];

const baseButtonStyle: CSSProperties = {
  border: '1px solid #D8DEE9',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#F8F9FB',
  color: '#0B1F3A',
  fontWeight: 800,
  cursor: 'pointer',
  transition: 'background 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease'
};

const rangesMatch = (rangeA?: DateRange, rangeB?: DateRange) => {
  return Boolean(rangeA && rangeB && rangeA.fromDate === rangeB.fromDate && rangeA.toDate === rangeB.toDate);
};

const DateRangeShortcuts = ({ onSelect, selectedRange }: DateRangeShortcutsProps) => {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {shortcuts.map((shortcut) => {
        const shortcutRange = getDateRangeShortcut(shortcut.key);
        const isSelected = rangesMatch(selectedRange, shortcutRange);

        return (
          <button
            key={shortcut.key}
            type="button"
            style={{
              ...baseButtonStyle,
              background: isSelected ? '#0B1F3A' : '#F8F9FB',
              borderColor: isSelected ? '#0B1F3A' : '#D8DEE9',
              color: isSelected ? '#FFFFFF' : '#0B1F3A',
              transform: isSelected ? 'translateY(-1px)' : 'translateY(0)'
            }}
            onClick={() => {
              onSelect(shortcutRange);
            }}
          >
            {shortcut.label}
          </button>
        );
      })}
    </div>
  );
};

export default DateRangeShortcuts;
