import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  calculateDueDate,
  createPayment,
  createInvoice,
  deleteInvoiceRecord,
  getAppSettings,
  getCustomers,
  getInvoices,
  getInvoicesByCustomerId,
  getNextInvoiceNumber,
  getPaymentsByInvoiceId,
  getPaymentsByInvoiceIds,
  syncCustomerPartnerLevelsFromFirestore,
  updateInvoiceRecord,
  updatePaymentRecord
} from '../services/firestoreService';
import type { AppSettings, Customer, Invoice, InvoiceFormData, Payment, PaymentMode } from '../types';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { getTodayDateString } from '../utils/dateUtils';
import { formatDate, formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle } from '../utils/listDisplay';
import { getInvoiceDisplayNumber } from '../utils/openingBalance';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';
import { DEFAULT_SETTINGS, getEffectiveInvoiceDueDate } from '../utils/settings';

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

const LIST_PAGE_SIZE = 1;
const CUSTOMER_LIST_PAGE_SIZE = 3;
const LOAD_MORE_PAGE_SIZE = 5;
const invoiceCreationPaymentNote = 'Payment entered during invoice creation';

const getInvoiceNumberRank = (invoiceNumber: string) => {
  const match = invoiceNumber.match(/(\d+)(?!.*\d)/);
  return match ? Number(match[1]) : 0;
};

const sortByLatestInvoiceNumber = <T extends { invoiceNumber: string }>(rows: T[]) => {
  return [...rows].sort((left, right) => {
    const numberDifference = getInvoiceNumberRank(right.invoiceNumber) - getInvoiceNumberRank(left.invoiceNumber);
    return numberDifference || right.invoiceNumber.localeCompare(left.invoiceNumber);
  });
};

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

const getDaysBetweenDateStrings = (fromDate: string, toDate: string) => {
  const fromTime = new Date(`${fromDate}T00:00:00`).getTime();
  const toTime = new Date(`${toDate}T00:00:00`).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return 0;
  return Math.ceil((toTime - fromTime) / (24 * 60 * 60 * 1000));
};

const formatWhatsAppPhoneNumber = (mobile: string) => {
  const digits = mobile.replace(/\D/g, '');

  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0')) return digits;

  return '';
};

const formatReminderAmount = (amount: number) => {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(amount)));
};

