import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateDueDate,
  createInvoice,
  deleteInvoiceRecord,
  getAppSettings,
  getCustomers,
  getInvoices,
  getNextInvoiceNumber,
  getPayments,
  getPaymentsByInvoiceId,
  updateInvoiceRecord
} from '../services/firestoreService';
import type { AppSettings, Customer, Invoice, InvoiceFormData, Payment } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';
import { DEFAULT_SETTINGS, calculateDynamicDueDate } from '../utils/settings';

const buildEmptyInvoiceForm = (): InvoiceFormData => ({
  customerId: '',
  customerName: '',
  date: getTodayDateString(),
  dueDate: getTodayDateString(),
  salesAmount: 0,
  costAmount: 0,
  transportAmount: 0,
  totalSales: 0,
  totalCost: 0,
  totalProfit: 0,
  notes: ''
});

const getInvoiceStatus = (dueDate: string, totalSales: number, paidAmount: number) => {
  const outstanding = getPendingAmount(totalSales, paidAmount);
  const today = getTodayDateString();

  if (outstanding <= 0) return { label: 'Paid', color: '#27AE60' };
  if (paidAmount > 0) return { label: 'Partial', color: '#F2994A' };
  if (dueDate && dueDate < today) return { label: 'Overdue', color: '#EB5757' };
  return { label: 'Unpaid', color: '#2D9CDB' };
};

