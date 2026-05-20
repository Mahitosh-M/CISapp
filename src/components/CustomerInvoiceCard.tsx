import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { CustomerInvoiceView } from '../utils/customerPortal';
import { formatMoney } from '../utils/formatters';

interface CustomerInvoiceCardProps {
  invoiceView: CustomerInvoiceView;
}

const CustomerInvoiceCard = ({ invoiceView }: CustomerInvoiceCardProps) => {
  const isPaid = invoiceView.outstandingAmount <= 0;
  const chartData = isPaid
    ? [{ name: 'Paid', value: 100, color: '#166534' }]
    : invoiceView.paidAmount > 0
      ? [
          { name: 'Paid', value: invoiceView.paidPercentage, color: '#166534' },
          { name: 'Pending', value: invoiceView.pendingPercentage, color: invoiceView.urgencyColor }
        ]
      : [{ name: 'Pending', value: 100, color: invoiceView.urgencyColor }];

  return (
    <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 126px', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ fontWeight: 900 }}>{invoiceView.invoice.invoiceNumber}</div>
            <span style={{ background: invoiceView.urgencyColor, color: '#FFFFFF', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 900 }}>
              {invoiceView.status}
            </span>
          </div>
          <div style={{ color: '#67738E', fontSize: 12, marginTop: 8 }}>Invoice: {invoiceView.invoice.date}</div>
          <div style={{ color: '#67738E', fontSize: 12 }}>Due: {invoiceView.invoice.dueDate || 'Due date not set'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <div>
              <div style={{ color: '#67738E', fontSize: 11 }}>Paid</div>
              <div style={{ color: '#166534', fontWeight: 900 }}>{formatMoney(invoiceView.paidAmount)}</div>
            </div>
            <div>
              <div style={{ color: '#67738E', fontSize: 11 }}>Outstanding</div>
              <div style={{ color: invoiceView.outstandingAmount > 0 ? '#7F1D1D' : '#166534', fontWeight: 900 }}>{formatMoney(Math.max(0, invoiceView.outstandingAmount))}</div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#0B1F3A', fontWeight: 900, fontSize: 13 }}>{formatMoney(invoiceView.invoiceAmount)}</div>
          <div style={{ width: 118, height: 118, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={chartData} dataKey="value" innerRadius={36} outerRadius={54} startAngle={90} endAngle={-270} stroke="none">
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 20, lineHeight: 1 }}>
                  {isPaid ? 'Paid' : Math.abs(invoiceView.daysRemaining)}
                </div>
                {!isPaid ? (
                  <div style={{ fontSize: 10, color: '#67738E', fontWeight: 900 }}>
                    {invoiceView.daysRemaining < 0 ? 'Days Overdue' : 'Days Left'}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div style={{ color: '#67738E', fontSize: 11 }}>
            {isPaid ? '100% paid' : `${Math.round(invoiceView.paidPercentage)}% paid`}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerInvoiceCard;
