import { useId, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { formatMoney } from '../utils/formatters';
import './SalesCollectionDonut.css';

type SliceKey = 'collected' | 'outstanding' | 'discounts';
interface Props {
  sales: number;
  collected: number;
  outstanding: number;
  discounts: number;
}

const SalesCollectionDonut = ({ sales, collected, outstanding, discounts }: Props) => {
  const gradientId = useId().replace(/:/g, '');
  const [hovered, setHovered] = useState<SliceKey | null>(null);
  const rows = [
    { key: 'collected' as const, name: 'Collected', value: collected, color: '#55E6AB', endColor: '#139D81' },
    { key: 'outstanding' as const, name: 'Outstanding', value: outstanding, color: '#FF8A9D', endColor: '#D43C68' },
    { key: 'discounts' as const, name: 'Discounts', value: discounts, color: '#F9D779', endColor: '#D99B23' }
  ];
  const active = rows.find((row) => row.key === hovered && row.value > 0);
  const slices = rows.filter((row) => row.value > 0);
  const percent = (value: number) => sales > 0 ? `${(value / sales * 100).toFixed(1)}%` : '0.0%';

  return <div className="sales-collection-donut">
    <div className="sales-collection-total"><span>ACTUAL SALES</span><strong>{formatMoney(sales)}</strong><span className="sales-collection-total-note">100% of the selected period</span></div>
    {sales <= 0 ? <div className="sales-collection-empty">No sales for the selected dates and shop.</div> : <>
      <div className="sales-collection-chart" onMouseLeave={() => setHovered(null)}>
        <div className="sales-collection-halo" />
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>{rows.map((row) => <linearGradient key={row.key} id={`${gradientId}-${row.key}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={row.color} /><stop offset="100%" stopColor={row.endColor} /></linearGradient>)}</defs>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="90%" startAngle={90} endAngle={-270} paddingAngle={slices.length > 1 ? 4 : 0} cornerRadius={8} stroke="none" animationDuration={800}>
              {slices.map((row) => <Cell key={row.key} fill={`url(#${gradientId}-${row.key})`} onMouseEnter={() => setHovered(row.key)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default', opacity: active && active.key !== row.key ? 0.35 : 1, filter: active?.key === row.key ? `drop-shadow(0 0 9px ${row.color}88)` : undefined, transition: 'opacity 180ms ease, filter 180ms ease' }} />)}
            </Pie>

          </PieChart>
        </ResponsiveContainer>
        <div className="sales-collection-center" aria-live="polite" style={{ color: active?.color ?? '#55E6AB' }}>
          <strong>{percent(active?.value ?? collected)}</strong>
          <span>{active?.name ?? 'Collected'}</span>
          <small>{formatMoney(active?.value ?? collected)}</small>
        </div>
      </div>

    </>}
  </div>;
};

export default SalesCollectionDonut;
