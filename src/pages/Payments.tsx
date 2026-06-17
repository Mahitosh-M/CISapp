import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  createPayment,
  deletePaymentRecord,
  getCustomers,
  getInvoices,
  getPayments,
  updatePaymentRecord
} from '../services/firestoreService';
import type { Customer, Invoice, Payment, PaymentFormData, PaymentMode } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getAmountAppliedToInvoice, getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';

const paymentModes: PaymentMode[] = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other'];

const emptyPaymentForm: PaymentFormData = {
  customerId: '',
  customerName: '',
  invoiceId: '',
  invoiceNumber: '',
  date: getTodayDateString(),
  amount: 0,
  cashDiscount: 0,
  mode: 'Cash',
  notes: ''
};

const Payments = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [formData, setFormData] = useState<PaymentFormData>(emptyPaymentForm);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [editingPaymentId, setEditingPaymentId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
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

      const [customerRows, invoiceRows, paymentRows] = await Promise.all([
        getCustomers(),
        getInvoices(),
        getPayments()
      ]);

      setCustomers(customerRows);
      setInvoices(invoiceRows);
      setPayments(paymentRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getPaidAmountForInvoice = (invoiceId: string, ignoredPaymentId = '') => {
    return payments
      .filter((payment) => payment.invoiceId === invoiceId && payment.id !== ignoredPaymentId)
      .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
  };

  const invoiceOptions = useMemo(() => {
    const customerInvoices = formData.customerId ? invoices.filter((invoice) => invoice.customerId === formData.customerId) : invoices;

    return customerInvoices
      .map((invoice) => {
        const paidAmount = getPaidAmountForInvoice(invoice.id, editingPaymentId);
        const pendingAmount = getPendingAmount(invoice.totalSales, paidAmount);

        return {
          ...invoice,
          paidAmount,
          pendingAmount
        };
      })
      .filter((invoice) => invoice.pendingAmount > 0 || invoice.id === formData.invoiceId)
      .sort((left, right) => {
        if (left.pendingAmount > 0 && right.pendingAmount <= 0) return -1;
        if (left.pendingAmount <= 0 && right.pendingAmount > 0) return 1;
        return right.date.localeCompare(left.date) || right.invoiceNumber.localeCompare(left.invoiceNumber);
      });
  }, [editingPaymentId, formData.customerId, formData.invoiceId, invoices, payments]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === formData.invoiceId);
  const selectedInvoicePaid = selectedInvoice ? getPaidAmountForInvoice(selectedInvoice.id, editingPaymentId) : 0;
  const selectedInvoiceOutstanding = selectedInvoice ? Math.max(0, selectedInvoice.totalSales - selectedInvoicePaid) : 0;
  const amountAppliedToInvoicePreview = formData.amount;
  const paymentEffect = amountAppliedToInvoicePreview + formData.cashDiscount;
  const selectedInvoiceOptions = invoiceOptions.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const selectedPendingTotal = selectedInvoiceOptions.reduce((sum, invoice) => sum + invoice.pendingAmount, 0);
  const overpaymentAmount = selectedInvoiceIds.length > 1
    ? Math.max(0, paymentEffect - selectedPendingTotal)
    : selectedInvoice
      ? Math.max(0, paymentEffect - selectedInvoiceOutstanding)
      : 0;

  const allocationPreview = useMemo(() => {
    let remainingEffect = paymentEffect;
    let remainingAmount = formData.amount;
    let remainingDiscount = formData.cashDiscount;

    return selectedInvoiceOptions.map((invoice, index) => {
      const isLastAllocation = index === selectedInvoiceOptions.length - 1;
      const appliedTotal = isLastAllocation ? Math.max(0, remainingEffect) : Math.min(invoice.pendingAmount, Math.max(0, remainingEffect));
      const amount = Math.min(remainingAmount, appliedTotal);
      const cashDiscount = Math.min(remainingDiscount, appliedTotal - amount);

      remainingEffect -= appliedTotal;
      remainingAmount -= amount;
      remainingDiscount -= cashDiscount;

      return {
        invoice,
        amount,
        cashDiscount,
        appliedTotal
      };
    });
  }, [formData.amount, formData.cashDiscount, paymentEffect, selectedInvoiceOptions]);

  const paymentRows = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    return sortNewestFirst(payments.filter((payment) => {
      const matchesSearch =
        !term ||
        [payment.customerName, payment.invoiceNumber, payment.mode].some((value) => value.toLowerCase().includes(term));
      const matchesCustomer = customerFilter === 'all' || payment.customerId === customerFilter;
      const matchesMode = modeFilter === 'all' || payment.mode === modeFilter;

      return matchesSearch && matchesCustomer && matchesMode;
    }), ['updatedAt', 'createdAt', 'date']);
  }, [customerFilter, modeFilter, payments, searchText]);

  const handleFieldChange = (field: keyof PaymentFormData, value: string) => {
    if (field === 'customerId') {
      const selectedCustomer = customers.find((customer) => customer.id === value);
      setFormData((current) => ({
        ...current,
        customerId: value,
        customerName: selectedCustomer?.name ?? '',
        invoiceId: '',
        invoiceNumber: ''
      }));
      setSelectedInvoiceIds([]);
      return;
    }

    if (field === 'invoiceId') {
      const invoice = invoices.find((item) => item.id === value);
      setFormData((current) => ({
        ...current,
        invoiceId: invoice?.id ?? '',
        invoiceNumber: invoice?.invoiceNumber ?? '',
        customerId: invoice?.customerId ?? current.customerId,
        customerName: invoice?.customerName ?? current.customerName
      }));
      setSelectedInvoiceIds(invoice?.id ? [invoice.id] : []);
      return;
    }

    if (field === 'amount' || field === 'cashDiscount') {
      setFormData((current) => ({
        ...current,
        [field]: Number(value) || 0
      }));
      return;
    }

    setFormData((current) => ({
      ...current,
      [field]: value
    }));
  };

  const resetForm = () => {
    setFormData(emptyPaymentForm);
    setSelectedInvoiceIds([]);
    setEditingPaymentId('');
  };

  const toggleSelectedInvoice = (invoiceId: string) => {
    if (editingPaymentId) return;

    setSelectedInvoiceIds((current) => {
      if (current.includes(invoiceId)) {
        const next = current.filter((id) => id !== invoiceId);
        const firstInvoice = invoices.find((invoice) => invoice.id === next[0]);

        setFormData((form) => ({
          ...form,
          invoiceId: firstInvoice?.id ?? '',
          invoiceNumber: firstInvoice?.invoiceNumber ?? ''
        }));

        return next;
      }

      const next = [...current, invoiceId];
      const firstInvoice = invoices.find((invoice) => invoice.id === next[0]);

      setFormData((form) => ({
        ...form,
        invoiceId: firstInvoice?.id ?? '',
        invoiceNumber: firstInvoice?.invoiceNumber ?? '',
        customerId: firstInvoice?.customerId ?? form.customerId,
        customerName: firstInvoice?.customerName ?? form.customerName
      }));

      return next;
    });
  };

  const canEditPayment = (payment: Payment) => {
    if (canEditRecords) return true;
    return (payment.createdAt || '').slice(0, 10) === getTodayDateString();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formData.customerId || selectedInvoiceIds.length === 0 || formData.amount <= 0) {
      setError('Customer, invoice, and payment amount are required.');
      return;
    }

    const earliestSelectedInvoice = selectedInvoiceOptions.find((invoice) => formData.date < invoice.date);
    if (earliestSelectedInvoice) {
      setError('Payment date cannot be before invoice date.');
      return;
    }

    if (!editingPaymentId && allocationPreview.every((allocation) => allocation.appliedTotal <= 0)) {
      setError('Select at least one invoice with pending amount.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (editingPaymentId) {
        await updatePaymentRecord(editingPaymentId, formData, auditUser);
        setMessage(`Payment updated. ${formatMoney(amountAppliedToInvoicePreview)} applied to ${formData.invoiceNumber}.`);
      } else {
        const payableAllocations = allocationPreview.filter((allocation) => allocation.appliedTotal > 0);
        await Promise.all(
          payableAllocations.map((allocation, index) =>
            createPayment({
              ...formData,
              invoiceId: allocation.invoice.id,
              invoiceNumber: allocation.invoice.invoiceNumber,
              customerId: allocation.invoice.customerId,
              customerName: allocation.invoice.customerName,
              amount: allocation.amount,
              cashDiscount: allocation.cashDiscount,
              notes:
                selectedInvoiceIds.length > 1
                  ? [formData.notes, `Split payment ${index + 1}/${payableAllocations.length}`].filter(Boolean).join(' | ')
                  : formData.notes
            }, auditUser)
          )
        );
        setMessage(`Payment added. ${formatMoney(paymentEffect)} recorded across ${payableAllocations.length} invoice(s).`);
      }

      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save payment.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (payment: Payment) => {
    if (!canEditPayment(payment)) {
      setError('Staff can only edit payments created today. Ask an Admin to edit old payments.');
      return;
    }

    setEditingPaymentId(payment.id);
    setSelectedInvoiceIds([payment.invoiceId]);
    setFormData({
      customerId: payment.customerId,
      customerName: payment.customerName,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      date: payment.date,
      amount: payment.amount,
      cashDiscount: payment.cashDiscount,
      mode: payment.mode,
      notes: payment.notes
    });
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (payment: Payment) => {
    if (!canDeleteRecords) {
      setError('Only Admin users can delete payment records.');
      return;
    }

    const confirmed = window.confirm(`Delete payment ${payment.id} for ${formatMoney(payment.amount)}?`);

    if (!confirmed) return;

    try {
      await deletePaymentRecord(payment.id, auditUser);
      setMessage('Payment deleted successfully.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete payment.');
    }
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
    minWidth: 940,
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
        title="Payments"
        description="Add, edit, filter, and delete Firestore payments. Multiple and partial payments per invoice are supported."
      />

      <form style={cardStyle} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 800 }}>{editingPaymentId ? 'Edit Payment' : 'Add Payment'}</div>
            <div style={{ color: '#67738E', marginTop: 4 }}>Enter any amount to record a partial or full payment against the selected invoice.</div>
          </div>
          <div style={{ color: '#0B1F3A', fontWeight: 800 }}>
            <div style={{ color: selectedPendingTotal > 0 ? '#B42318' : '#1B7F3A' }}>
              Selected Pending: {selectedInvoiceIds.length > 0 ? formatMoney(selectedPendingTotal) : 'Select invoice(s)'}
            </div>
            {selectedInvoiceIds.length > 0 ? (
              <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>This payment applies: {formatMoney(amountAppliedToInvoicePreview)}</div>
            ) : null}
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

          {!editingPaymentId && formData.customerId && invoiceOptions.length > 0 ? (
            <div style={{ gridColumn: '1 / -1', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12, background: '#F8FAFC' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontWeight: 900, color: '#0B1F3A' }}>Apply to invoices</div>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>
                  Selected pending: {formatMoney(selectedPendingTotal)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
                <label style={labelStyle}>
                  Payment Amount
                  <input style={inputStyle} type="number" min="0" value={formData.amount} onChange={(event) => handleFieldChange('amount', event.target.value)} />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
                {invoiceOptions.map((invoice) => {
                  const checked = selectedInvoiceIds.includes(invoice.id);
                  return (
                    <label
                      key={invoice.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        border: `1px solid ${checked ? '#D4AF37' : '#E8EDF4'}`,
                        background: checked ? '#FFF8E1' : '#FFFFFF',
                        borderRadius: 8,
                        padding: 10,
                        cursor: 'pointer'
                      }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleSelectedInvoice(invoice.id)} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', color: '#0B1F3A', fontWeight: 900 }}>{invoice.invoiceNumber}</span>
                        <span style={{ display: 'block', color: '#B42318', fontSize: 12, fontWeight: 800 }}>Pending {formatMoney(invoice.pendingAmount)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {allocationPreview.length > 0 ? (
                <div style={{ marginTop: 10, color: '#0B1F3A', fontSize: 12, fontWeight: 800 }}>
                  {allocationPreview.map((allocation) => (
                    <span key={allocation.invoice.id} style={{ display: 'inline-block', marginRight: 12, marginTop: 4 }}>
                      {allocation.invoice.invoiceNumber}: {formatMoney(allocation.appliedTotal)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {editingPaymentId ? (
            <label style={labelStyle}>
              Payment Amount
              <input style={inputStyle} type="number" min="0" value={formData.amount} onChange={(event) => handleFieldChange('amount', event.target.value)} />
            </label>
          ) : null}

          <label style={labelStyle}>
            Cash Discount
            <input style={inputStyle} type="number" min="0" value={formData.cashDiscount} onChange={(event) => handleFieldChange('cashDiscount', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Payment Mode
            <select style={inputStyle} value={formData.mode} onChange={(event) => handleFieldChange('mode', event.target.value as PaymentMode)}>
              {paymentModes.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Payment Date
            <input style={inputStyle} type="date" value={formData.date} onChange={(event) => handleFieldChange('date', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Notes
            <input style={inputStyle} value={formData.notes} onChange={(event) => handleFieldChange('notes', event.target.value)} />
          </label>
        </div>

        {error ? <div style={{ color: '#B42318', marginTop: 12 }}>{error}</div> : null}
        {overpaymentAmount > 0 ? (
          <div style={{ color: '#B7791F', marginTop: 12, fontWeight: 800 }}>
            Warning: this creates an advance or extra amount of {formatMoney(overpaymentAmount)}. It is allowed.
          </div>
        ) : null}
        {message ? <div style={{ color: '#1B7F3A', marginTop: 12 }}>{message}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="submit" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} disabled={saving}>
            {saving ? 'Saving...' : editingPaymentId ? 'Update Payment' : 'Add Payment'}
          </button>
          {editingPaymentId ? (
            <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div style={cardStyle}>
        <div style={formGridStyle}>
          <label style={labelStyle}>
            Search Payments
            <input style={inputStyle} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Customer, invoice, or mode" />
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
            Mode Filter
            <select style={inputStyle} value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
              <option value="all">All modes</option>
              {paymentModes.map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ color: '#67738E', fontSize: 12, marginTop: 16 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto', borderRadius: 14, border: '1px solid #E8EDF4', marginTop: 8 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={headerCellStyle}>Date</th>
                <th style={headerCellStyle}>Customer</th>
                <th style={headerCellStyle}>Invoice</th>
                <th style={headerCellStyle}>Amount</th>
                <th style={headerCellStyle}>Cash Discount</th>
                <th style={headerCellStyle}>Mode</th>
                <th style={headerCellStyle}>Notes</th>
                <th style={headerCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td style={cellStyle} colSpan={8}>Loading payments...</td></tr>
              ) : paymentRows.length === 0 ? (
                <tr><td style={cellStyle} colSpan={8}>No payments found.</td></tr>
              ) : (
                paymentRows.map((payment) => (
                  <tr key={payment.id}>
                    <td style={cellStyle}>{payment.date}</td>
                    <td style={cellStyle}>{payment.customerName}</td>
                    <td style={cellStyle}>{payment.invoiceNumber}</td>
                    <td style={{ ...cellStyle, fontWeight: 800 }}>
                      {formatMoney(payment.amount)}
                      {payment.amountUsedForOldBalance > 0 ? (
                        <div style={{ color: '#67738E', fontSize: 12, fontWeight: 700 }}>
                          Old balance: {formatMoney(payment.amountUsedForOldBalance)}
                        </div>
                      ) : null}
                      {payment.amountUsedForOldBalance > 0 ? (
                        <div style={{ color: '#67738E', fontSize: 12, fontWeight: 700 }}>
                          Invoice: {formatMoney(getAmountAppliedToInvoice(payment))}
                        </div>
                      ) : null}
                    </td>
                    <td style={cellStyle}>{formatMoney(payment.cashDiscount)}</td>
                    <td style={cellStyle}>{payment.mode}</td>
                    <td style={cellStyle}>{payment.notes || '-'}</td>
                    <td style={cellStyle}>
                      {canEditPayment(payment) ? (
                        <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginRight: 8 }} onClick={() => handleEdit(payment)}>
                          Edit
                        </button>
                      ) : null}
                      {canDeleteRecords ? (
                        <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDelete(payment)}>
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

export default Payments;
