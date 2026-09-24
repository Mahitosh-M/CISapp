import { useMemo } from 'react';
import CustomerInvoiceCard from '../../components/CustomerInvoiceCard';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { sortInvoicesByUrgency } from '../../utils/customerPortal';

const CustomerInvoices = () => {
  const { invoiceViews } = useCustomerPortalContext();
  const outstandingInvoices = useMemo(
    () => sortInvoicesByUrgency(invoiceViews.filter((invoiceView) => invoiceView.outstandingAmount > 0)),
    [invoiceViews]
  );

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#FFFFFF', fontSize: 24, fontWeight: 900 }}>My Invoices</div>
      </div>

      {outstandingInvoices.length === 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 18, color: '#166534', fontWeight: 900 }}>
          No outstanding invoices.
        </div>
      ) : (
        outstandingInvoices.map((invoiceView) => <CustomerInvoiceCard key={invoiceView.invoice.id} invoiceView={invoiceView} />)
      )}
    </div>
  );
};

export default CustomerInvoices;
