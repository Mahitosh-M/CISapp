import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CalendarClock, Clock3, Landmark, WalletCards } from 'lucide-react';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatDate, formatMoney } from '../../utils/formatters';

const CustomerCredit = () => {
  const { creditSummary } = useCustomerPortalContext();

  if (!creditSummary) {
    return (
      <div style={{ background: '#FFFFFF', borderRadius: 8, padding: 18, color: '#67738E', fontWeight: 800 }}>
        Your credit eligibility is being established through successful payments.
      </div>
    );
  }

  const total = creditSummary.availableCredit + creditSummary.usedCredit;
  const chartData = total > 0
    ? [
        { name: 'Available', value: creditSummary.availableCredit, color: '#16A34A' },
        { name: 'Used', value: creditSummary.usedCredit, color: '#DC2626' }
      ]
    : [{ name: 'No credit activity', value: 1, color: '#D8DEE9' }];
  const statusMessage = creditSummary.creditStatus === 'hold'
    ? 'Clear your overdue amount to restore available credit.'
    : creditSummary.creditStatus === 'starter'
      ? 'Your credit eligibility is being established through successful payments.'
      : creditSummary.creditStatus === 'disabled'
        ? 'Credit is not currently available for your account.'
        : 'Your available credit reflects current outstanding invoices.';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Landmark size={22} color="#D4AF37" />
        <div>
          <div style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 900 }}>CREDIT</div>
          <div style={{ color: '#BFC8D9', fontSize: 12, marginTop: 2 }}>Your current credit position</div>
        </div>
      </div>

      <section style={{ background: '#FFFFFF', borderRadius: 8, padding: 16, boxShadow: '0 12px 28px rgba(11,31,58,0.10)' }}>
        <div style={{ height: 250, position: 'relative' }} aria-label={`Available credit ${formatMoney(creditSummary.availableCredit)}; used credit ${formatMoney(creditSummary.usedCredit)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} dataKey="value" innerRadius="62%" outerRadius="88%" startAngle={90} endAngle={-270} strokeWidth={0} isAnimationActive>
                {chartData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
            <div>
              <div style={{ color: '#67738E', fontSize: 11, fontWeight: 850 }}>AVAILABLE CREDIT</div>
              <div style={{ color: '#166534', fontSize: 25, fontWeight: 950, marginTop: 5 }}>{formatMoney(creditSummary.availableCredit)}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <div style={{ padding: 12, borderRadius: 8, background: '#ECFDF3', border: '1px solid #ABEFC6' }}>
            <div style={{ color: '#166534', fontSize: 11, fontWeight: 850 }}>AVAILABLE</div>
            <div style={{ color: '#166534', fontWeight: 950, marginTop: 5, overflowWrap: 'anywhere' }}>{formatMoney(creditSummary.availableCredit)}</div>
          </div>
          <div style={{ padding: 12, borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <div style={{ color: '#991B1B', fontSize: 11, fontWeight: 850 }}>USED</div>
            <div style={{ color: '#991B1B', fontWeight: 950, marginTop: 5, overflowWrap: 'anywhere' }}>{formatMoney(creditSummary.usedCredit)}</div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, display: 'grid', placeItems: 'center', background: '#EEF2FF', color: '#3730A3', flex: '0 0 auto' }}><Clock3 size={19} /></div>
          <div><div style={{ color: '#67738E', fontSize: 11, fontWeight: 850 }}>CREDIT DAYS</div><div style={{ color: '#11185A', fontWeight: 950, marginTop: 3 }}>{creditSummary.creditDays} days</div></div>
        </div>
        <div style={{ background: '#FFFFFF', borderRadius: 8, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, display: 'grid', placeItems: 'center', background: '#FFF7D6', color: '#8A5A00', flex: '0 0 auto' }}><CalendarClock size={19} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#67738E', fontSize: 11, fontWeight: 850 }}>NEXT INVOICE DUE</div>
            <div style={{ color: '#11185A', fontWeight: 950, marginTop: 3 }}>
              {creditSummary.nextInvoiceDueDate ? `${formatDate(creditSummary.nextInvoiceDueDate)} · ${formatMoney(creditSummary.nextInvoiceDueAmount ?? 0)}` : 'No outstanding invoice due'}
            </div>
          </div>
        </div>
        <div style={{ background: creditSummary.creditStatus === 'hold' ? '#FEF2F2' : '#EEF2FF', border: `1px solid ${creditSummary.creditStatus === 'hold' ? '#FECACA' : '#C7D2FE'}`, borderRadius: 8, padding: 14, display: 'flex', alignItems: 'flex-start', gap: 12, color: creditSummary.creditStatus === 'hold' ? '#991B1B' : '#312E81', fontWeight: 850, lineHeight: 1.45 }}>
          <WalletCards size={20} style={{ flex: '0 0 auto' }} />
          <span>{statusMessage}</span>
        </div>
      </section>
    </div>
  );
};

export default CustomerCredit;
