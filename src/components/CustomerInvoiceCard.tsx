import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { CustomerInvoiceView } from '../utils/customerPortal';
import { formatDate, formatMoney } from '../utils/formatters';
import { formatApc } from '../utils/loyalty';

interface CustomerInvoiceCardProps {
  invoiceView: CustomerInvoiceView;
}

const cardStyle = {
  background: '#0B1F3A',
  borderRadius: 18,
  padding: 14,
  boxShadow: '0 12px 28px rgba(11,31,58,0.22)',
  marginBottom: 12
};

const coinOuterStyle = {
  width: 112,
  height: 112,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'radial-gradient(circle at 34% 27%, #FFFBE8 0 10%, #FDE68A 28%, #D4AF37 62%, #8A5A00 100%)',
  border: '5px solid #F8E7A3',
  boxShadow: 'inset 0 0 0 3px rgba(138,90,0,0.42), 0 10px 20px rgba(212,175,55,0.35)'
};

const coinInnerStyle = {
  width: 80,
  height: 80,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.18)',
  border: '1px solid rgba(255,255,255,0.55)',
  color: '#4A3000',
  textAlign: 'center' as const
};

const GoldCoin = ({ value, label }: { value: number; label: string }) => (
  <div style={coinOuterStyle}>
    <div style={coinInnerStyle}>
      <div>
        <div style={{ fontSize: 27, lineHeight: 1, fontWeight: 900 }}>{formatApc(value)}</div>
        <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.5, marginTop: 4 }}>{label}</div>
      </div>
    </div>
  </div>
);

const CustomerInvoiceCard = ({ invoiceView }: CustomerInvoiceCardProps) => {
  const isPaid = invoiceView.outstandingAmount <= 0;
  const isOverdue = !isPaid && invoiceView.daysRemaining < 0;
  const dueDateColor = '#FFF200';
  // The red portion grows with each elapsed credit day and remains full red once overdue.
  const countdownProgress = Math.min(100, Math.max(0, invoiceView.dueProgressPercentage));
  const countdownData = [
    { name: 'Elapsed credit days', value: countdownProgress, color: '#FF003D' },
    { name: 'Days remaining', value: Math.max(0, 100 - countdownProgress), color: '#00E676' }
  ].filter((entry) => entry.value > 0);
  const countdownNumber = invoiceView.invoice.dueDate ? Math.abs(invoiceView.daysRemaining) : '-';
  const countdownLabel = isOverdue ? 'Days Overdue' : 'Days Left';
  const expectedPc = Math.max(0, invoiceView.expectedApc);

  if (isPaid) {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 126px', gap: 12, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
              <span style={{ background: '#166534', color: '#FFFFFF', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 900 }}>Paid</span>
            </div>
            <div style={{ color: '#BFC8D9', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Date</div>
            <div style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 900, marginTop: 3 }}>{formatDate(invoiceView.invoice.date)}</div>
            <div style={{ background: 'linear-gradient(135deg, #FFF7D6 0%, #F4D875 100%)', border: '1px solid #D4AF37', borderRadius: 10, padding: 10, marginTop: 12, boxShadow: '0 5px 14px rgba(212,175,55,0.18)' }}>
              <div style={{ color: '#0B1F3A', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Amount</div>
              <div style={{ color: '#0B1F3A', fontSize: 20, fontWeight: 900, marginTop: 3 }}>{formatMoney(invoiceView.invoiceAmount)}</div>
            </div>
          </div>

          <div style={{ textAlign: 'center', display: 'grid', placeItems: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <GoldCoin value={invoiceView.earnedApc} label="PC EARNED" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'stretch', textAlign: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, padding: '9px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            <div style={{ color: '#FFFFFF', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Date</div>
            <div style={{ color: '#FFFFFF', fontSize: 16, fontWeight: 900, marginTop: 5, lineHeight: 1.15 }}>{formatDate(invoiceView.invoice.date)}</div>
          </div>
          <div style={{ background: 'linear-gradient(135deg, rgba(255,242,0,0.18), rgba(255,255,255,0.04))', border: '1px solid rgba(255,242,0,0.45)', borderRadius: 12, padding: '9px 8px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 14px rgba(255,242,0,0.12)' }}>
            <div style={{ color: '#FFFFFF', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Due Date</div>
            <div style={{ color: dueDateColor, fontSize: 16, fontWeight: 900, marginTop: 5, lineHeight: 1.15 }}>{invoiceView.invoice.dueDate ? formatDate(invoiceView.invoice.dueDate) : 'Not set'}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 12, alignItems: 'center', marginTop: 10, padding: 10, borderRadius: 12, background: 'rgba(255,247,214,0.08)', border: '1px solid rgba(253,230,138,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoldCoin value={expectedPc} label={invoiceView.apcStatus === 'Expired' ? 'PC EXPIRED' : 'EXPECTED PC'} />
          </div>
          <div style={{ width: 112, height: 112, position: 'relative', margin: '0 auto' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={countdownData} dataKey="value" innerRadius={35} outerRadius={52} startAngle={90} endAngle={-270} stroke="none">
                  {countdownData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div style={{ width: 70, textAlign: 'center' }}>
                <div style={{ color: '#FFFFFF', textShadow: '0 1px 5px rgba(0,0,0,0.72)', fontWeight: 900, fontSize: 28, lineHeight: 1 }}>{countdownNumber}</div>
                <div style={{ fontSize: 10, color: '#FFFFFF', fontWeight: 900, marginTop: 4, lineHeight: 1.05 }}>{countdownLabel}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10, textAlign: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #FFF7D6 0%, #F4D875 100%)', border: '1px solid #D4AF37', borderRadius: 10, padding: '9px 6px', color: '#0B1F3A', boxShadow: '0 5px 14px rgba(212,175,55,0.18)' }}>
            <div style={{ color: '#0B1F3A', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Amount</div>
            <div style={{ color: '#0B1F3A', fontSize: 15, fontWeight: 900, marginTop: 3 }}>{formatMoney(invoiceView.invoiceAmount)}</div>
          </div>
          <div style={{ background: '#ECFDF3', border: '1px solid #BBE7C8', borderRadius: 10, padding: '9px 6px' }}>
            <div style={{ color: '#166534', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Paid</div>
            <div style={{ color: '#166534', fontSize: 15, fontWeight: 900, marginTop: 3 }}>{formatMoney(invoiceView.paidAmount)}</div>
          </div>
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '9px 6px' }}>
            <div style={{ color: '#7F1D1D', fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>Outstanding</div>
            <div style={{ color: '#7F1D1D', fontSize: 15, fontWeight: 900, marginTop: 3 }}>{formatMoney(Math.max(0, invoiceView.outstandingAmount))}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerInvoiceCard;
