import { AlertTriangle, CheckCircle2, FileText, ShoppingCart, WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import CustomerInvoiceCard from '../../components/CustomerInvoiceCard';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatDate, formatMoney } from '../../utils/formatters';
import { calculateCustomerTotalOutstanding, isCurrentMonth, sortInvoicesByUrgency } from '../../utils/customerPortal';
import { sortNewestFirst } from '../../utils/listDisplay';

const StatTile = ({ title, value, icon, color = '#0B1F3A' }: { title: string; value: string; icon: JSX.Element; color?: string }) => (
  <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <div>
        <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>{title}</div>
        <div style={{ color, fontWeight: 900, fontSize: 18, marginTop: 5 }}>{value}</div>
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', background: '#FFF7D6', color: '#0B1F3A' }}>{icon}</div>
    </div>
  </div>
);

const CustomerDashboard = () => {
  const { customer, invoices, payments, invoiceViews } = useCustomerPortalContext();
  const currentMonthInvoices = invoices.filter((invoice) => isCurrentMonth(invoice.date));
  const currentMonthPayments = payments.filter((payment) => isCurrentMonth(payment.date));
  const currentMonthPurchases = currentMonthInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
  const currentMonthPaymentTotal = currentMonthPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const outstandingInvoices = sortInvoicesByUrgency(invoiceViews.filter((invoice) => invoice.outstandingAmount > 0));
  const totalOutstanding = calculateCustomerTotalOutstanding(customer, invoiceViews);
  const overdueInvoices = invoiceViews.filter((invoice) => invoice.outstandingAmount > 0 && invoice.daysRemaining < 0);
  const overdueAmount = overdueInvoices.reduce((sum, invoice) => sum + invoice.outstandingAmount, 0);
  const latestInvoices = sortNewestFirst(invoices, ['updatedAt', 'createdAt', 'date']).slice(0, 3);
  const latestPayments = sortNewestFirst(payments, ['updatedAt', 'createdAt', 'date']).slice(0, 3);
  const invoiceStatusById = new Map(invoiceViews.map((invoiceView) => [invoiceView.invoice.id, invoiceView.status]));

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#67738E', fontSize: 13, fontWeight: 800 }}>Welcome back</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <StatTile title="Month Purchases" value={formatMoney(currentMonthPurchases)} icon={<ShoppingCart size={20} />} />
        <StatTile title="Month Payments" value={formatMoney(currentMonthPaymentTotal)} icon={<WalletCards size={20} />} color="#166534" />
        <StatTile title="Invoices" value={`${currentMonthInvoices.length}`} icon={<FileText size={20} />} />
        <StatTile title="Payments" value={`${currentMonthPayments.length}`} icon={<WalletCards size={20} />} />
      </div>

      <div style={{ background: '#0B1F3A', color: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 12 }}>
        <div style={{ color: '#D4AF37', fontWeight: 900 }}>Total Outstanding</div>
        <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{formatMoney(totalOutstanding)}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, color: overdueInvoices.length > 0 ? '#FCA5A5' : '#BFC8D9' }}>
          <AlertTriangle size={17} />
          {overdueInvoices.length} overdue invoice(s), {formatMoney(overdueAmount)}
        </div>
      </div>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 900 }}>Outstanding / Due Invoices</div>
          <Link to="/customer/invoices" style={{ color: '#D4AF37', fontWeight: 900, textDecoration: 'none' }}>View All</Link>
        </div>
        {outstandingInvoices.length === 0 ? (
          <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 16, color: '#166534', fontWeight: 900 }}>No due invoices right now.</div>
        ) : (
          outstandingInvoices.map((invoiceView) => <CustomerInvoiceCard key={invoiceView.invoice.id} invoiceView={invoiceView} />)
        )}
      </section>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 900 }}>Latest 3 Invoices</div>
          <Link to="/customer/invoices" style={{ color: '#D4AF37', fontWeight: 900, textDecoration: 'none' }}>View All</Link>
        </div>
        {latestInvoices.map((invoice) => (
          <div key={invoice.id} style={{ background: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900 }}>{invoice.invoiceNumber}</div>
              <div style={{ color: '#67738E', fontSize: 12 }}>{formatDate(invoice.date)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 900 }}>{formatMoney(invoice.totalSales)}</div>
              <div style={{ display: 'inline-block', marginTop: 6, padding: '3px 8px', borderRadius: 999, background: '#FFF7D6', color: '#0B1F3A', fontSize: 11, fontWeight: 900 }}>
                {invoiceStatusById.get(invoice.id) || 'Pending'}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 900 }}>Latest 3 Payments</div>
          <Link to="/customer/payments" style={{ color: '#D4AF37', fontWeight: 900, textDecoration: 'none' }}>View All</Link>
        </div>
        {latestPayments.map((payment) => (
          <div key={payment.id} style={{ background: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900 }}>{payment.invoiceNumber || payment.id.slice(0, 8)}</div>
              <div style={{ color: '#67738E', fontSize: 12 }}>{formatDate(payment.date)} | {payment.mode}</div>
            </div>
            <div style={{ textAlign: 'right', color: '#166534', fontWeight: 900 }}>
              <CheckCircle2 size={17} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {formatMoney(payment.amount)}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
};

export default CustomerDashboard;
