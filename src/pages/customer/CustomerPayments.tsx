import { CheckCircle2, Upload } from 'lucide-react';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatMoney } from '../../utils/formatters';
import { sortNewestFirst } from '../../utils/listDisplay';

const CustomerPayments = () => {
  const { payments } = useCustomerPortalContext();
  const sortedPayments = sortNewestFirst(payments, ['updatedAt', 'createdAt', 'date']);

  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 4 }}>My Payments</div>
      <div style={{ color: '#67738E', fontSize: 13, marginBottom: 14 }}>Latest payments first.</div>

      <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 14, color: '#67738E' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 900, color: '#0B1F3A' }}>
          <Upload size={18} color="#D4AF37" />
          Payment proof
        </div>
        <div style={{ marginTop: 6, fontSize: 13 }}>
          Future feature: allow customer to upload payment proof screenshot.
        </div>
      </div>

      {sortedPayments.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 18, color: '#67738E', fontWeight: 900 }}>No payments found.</div>
      ) : (
        sortedPayments.map((payment) => (
          <div key={payment.id} style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 12, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 900 }}>
                <CheckCircle2 size={17} color="#166534" />
                {payment.invoiceNumber || payment.id.slice(0, 8)}
              </div>
              <div style={{ color: '#67738E', fontSize: 12, marginTop: 5 }}>{payment.date} | {payment.mode}</div>
            </div>
            <div style={{ textAlign: 'right', color: '#166534', fontWeight: 900 }}>{formatMoney(payment.amount)}</div>
          </div>
        ))
      )}
    </div>
  );
};

export default CustomerPayments;
