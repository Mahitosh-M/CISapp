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

const CustomerInvoiceCard = ({ invoiceView }: CustomerInvoiceCardProps) => {
  const isPaid = invoiceView.outstandingAmount <= 0;
  const isOverdue = !isPaid && invoiceView.daysRemaining < 0;
  const dueDateColor = '#FDE68A';
  // The red portion grows with each elapsed credit day and remains full red once overdue.
  const countdownProgress = Math.min(100, Math.max(0, invoiceView.dueProgressPercentage));
  const countdownData = [
    { name: 'Elapsed credit days', value: countdownProgress, color: '#7F1D1D' },
    { name: 'Days remaining', value: Math.max(0, 100 - countdownProgress), color: '#22C55E' }
  ].filter((entry) => entry.value > 0);
  const countdownNumber = invoiceView.invoice.dueDate ? Math.abs(invoiceView.daysRemaining) : '-';
  const countdownLabel = isOverdue ? 'Days Overdue' : 'Days Left';
  const expectedPc = Math.max(0, invoiceView.expectedApc);

  if (isPaid) {
    return (
      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 126px', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <span style={{ background: '#166534', color: '#FFFFFF', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 900 }}>Paid</span>
            </div>
            <div style={{ color: '#BFC8D9', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Date</div>
            <div style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 900, marginTop: 3 }}>{formatDate(invoiceView.invoice.date)}</div>
            <div style={{ background: 'linear-gradient(135deg, #FFF7D6 0%, #F4D875 100%)', border: '1px solid #D4AF37', borderRadius: 10, padding: 10, marginTop: 12, boxShadow: '0 5px 14px rgba(212,175,55,0.18)' }}>
              <div style={{ color: '#0B1F3A', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Amount</div>
              <div style={{ color: '#0B1F3A', fontSize: 20, fontWeight: 900, marginTop: 3 }}>{formatMoney(invoiceView.invoiceAmount)}</div>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 112, height: 112, margin: '0 auto', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 34% 27%, #FFFBE8 0 10%, #FDE68A 28%, #D4AF37 62%, #8A5A00 100%)', border: '5px solid #F8E7A3', boxShadow: 'inset 0 0 0 3px rgba(138,90,0,0.42), 0 10px 20px rgba(212,175,55,0.35)' }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', color: '#4A3000' }}>
                <div>
                  <div style={{ fontSize: 27, lineHeight: 1, fontWeight: 900 }}>{formatApc(invoiceView.earnedApc)}</div>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.5, marginTop: 4 }}>PC EARNED</div>
                </div>
              </div>
            </div>
            <div style={{ color: '#8A5A00', fontSize: 11, fontWeight: 900, marginTop: 7 }}>Partner Coins</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 126px', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <span style={{ background: invoiceView.urgencyColor, color: '#FFFFFF', borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 900 }}>{invoiceView.status}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ color: '#BFC8D9', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Invoice Date</div>
              <div style={{ color: '#FFFFFF', fontSize: 16, fontWeight: 900, marginTop: 3 }}>{formatDate(invoiceView.invoice.date)}</div>
            </div>
            <div>
              <div style={{ color: dueDateColor, fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Due Date</div>
              <div style={{ color: dueDateColor, fontSize: 16, fontWeight: 900, marginTop: 3 }}>{invoiceView.invoice.dueDate ? formatDate(invoiceView.invoice.dueDate) : 'Not set'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, padding: 10, borderRadius: 12, background: 'rgba(255,247,214,0.08)', border: '1px solid rgba(253,230,138,0.35)' }}>
            <div style={{ width: 76, height: 76, flex: '0 0 auto', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 34% 27%, #FFFBE8 0 10%, #FDE68A 28%, #D4AF37 62%, #8A5A00 100%)', border: '4px solid #F8E7A3', boxShadow: 'inset 0 0 0 2px rgba(138,90,0,0.42), 0 7px 15px rgba(212,175,55,0.28)', color: '#4A3000' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 23, lineHeight: 1, fontWeight: 900 }}>{formatApc(expectedPc)}</div>
                <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.5, marginTop: 3 }}>PC</div>
              </div>
            </div>
            <div>
              <div style={{ color: '#FDE68A', fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>Expected PC</div>
              <div style={{ color: '#FFFFFF', fontSize: 16, fontWeight: 900, marginTop: 3 }}>{invoiceView.apcStatus === 'Expired' ? 'PC expired' : 'Earn on time payment'}</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
            <div style={{ background: '#ECFDF3', border: '1px solid #BBE7C8', borderRadius: 10, padding: 9 }}>
              <div style={{ color: '#166534', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Paid</div>
              <div style={{ color: '#166534', fontSize: 17, fontWeight: 900, marginTop: 3 }}>{formatMoney(invoiceView.paidAmount)}</div>
            </div>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 9 }}>
              <div style={{ color: '#7F1D1D', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Outstanding</div>
              <div style={{ color: '#7F1D1D', fontSize: 17, fontWeight: 900, marginTop: 3 }}>{formatMoney(Math.max(0, invoiceView.outstandingAmount))}</div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ background: 'linear-gradient(135deg, #FFF7D6 0%, #F4D875 100%)', border: '1px solid #D4AF37', borderRadius: 12, padding: '8px 6px', color: '#0B1F3A', boxShadow: '0 6px 14px rgba(212,175,55,0.28)' }}>
            <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4 }}>Invoice Amount</div>
            <div style={{ fontWeight: 900, fontSize: 18, marginTop: 2 }}>{formatMoney(invoiceView.invoiceAmount)}</div>
          </div>
          <div style={{ width: 118, height: 118, position: 'relative', margin: '2px auto 0' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={countdownData} dataKey="value" innerRadius={36} outerRadius={54} startAngle={90} endAngle={-270} stroke="none">
                  {countdownData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div>
                <div style={{ color: '#FFFFFF', textShadow: '0 1px 5px rgba(0,0,0,0.72)', fontWeight: 900, fontSize: 28, lineHeight: 1 }}>{countdownNumber}</div>
                <div style={{ fontSize: 10, color: '#FDE68A', fontWeight: 900, marginTop: 4 }}>{countdownLabel}</div>
              </div>
            </div>
          </div>
          <div style={{ color: '#7F1D1D', fontSize: 11, fontWeight: 900 }}>{Math.round(countdownProgress)}% of credit time used</div>
        </div>
      </div>
    </div>
  );
};

export default CustomerInvoiceCard;