const escapeHtml = (value: string | number) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const Invoices = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('INV-0001');
  const [formData, setFormData] = useState<InvoiceFormData>(buildEmptyInvoiceForm());
  const [editingInvoiceId, setEditingInvoiceId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { canDeleteRecords, canEditRecords, userProfile } = useAuth();
  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const [customerRows, invoiceRows, paymentRows, invoiceNumber, appSettings] = await Promise.all([
        getCustomers(),
        getInvoices(),
        getPayments(),
        getNextInvoiceNumber(),
        getAppSettings()
      ]);

      setCustomers(customerRows);
      setInvoices(invoiceRows);
      setPayments(paymentRows);
      setNextInvoiceNumber(invoiceNumber);
      setSettings(appSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load invoice data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getPaidAmount = (invoiceId: string) => {
    return payments
      .filter((payment) => payment.invoiceId === invoiceId)
      .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
  };

  const invoiceRows = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    const rows = invoices
      .map((invoice) => {
        const paidAmount = getPaidAmount(invoice.id);
        const outstanding = getPendingAmount(invoice.totalSales, paidAmount);
        const customer = customers.find((item) => item.id === invoice.customerId);
        const effectiveDueDate = calculateDynamicDueDate(invoice.date, customer?.tier ?? 'Tier 3', settings);
        const status = getInvoiceStatus(effectiveDueDate, invoice.totalSales, paidAmount);

        return {
          ...invoice,
          effectiveDueDate,
          paidAmount,
          outstanding,
          status
        };
      })
      .filter((invoice) => {
        const matchesSearch = !term || [invoice.invoiceNumber, invoice.customerName].some((value) => value.toLowerCase().includes(term));
        const matchesCustomer = customerFilter === 'all' || invoice.customerId === customerFilter;
        const matchesStatus = statusFilter === 'all' || invoice.status.label === statusFilter;
        return matchesSearch && matchesCustomer && matchesStatus;
      });

    return sortNewestFirst(rows, ['updatedAt', 'createdAt', 'date']);
  }, [customerFilter, customers, invoices, payments, searchText, settings, statusFilter]);

  const recalculateTotals = (nextFormData: InvoiceFormData): InvoiceFormData => {
    const totalSales = Number(nextFormData.salesAmount) || 0;
    const costAmount = Number(nextFormData.costAmount) || 0;
    const transportAmount = Number(nextFormData.transportAmount) || 0;
    const totalCost = costAmount + transportAmount;

    return {
      ...nextFormData,
      salesAmount: totalSales,
      costAmount,
      transportAmount,
      totalSales,
      totalCost,
      totalProfit: totalSales - totalCost
    };
  };

  const handleFieldChange = (field: keyof InvoiceFormData, value: string) => {
    if (field === 'customerId') {
      const selectedCustomer = customers.find((customer) => customer.id === value);

      setFormData((current) => ({
        ...current,
        customerId: value,
        customerName: selectedCustomer?.name ?? '',
        dueDate: selectedCustomer ? calculateDueDate(current.date, selectedCustomer.tier, settings) : current.date
      }));
      return;
    }

    if (field === 'date') {
      const selectedCustomer = customers.find((customer) => customer.id === formData.customerId);
      setFormData((current) => ({
        ...current,
        date: value,
        dueDate: selectedCustomer ? calculateDueDate(value, selectedCustomer.tier, settings) : value
      }));
      return;
    }

    if (field === 'salesAmount' || field === 'costAmount' || field === 'transportAmount') {
      setFormData((current) => recalculateTotals({ ...current, [field]: Number(value) || 0 }));
      return;
    }

    setFormData((current) => ({
      ...current,
      [field]: value
    }));
  };

  const resetForm = () => {
    setFormData(buildEmptyInvoiceForm());
    setEditingInvoiceId('');
  };

  const canEditInvoice = (invoice: Invoice) => {
    if (canEditRecords) return true;
    return (invoice.createdAt || '').slice(0, 10) === getTodayDateString();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formData.customerId || formData.totalSales <= 0) {
      setError('Customer and sales amount are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (editingInvoiceId) {
        await updateInvoiceRecord(editingInvoiceId, formData, auditUser);
        setMessage('Invoice updated successfully.');
      } else {
        await createInvoice(formData, auditUser);
        setMessage('Invoice created successfully.');
      }

      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save invoice.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (invoice: Invoice) => {
    if (!canEditInvoice(invoice)) {
      setError('Staff can only edit invoices created today. Ask an Admin to edit old invoices.');
      return;
    }

    setEditingInvoiceId(invoice.id);
    setFormData({
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      date: invoice.date,
      dueDate: invoice.dueDate,
      salesAmount: invoice.salesAmount,
      costAmount: invoice.costAmount,
      transportAmount: invoice.transportAmount,
      totalSales: invoice.totalSales,
      totalCost: invoice.totalCost,
      totalProfit: invoice.totalProfit,
      notes: invoice.notes
    });
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (invoice: Invoice) => {
    try {
      if (!canDeleteRecords) {
        setError('Only Admin users can delete invoice records.');
        return;
      }

      // This where-query checks payment history before removing the invoice document.
      const linkedPayments = await getPaymentsByInvoiceId(invoice.id);
      const extraWarning = linkedPayments.length > 0 ? ` This invoice has ${linkedPayments.length} payment(s). Payment documents will remain in Firestore for audit history.` : '';
      const confirmed = window.confirm(`Delete invoice ${invoice.invoiceNumber}?${extraWarning}`);

      if (!confirmed) return;

      await deleteInvoiceRecord(invoice.id, auditUser);
      setMessage('Invoice deleted successfully.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete invoice.');
    }
  };

  const handlePrint = (invoice: Invoice) => {
    const paidAmount = getPaidAmount(invoice.id);
    const outstanding = getPendingAmount(invoice.totalSales, paidAmount);
    const printWindow = window.open('', '_blank', 'width=900,height=700');

    if (!printWindow) return;

    // The print view is customer-facing, so internal cost, transport, and profit values are hidden.
    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(invoice.invoiceNumber)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0B1F3A; padding: 32px; }
            .header { display: flex; justify-content: space-between; border-bottom: 3px solid #D4AF37; padding-bottom: 18px; margin-bottom: 24px; }
            .brand { font-size: 26px; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { padding: 12px; border: 1px solid #D8DEE9; text-align: left; }
            th { background: #0B1F3A; color: white; }
            .total { font-size: 18px; font-weight: 800; color: #D4AF37; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="brand">Pharma ERP Invoice</div>
              <div>Customer Intelligence ERP</div>
            </div>
            <div>
              <strong>${escapeHtml(invoice.invoiceNumber)}</strong><br />
              Date: ${escapeHtml(invoice.date)}<br />
              Due: ${escapeHtml(invoice.dueDate)}
            </div>
          </div>
          <div><strong>Customer:</strong> ${escapeHtml(invoice.customerName)}</div>
          <table>
            <tr><th>Description</th><th>Amount</th></tr>
            <tr><td>Sales Amount</td><td>${formatMoney(invoice.totalSales)}</td></tr>
            <tr><td>Paid</td><td>${formatMoney(paidAmount)}</td></tr>
            <tr><td class="total">Outstanding</td><td class="total">${formatMoney(outstanding)}</td></tr>
          </table>
          <p>${escapeHtml(invoice.notes || '')}</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const formGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 14
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    marginTop: 6,
    color: '#0B1F3A'
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontWeight: 700,
    fontSize: 13
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: 1080,
    borderCollapse: 'collapse'
  };

  const headerCellStyle: CSSProperties = {
    padding: '14px 16px',
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4',
    textAlign: 'left',
    color: '#0B1F3A',
    fontSize: 13,
    fontWeight: 800
  };

  const cellStyle: CSSProperties = {
    padding: '14px 16px',
    borderBottom: '1px solid #E8EDF4',
    color: '#0B1F3A',
    verticalAlign: 'top'
  };

  return (
    <div>
      <SectionHeader
        title="Invoices"
        description="Create, edit, print, filter, and delete Firestore invoices with automatic sequential numbering."
      />

      <form style={cardStyle} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 800 }}>{editingInvoiceId ? 'Edit Invoice' : 'Create Invoice'}</div>
            <div style={{ color: '#67738E', marginTop: 4 }}>Next invoice number: {editingInvoiceId ? 'Existing number retained' : nextInvoiceNumber}</div>
          </div>
          <div style={{ color: formData.totalProfit >= 0 ? '#1B7F3A' : '#B42318', fontWeight: 800 }}>
            Estimated Profit: {formatMoney(formData.totalProfit)}
          </div>
        </div>

        <div style={formGridStyle}>
          <label style={labelStyle}>
            Customer
            <select style={inputStyle} value={formData.customerId} onChange={(event) => handleFieldChange('customerId', event.target.value)}>
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Invoice Date
            <input style={inputStyle} type="date" value={formData.date} onChange={(event) => handleFieldChange('date', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Due Date
            <input style={inputStyle} type="date" value={formData.dueDate} onChange={(event) => handleFieldChange('dueDate', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Sales Amount
            <input style={inputStyle} type="number" min="0" value={formData.salesAmount} onChange={(event) => handleFieldChange('salesAmount', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Cost Amount
            <input style={inputStyle} type="number" min="0" value={formData.costAmount} onChange={(event) => handleFieldChange('costAmount', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Transport Amount
            <input style={inputStyle} type="number" min="0" value={formData.transportAmount} onChange={(event) => handleFieldChange('transportAmount', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Notes
            <input style={inputStyle} value={formData.notes} onChange={(event) => handleFieldChange('notes', event.target.value)} />
          </label>
        </div>

        {error ? <div style={{ color: '#B42318', marginTop: 12 }}>{error}</div> : null}
        {message ? <div style={{ color: '#1B7F3A', marginTop: 12 }}>{message}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="submit" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} disabled={saving}>
            {saving ? 'Saving...' : editingInvoiceId ? 'Update Invoice' : 'Create Invoice'}
          </button>
          {editingInvoiceId ? (
            <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div style={cardStyle}>
        <div style={formGridStyle}>
          <label style={labelStyle}>
            Search Invoice
            <input style={inputStyle} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Invoice number or customer" />
          </label>
          <label style={labelStyle}>
            Customer Filter
            <select style={inputStyle} value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)}>
              <option value="all">All customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Status Filter
            <select style={inputStyle} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="Paid">Paid</option>
              <option value="Partial">Partial</option>
              <option value="Unpaid">Unpaid</option>
              <option value="Overdue">Overdue</option>
            </select>
          </label>
        </div>

        <div style={{ color: '#67738E', fontSize: 12, marginTop: 16 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto', borderRadius: 14, border: '1px solid #E8EDF4', marginTop: 8 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Invoice</th>
                <th style={headerCellStyle}>Customer</th>
                <th style={headerCellStyle}>Date</th>
                <th style={headerCellStyle}>Due</th>
                <th style={headerCellStyle}>Sales</th>
                <th style={headerCellStyle}>Cost</th>
                <th style={headerCellStyle}>Transport</th>
                <th style={headerCellStyle}>Profit</th>
                <th style={headerCellStyle}>Paid</th>
                <th style={headerCellStyle}>Outstanding</th>
                <th style={headerCellStyle}>Status</th>
                <th style={headerCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={cellStyle} colSpan={12}>Loading invoices...</td></tr>
              ) : invoiceRows.length === 0 ? (
                <tr><td style={cellStyle} colSpan={12}>No invoices found.</td></tr>
              ) : (
                invoiceRows.map((invoice) => (
                  <tr key={invoice.id}>
                    <td style={cellStyle}><strong>{invoice.invoiceNumber}</strong></td>
                    <td style={cellStyle}>{invoice.customerName}</td>
                    <td style={cellStyle}>{invoice.date}</td>
                    <td style={cellStyle}>{invoice.effectiveDueDate}</td>
                    <td style={cellStyle}>{formatMoney(invoice.totalSales)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.costAmount)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.transportAmount)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.totalProfit)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.paidAmount)}</td>
                    <td style={{ ...cellStyle, color: invoice.outstanding > 0 ? '#B42318' : '#0B1F3A', fontWeight: 800 }}>
                      {formatMoney(invoice.outstanding)}
                    </td>
                    <td style={{ ...cellStyle, color: invoice.status.color, fontWeight: 800 }}>{invoice.status.label}</td>
                    <td style={cellStyle}>
                      {canEditInvoice(invoice) ? (
                        <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginRight: 8, marginBottom: 8 }} onClick={() => handleEdit(invoice)}>
                          Edit
                        </button>
                      ) : null}
                      <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A', marginRight: 8, marginBottom: 8 }} onClick={() => handlePrint(invoice)}>
                        Print
                      </button>
                      {canDeleteRecords ? (
                        <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDelete(invoice)}>
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Invoices;