const Invoices = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('INV-0001');
  const [formData, setFormData] = useState<InvoiceFormData>(buildEmptyInvoiceForm());
  const [sameDayPaymentAmount, setSameDayPaymentAmount] = useState(0);
  const [sameDayCashDiscount, setSameDayCashDiscount] = useState(0);
  const [sameDayPaymentMode, setSameDayPaymentMode] = useState<PaymentMode>('Cash');
  const [editingInvoiceId, setEditingInvoiceId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [invoiceLimit, setInvoiceLimit] = useState(LIST_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { canDeleteRecords, userProfile } = useAuth();
  const isMobile = useIsMobile();
  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');

      const invoiceRead =
        customerFilter === 'all'
          ? getInvoices({ limitCount: invoiceLimit, sortBy: 'invoiceNumber' })
          : getInvoicesByCustomerId(customerFilter, { limitCount: invoiceLimit, sortBy: 'invoiceNumber' });

      const [customerRows, invoiceRows, invoiceNumber, appSettings] = await Promise.all([
        getCustomers(),
        invoiceRead,
        getNextInvoiceNumber(),
        getAppSettings()
      ]);
      const paymentRows = await getPaymentsByInvoiceIds(invoiceRows.map((invoice) => invoice.id));

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
  }, [customerFilter, invoiceLimit]);

  useEffect(() => {
    setInvoiceLimit(customerFilter === 'all' ? LIST_PAGE_SIZE : CUSTOMER_LIST_PAGE_SIZE);
  }, [customerFilter]);

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
        const effectiveDueDate = getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, customer?.tier ?? 'Tier 4', settings);
        const status = getInvoiceStatus(effectiveDueDate, invoice.totalSales, paidAmount);

        return {
          ...invoice,
          effectiveDueDate,
          customerMobile: customer?.mobile ?? '',
          paidAmount,
          outstanding,
          status
        };
      })
      .filter((invoice) => {
        const matchesSearch = !term || [getInvoiceDisplayNumber(invoice), invoice.invoiceNumber, invoice.customerName].some((value) => value.toLowerCase().includes(term));
        const matchesCustomer = customerFilter === 'all' || invoice.customerId === customerFilter;
        const matchesStatus = statusFilter === 'all' || invoice.status.label === statusFilter;
        return matchesSearch && matchesCustomer && matchesStatus;
      });

    return sortByLatestInvoiceNumber(rows);
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
    setSameDayPaymentAmount(0);
    setSameDayCashDiscount(0);
    setSameDayPaymentMode('Cash');
    setEditingInvoiceId('');
  };

  const canEditInvoice = (_invoice: Invoice) => true;

  const getInvoiceCreationPayment = (invoiceId: string, paymentRows = payments) => {
    return paymentRows.find((payment) => payment.invoiceId === invoiceId && payment.notes === invoiceCreationPaymentNote);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formData.customerId || formData.totalSales <= 0) {
      setError('Customer and sales amount are required.');
      return;
    }

    if (!formData.date || !formData.dueDate) {
      setError('Invoice date and due date must be valid dates.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (editingInvoiceId) {
        await updateInvoiceRecord(editingInvoiceId, formData, auditUser);
        const cleanPaymentAmount = Math.max(0, Number(sameDayPaymentAmount) || 0);
        const cleanCashDiscount = Math.max(0, Number(sameDayCashDiscount) || 0);
        const currentInvoice = invoices.find((invoice) => invoice.id === editingInvoiceId);
        const linkedPayments = await getPaymentsByInvoiceId(editingInvoiceId);
        const invoiceCreationPayment = getInvoiceCreationPayment(editingInvoiceId, linkedPayments);

        if (cleanPaymentAmount > 0) {
          const paymentPayload = {
            customerId: formData.customerId,
            customerName: formData.customerName,
            invoiceId: editingInvoiceId,
            invoiceNumber: currentInvoice?.invoiceNumber ?? invoiceCreationPayment?.invoiceNumber ?? '',
            date: formData.date,
            amount: cleanPaymentAmount,
            cashDiscount: cleanCashDiscount,
            mode: sameDayPaymentMode,
            notes: invoiceCreationPaymentNote
          };

          if (invoiceCreationPayment) {
            await updatePaymentRecord(invoiceCreationPayment.id, paymentPayload, auditUser);
          } else {
            await createPayment(paymentPayload, auditUser);
          }
        }

        setMessage('Invoice updated successfully.');
      } else {
        const createdInvoice = await createInvoice(formData, auditUser);
        const cleanPaymentAmount = Math.max(0, Number(sameDayPaymentAmount) || 0);
        const cleanCashDiscount = Math.max(0, Number(sameDayCashDiscount) || 0);

        if (cleanPaymentAmount > 0) {
          const remainingAfterAdvance = Math.max(0, formData.totalSales - createdInvoice.advanceAppliedAmount);
          const amountAppliedToInvoice = Math.min(cleanPaymentAmount, remainingAfterAdvance);
          const cashDiscountApplied = Math.min(cleanCashDiscount, Math.max(0, remainingAfterAdvance - amountAppliedToInvoice));

          await createPayment({
            customerId: formData.customerId,
            customerName: formData.customerName,
            invoiceId: createdInvoice.id,
            invoiceNumber: createdInvoice.invoiceNumber,
            date: formData.date,
            amount: cleanPaymentAmount,
            amountAppliedToInvoice,
            cashDiscount: cashDiscountApplied,
            mode: sameDayPaymentMode,
            notes: invoiceCreationPaymentNote
          }, auditUser);
        }

        const advanceMessage = createdInvoice.advanceAppliedAmount > 0
          ? ` ${formatMoney(createdInvoice.advanceAppliedAmount)} customer advance was adjusted automatically.`
          : '';
        setMessage(
          (cleanPaymentAmount > 0 ? 'Invoice and same-day payment created successfully.' : 'Invoice created successfully.') + advanceMessage
        );
      }

      await syncCustomerPartnerLevelsFromFirestore();
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save invoice.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (invoice: Invoice) => {
    const invoiceCreationPayment = getInvoiceCreationPayment(invoice.id);

    setEditingInvoiceId(invoice.id);
    setSameDayPaymentAmount(invoiceCreationPayment?.amount ?? 0);
    setSameDayCashDiscount(invoiceCreationPayment?.cashDiscount ?? 0);
    setSameDayPaymentMode(invoiceCreationPayment?.mode ?? 'Cash');
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
      const extraWarning = linkedPayments.length > 0 ? ` This invoice has ${linkedPayments.length} linked payment(s). They will also be deleted and any old-balance clearing from those payments will be reversed.` : '';
      const confirmed = window.confirm(`Delete invoice ${invoice.invoiceNumber}?${extraWarning}`);

      if (!confirmed) return;

      const deleteResult = await deleteInvoiceRecord(invoice.id, auditUser);
      await syncCustomerPartnerLevelsFromFirestore();
      setMessage(
        deleteResult.deletedPaymentCount > 0
          ? `Invoice deleted with ${deleteResult.deletedPaymentCount} linked payment(s).`
          : 'Invoice deleted successfully.'
      );
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
            body { font-family: Arial, sans-serif; color: #11185A; padding: 32px; }
            .header { display: flex; justify-content: space-between; border-bottom: 3px solid #D4AF37; padding-bottom: 18px; margin-bottom: 24px; }
            .brand { font-size: 26px; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            th, td { padding: 12px; border: 1px solid #D8DEE9; text-align: left; }
            th { background: linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%); color: white; }
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
              Date: ${escapeHtml(formatDate(invoice.date))}<br />
              Due: ${escapeHtml(formatDate(invoice.dueDate))}
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

  const handleWhatsAppReminder = (invoice: Invoice & { effectiveDueDate: string; outstanding: number; customerMobile?: string }) => {
    const phoneNumber = formatWhatsAppPhoneNumber(invoice.customerMobile || '');

    if (!phoneNumber) {
      setError(`Customer mobile number is missing or invalid for ${invoice.customerName}. Add a valid phone number before sending a WhatsApp reminder.`);
      return;
    }

    const daysRemaining = getDaysBetweenDateStrings(getTodayDateString(), invoice.effectiveDueDate);
    const reminderMessage = [
      'Namaste Sir,',
      '',
      `Invoice No. ${invoice.invoiceNumber} dated ${formatDate(invoice.date)} is due in ${daysRemaining} days.`,
      '',
      `Outstanding amount: ₹${formatReminderAmount(invoice.outstanding)}`,
      '',
      "Please make the payment on time so you don't miss out on your Partner Coin (PC) benefit.",
      '',
      'Thank you'
    ].join('\n');

    setError('');
    window.open(`https://wa.me/${phoneNumber}?text=${encodeURIComponent(reminderMessage)}`, '_blank', 'noopener,noreferrer');
  };

  const handleLoadMore = () => {
    // Free-tier safety: older rows are fetched only when the user asks for them.
    setInvoiceLimit((current) => current + LOAD_MORE_PAGE_SIZE);
  };

  const cardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 12,
    padding: isMobile ? 14 : 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const recordCardStyle: CSSProperties = {
    ...cardStyle,
    background: 'linear-gradient(135deg, #071A33 0%, #020B18 52%, #000000 100%)',
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 18px 38px rgba(0, 0, 0, 0.34)'
  };

  const formGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: isMobile ? 10 : 14
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    marginTop: 6,
    color: '#11185A'
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
    minWidth: isMobile ? 760 : 1080,
    borderCollapse: 'collapse'
  };

  const headerCellStyle: CSSProperties = {
    padding: isMobile ? '9px 10px' : '14px 16px',
    background: 'var(--role-card-subtle)',
    borderBottom: '1px solid var(--role-card-border)',
    textAlign: 'left',
    color: '#FFFFFF',
    fontSize: isMobile ? 11 : 13,
    fontWeight: 800
  };

  const cellStyle: CSSProperties = {
    padding: isMobile ? '9px 10px' : '14px 16px',
    borderBottom: '1px solid var(--role-card-border)',
    color: '#FFFFFF',
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
            <div style={{ color: '#D7DEEA', marginTop: 4 }}>Next invoice number: {editingInvoiceId ? 'Existing number retained' : nextInvoiceNumber}</div>
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
                <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Invoice Date
            <input style={inputStyle} type="date" required value={formData.date} onChange={(event) => handleFieldChange('date', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Due Date
            <input style={inputStyle} type="date" required value={formData.dueDate} onChange={(event) => handleFieldChange('dueDate', event.target.value)} />
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

          <label style={labelStyle}>
            Payment Received
            <input
              style={inputStyle}
              type="number"
              min="0"
              value={sameDayPaymentAmount}
              onChange={(event) => setSameDayPaymentAmount(Number(event.target.value) || 0)}
            />
          </label>

          <label style={labelStyle}>
            Cash Discount
            <input
              style={inputStyle}
              type="number"
              min="0"
              value={sameDayCashDiscount}
              onChange={(event) => setSameDayCashDiscount(Number(event.target.value) || 0)}
            />
          </label>

        </div>

        {error ? <div style={{ color: '#FCA5A5', marginTop: 12 }}>{error}</div> : null}
        {message ? <div style={{ color: '#1B7F3A', marginTop: 12 }}>{message}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="submit" style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A' }} disabled={saving}>
            {saving ? 'Saving...' : editingInvoiceId ? 'Update Invoice' : 'Create Invoice'}
          </button>
          {editingInvoiceId ? (
            <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A' }} onClick={resetForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div style={recordCardStyle}>
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
                <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
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

        <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 16 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, maxHeight: 520, overflowX: 'auto', overflowY: 'auto', borderRadius: 14, border: '1px solid #E8EDF4', marginTop: 8 }}>
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
                    <td style={cellStyle}><strong>{getInvoiceDisplayNumber(invoice)}</strong></td>
                    <td style={cellStyle}>{invoice.customerName}</td>
                    <td style={cellStyle}>{formatDate(invoice.date)}</td>
                    <td style={cellStyle}>{formatDate(invoice.effectiveDueDate)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.totalSales)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.costAmount)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.transportAmount)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.totalProfit)}</td>
                    <td style={cellStyle}>{formatMoney(invoice.paidAmount)}</td>
                    <td style={{ ...cellStyle, color: invoice.outstanding > 0 ? '#B42318' : '#11185A', fontWeight: 800 }}>
                      {formatMoney(invoice.outstanding)}
                    </td>
                    <td style={{ ...cellStyle, color: invoice.status.color, fontWeight: 800 }}>{invoice.status.label}</td>
                    <td style={cellStyle}>
                      {canEditInvoice(invoice) ? (
                        <button type="button" style={{ ...buttonStyle, background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', color: '#FFFFFF', marginRight: 8, marginBottom: 8 }} onClick={() => handleEdit(invoice)}>
                          Edit
                        </button>
                      ) : null}
                      <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A', marginRight: 8, marginBottom: 8 }} onClick={() => handlePrint(invoice)}>
                        Print
                      </button>
                      {invoice.outstanding > 0 ? (
                        <button
                          type="button"
                          style={{ ...buttonStyle, background: '#25D366', color: '#11185A', marginRight: 8, marginBottom: 8 }}
                          onClick={() => handleWhatsAppReminder(invoice)}
                        >
                          Send WhatsApp Reminder
                        </button>
                      ) : null}
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
        {!loading && invoices.length >= invoiceLimit ? (
          <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginTop: 12 }} onClick={handleLoadMore}>
            Load 5 more
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default Invoices;
