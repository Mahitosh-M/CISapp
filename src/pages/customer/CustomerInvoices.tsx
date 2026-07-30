import { useMemo, useState } from 'react';
import CustomerInvoiceCard from '../../components/CustomerInvoiceCard';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { sortInvoicesByUrgency } from '../../utils/customerPortal';

const CustomerInvoices = () => {
  const { invoiceViews } = useCustomerPortalContext();
  const [showPaidInvoices, setShowPaidInvoices] = useState(false);
  const visibleInvoices = useMemo(() => {
    if (showPaidInvoices) {
      // Keep the paid view intentionally compact: latest paid invoices only.
      return invoiceViews
        .filter((invoice) => invoice.outstandingAmount <= 0)
        .sort((left, right) => right.invoice.date.localeCompare(left.invoice.date))
        .slice(0, 3);
    }

    const rows = invoiceViews.filter((invoice) => invoice.outstandingAmount > 0);
    // Paid and outstanding invoices are intentionally shown as separate views.
    return sortInvoicesByUrgency(rows);
  }, [invoiceViews, showPaidInvoices]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 900 }}>My Invoices</div>
          <div style={{ color: '#BFC8D9', fontSize: 13 }}>{showPaidInvoices ? 'Latest 3 paid invoices.' : 'Overdue first, then closest due date.'}</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 900, color: '#FFFFFF', fontSize: 12 }}>
          <input type="checkbox" checked={showPaidInvoices} onChange={(event) => setShowPaidInvoices(event.target.checked)} />
          Show Paid
        </label>
      </div>

      {visibleInvoices.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 18, color: '#166534', fontWeight: 900 }}>
          No invoices to show.
        </div>
      ) : (
        visibleInvoices.map((invoiceView) => <CustomerInvoiceCard key={invoiceView.invoice.id} invoiceView={invoiceView} />)
      )}
    </div>
  );
};

export default CustomerInvoices;
