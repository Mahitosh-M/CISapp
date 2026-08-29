import { useMemo } from 'react';
import CustomerInvoiceCard from '../../components/CustomerInvoiceCard';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { sortInvoicesByUrgency } from '../../utils/customerPortal';

const CustomerInvoices = () => {
  const { invoiceViews } = useCustomerPortalContext();
  const visibleInvoices = useMemo(
    () => sortInvoicesByUrgency(invoiceViews.filter((invoice) => invoice.outstandingAmount > 0)),
    [invoiceViews]
  );

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 900 }}>My Invoices</div>
      </div>

      {visibleInvoices.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 18, color: '#166534', fontWeight: 900 }}>
          No outstanding invoices.
        </div>
      ) : (
        visibleInvoices.map((invoiceView) => <CustomerInvoiceCard key={invoiceView.invoice.id} invoiceView={invoiceView} />)
      )}
    </div>
  );
};

export default CustomerInvoices;
