import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  createPayment,
  deletePaymentRecord,
  getCustomers,
  getInvoicesByCustomerId,
  getPayments,
  getPaymentsByInvoiceIds,
  getPaymentsByCustomerId,
  updatePaymentRecord,
  type PaymentSaveResult
} from '../services/firestoreService';
import { recalculateCustomerDerivedData } from '../services/derivedDataService';
import type { Customer, Invoice, Payment, PaymentFormData } from '../types';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { getTodayDateString } from '../utils/dateUtils';
import { formatDate, formatMoney } from '../utils/formatters';
import { formatPc } from '../utils/loyalty';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getInvoiceDisplayNumber, sortInvoicesForPaymentAllocation } from '../utils/openingBalance';
import { allocateReceiptOldestFirst } from '../utils/paymentAllocation';
import { getAmountAppliedToInvoice, getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';
import { summarizePaymentSaveResults } from '../utils/paymentSaveResult';

const LIST_PAGE_SIZE = 1;
const CUSTOMER_LIST_PAGE_SIZE = 3;
const LOAD_MORE_PAGE_SIZE = 5;
const splitPaymentPattern = /Split payment\s+(\d+)\/(\d+)/i;

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

const getSplitPaymentFallbackKey = (payment: Payment) => {
  const match = payment.notes.match(splitPaymentPattern);
  if (!match) return '';

  const baseNotes = payment.notes.replace(/\s*\|?\s*Split payment\s+\d+\/\d+/i, '').trim();
  const splitCount = match[2] || '';

  return [payment.customerId, payment.date, payment.mode, baseNotes, splitCount].join('|');
};

const createSplitPaymentGroupId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `split_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const Payments = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customerPayments, setCustomerPayments] = useState<Payment[]>([]);
  const [loadingCustomerPayments, setLoadingCustomerPayments] = useState(false);
  const [formData, setFormData] = useState<PaymentFormData>(emptyPaymentForm);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [editingPaymentId, setEditingPaymentId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [paymentLimit, setPaymentLimit] = useState(LIST_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
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

      const paymentRead =
        customerFilter === 'all'
          ? getPayments({ limitCount: paymentLimit, sortBy: 'createdAt' })
          : getPaymentsByCustomerId(customerFilter, { limitCount: paymentLimit });

      const [customerRows, paymentRows] = await Promise.all([
        getCustomers(),
        paymentRead
      ]);

      setCustomers(customerRows);
      setPayments(paymentRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load payments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [customerFilter, paymentLimit]);

  useEffect(() => {
    setPaymentLimit(customerFilter === 'all' ? LIST_PAGE_SIZE : CUSTOMER_LIST_PAGE_SIZE);
  }, [customerFilter]);

  useEffect(() => {
    let isActive = true;

    if (!formData.customerId) {
      setInvoices([]);
      setCustomerPayments([]);
      setLoadingCustomerPayments(false);
      return undefined;
    }

    setCustomerPayments([]);
    setLoadingCustomerPayments(true);

    // Every invoice is required here: advance is valid only after the customer's
    // complete pending balance has been cleared.
    getInvoicesByCustomerId(formData.customerId)
      .then(async (invoiceRows) => ({
        invoiceRows,
        paymentRows: await getPaymentsByInvoiceIds(invoiceRows.map((invoice) => invoice.id))
      }))
      .then(({ invoiceRows, paymentRows }) => {
        if (isActive) {
          setInvoices(invoiceRows);
          setCustomerPayments(paymentRows);
        }
      })
      .catch((err) => {
        if (isActive) {
          setError(err instanceof Error ? err.message : 'Unable to load customer payments.');
        }
      })
      .finally(() => {
        if (isActive) {
          setLoadingCustomerPayments(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [formData.customerId]);

  const paymentsForAllocation = formData.customerId ? customerPayments : payments;

  const getPaidAmountForInvoice = (invoiceId: string, ignoredPaymentId = '') => {
    return paymentsForAllocation
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
        return sortInvoicesForPaymentAllocation([left, right])[0] === left ? -1 : 1;
      });
  }, [editingPaymentId, formData.customerId, formData.invoiceId, invoices, paymentsForAllocation]);

  const pendingInvoiceOptions = useMemo(
    () => invoiceOptions.filter((invoice) => invoice.pendingAmount > 0),
    [invoiceOptions]
  );
  const totalPendingAmount = pendingInvoiceOptions.reduce((sum, invoice) => sum + invoice.pendingAmount, 0);
  const selectedCustomer = customers.find((customer) => customer.id === formData.customerId);

  const selectedInvoice = invoices.find((invoice) => invoice.id === formData.invoiceId);
  const selectedInvoicePaid = selectedInvoice ? getPaidAmountForInvoice(selectedInvoice.id, editingPaymentId) : 0;
  const selectedInvoiceOutstanding = selectedInvoice ? Math.max(0, selectedInvoice.totalSales - selectedInvoicePaid) : 0;
  const amountAppliedToInvoicePreview = formData.amount;
  const paymentEffect = amountAppliedToInvoicePreview + formData.cashDiscount;
  const selectedInvoiceOptions = selectedInvoiceIds
    .map((invoiceId) => invoiceOptions.find((invoice) => invoice.id === invoiceId))
    .filter((invoice): invoice is Invoice & { paidAmount: number; pendingAmount: number } => Boolean(invoice));
  const selectedPendingTotal = selectedInvoiceOptions.reduce((sum, invoice) => sum + invoice.pendingAmount, 0);
  const allocationResult = useMemo(() => {
    const invoicesForAllocation = editingPaymentId ? selectedInvoiceOptions : pendingInvoiceOptions;
    return allocateReceiptOldestFirst(invoicesForAllocation, formData.amount, formData.cashDiscount);
  }, [editingPaymentId, formData.amount, formData.cashDiscount, pendingInvoiceOptions, selectedInvoiceOptions]);
  const allocationPreview = allocationResult.allocations;
  const appliedTotalPreview = allocationResult.appliedTotal;
  const overpaymentAmount = allocationResult.advanceAmount;

  const splitPaymentTotalById = useMemo(() => {
    const totals = new Map<string, number>();
    const fallbackGroups = new Map<string, Payment[]>();

    payments.forEach((payment) => {
      if ((payment.splitPaymentTotalAmount ?? 0) > 0) {
        totals.set(payment.id, payment.splitPaymentTotalAmount ?? 0);
        return;
      }

      const fallbackKey = getSplitPaymentFallbackKey(payment);
      if (!fallbackKey) return;

      const group = fallbackGroups.get(fallbackKey) ?? [];
      group.push(payment);
      fallbackGroups.set(fallbackKey, group);
    });

    fallbackGroups.forEach((group) => {
      const total = group.reduce((sum, payment) => sum + payment.amount, 0);
      group.forEach((payment) => totals.set(payment.id, total));
    });

    return totals;
  }, [payments]);

  useEffect(() => {
    if (editingPaymentId || !formData.customerId) return;

    if (paymentEffect <= 0) {
      if (selectedInvoiceIds.length > 0) {
        setSelectedInvoiceIds([]);
        setFormData((current) => ({ ...current, invoiceId: '', invoiceNumber: '' }));
      }
      return;
    }

    let remainingEffect = paymentEffect;
    const autoSelectedInvoices: typeof pendingInvoiceOptions = [];

    for (const invoice of pendingInvoiceOptions) {
      if (remainingEffect <= 0) break;
      autoSelectedInvoices.push(invoice);
      remainingEffect -= invoice.pendingAmount;
    }

    const nextSelectedIds = autoSelectedInvoices.map((invoice) => invoice.id);
    const firstInvoice = autoSelectedInvoices[0];
    const currentIdsKey = selectedInvoiceIds.join('|');
    const nextIdsKey = nextSelectedIds.join('|');

    if (currentIdsKey !== nextIdsKey || formData.invoiceId !== (firstInvoice?.id ?? '')) {
      setSelectedInvoiceIds(nextSelectedIds);
      setFormData((current) => ({
        ...current,
        invoiceId: firstInvoice?.id ?? '',
        invoiceNumber: firstInvoice?.invoiceNumber ?? ''
      }));
    }
  }, [editingPaymentId, formData.customerId, formData.invoiceId, paymentEffect, pendingInvoiceOptions, selectedInvoiceIds]);

  const filteredPaymentRows = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    return sortNewestFirst(payments.filter((payment) => {
      const matchesSearch =
        !term ||
        [payment.customerName, payment.invoiceNumber].some((value) => value.toLowerCase().includes(term));
      const matchesCustomer = customerFilter === 'all' || payment.customerId === customerFilter;

      return matchesSearch && matchesCustomer;
    }), ['createdAt', 'date']);
  }, [customerFilter, payments, searchText]);

  const paymentRows = filteredPaymentRows;

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
    if (!editingPaymentId) return;
    const invoice = invoices.find((item) => item.id === invoiceId);
    if (!invoice) return;

    setSelectedInvoiceIds([invoice.id]);
    setFormData((form) => ({
      ...form,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName
    }));
  };

  const canEditPayment = (payment: Payment) => payment.paymentKind !== 'advance_application';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formData.customerId || formData.amount <= 0) {
      setError('Customer and payment amount are required.');
      return;
    }

    const earliestSelectedInvoice = selectedInvoiceOptions.find((invoice) => formData.date < invoice.date);
    if (earliestSelectedInvoice) {
      setError('Payment date cannot be before invoice date.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setMessage('');
      setWarning('');
      const previousCustomerId = editingPaymentId
        ? payments.find((payment) => payment.id === editingPaymentId)?.customerId
        : undefined;
      const saveResults: PaymentSaveResult[] = [];
      let successMessage = '';

      if (editingPaymentId) {
        const amountAppliedToInvoice = Math.min(
          formData.amount,
          Math.max(0, selectedInvoiceOutstanding - formData.cashDiscount)
        );
        saveResults.push(await updatePaymentRecord(editingPaymentId, { ...formData, amountAppliedToInvoice }, auditUser));
        successMessage = `Payment updated. ${formatMoney(formData.amount)} received; ${formatMoney(amountAppliedToInvoice)} applied to ${formData.invoiceNumber}.`;
      } else {
        const payableAllocations = allocationPreview.filter((allocation) => allocation.appliedTotal > 0);
        const splitPaymentGroupId = payableAllocations.length > 1 ? createSplitPaymentGroupId() : '';
        if (payableAllocations.length > 0) {
          for (const [index, allocation] of payableAllocations.entries()) {
            saveResults.push(await createPayment({
              ...formData,
              invoiceId: allocation.invoice.id,
              invoiceNumber: allocation.invoice.invoiceNumber,
              customerId: allocation.invoice.customerId,
              customerName: allocation.invoice.customerName,
              amount: allocation.amount,
              amountAppliedToInvoice: allocation.amountAppliedToInvoice,
              cashDiscount: allocation.cashDiscount,
              splitPaymentGroupId: splitPaymentGroupId || undefined,
              splitPaymentTotalAmount: payableAllocations.length > 1 ? formData.amount : undefined,
              splitPaymentPart: payableAllocations.length > 1 ? index + 1 : undefined,
              splitPaymentCount: payableAllocations.length > 1 ? payableAllocations.length : undefined,
              notes:
                payableAllocations.length > 1
                  ? [formData.notes, `Split payment ${index + 1}/${payableAllocations.length}`].filter(Boolean).join(' | ')
                  : formData.notes
            }, auditUser));
          }
        } else {
          saveResults.push(await createPayment({
            ...formData,
            invoiceId: '',
            invoiceNumber: '',
            amountAppliedToInvoice: 0,
            cashDiscount: 0,
            notes: [formData.notes, 'Advance payment'].filter(Boolean).join(' | ')
          }, auditUser));
        }
        const appliedAmount = payableAllocations.reduce((sum, allocation) => sum + allocation.appliedTotal, 0);
        const advanceAmount = allocationResult.advanceAmount;
        successMessage = (
          `Payment added. ${formatMoney(formData.amount)} received; ${formatMoney(appliedAmount)} applied across ${payableAllocations.length} invoice(s)` +
          (advanceAmount > 0 ? `; ${formatMoney(advanceAmount)} stored as advance.` : '.')
        );
      }

      const derivedResults = await Promise.allSettled(
        [...new Set([previousCustomerId, formData.customerId].filter((customerId): customerId is string => Boolean(customerId)))]
          .map((customerId) => recalculateCustomerDerivedData(customerId, editingPaymentId ? 'payment_edited' : 'payment_created'))
      );
      const saveSummary = summarizePaymentSaveResults(saveResults);
      const pcConfirmation = saveSummary.creditedPc > 0
        ? ` ${formatPc(saveSummary.creditedPc)} PC credited${saveSummary.availablePc !== undefined ? `; confirmed Available PC: ${formatPc(saveSummary.availablePc)}` : ''}.`
        : '';
      const derivedWarning = derivedResults.some((result) => result.status === 'rejected')
        ? 'Payment was saved, but customer scoring and credit refresh is pending.'
        : '';

      setMessage(`${successMessage}${pcConfirmation}`);
      setWarning([...saveSummary.warnings, derivedWarning].filter(Boolean).join(' '));
      resetForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save payment.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (payment: Payment) => {
    setEditingPaymentId(payment.id);
    setSelectedInvoiceIds([payment.invoiceId]);
    setFormData({
      customerId: payment.customerId,
      customerName: payment.customerName,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoiceNumber,
      date: payment.date,
      amount: payment.amount,
      amountAppliedToInvoice: payment.amountAppliedToInvoice,
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
      await recalculateCustomerDerivedData(payment.customerId, 'payment_deleted');
      setMessage('Payment deleted successfully.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete payment.');
    }
  };

  const handleLoadMore = () => {
    // Free-tier safety: initial payment screen reads only latest records; older rows load on demand.
    setPaymentLimit((current) => current + LOAD_MORE_PAGE_SIZE);
  };

  const canLoadMorePayments = !loading && payments.length >= paymentLimit;

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
    minWidth: isMobile ? 720 : 940,
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
      <SectionHeader title="Payments" />

      <form style={cardStyle} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 800 }}>{editingPaymentId ? 'Edit Payment' : 'Add Payment'}</div>
            <div style={{ color: '#D7DEEA', marginTop: 4 }}>Enter the received amount; it will clear all pending invoices in oldest-first order.</div>
          </div>
          <div style={{ color: '#FFFFFF', fontWeight: 800 }}>
            <div style={{ color: selectedPendingTotal > 0 ? '#B42318' : '#1B7F3A' }}>
              Selected Pending: {selectedInvoiceIds.length > 0 ? formatMoney(selectedPendingTotal) : 'No pending invoice'}
            </div>
            {selectedCustomer ? (
              <div style={{ color: '#4ADE80', fontSize: 12, marginTop: 4 }}>Available advance: {formatMoney(selectedCustomer.advanceBalance)}</div>
            ) : null}
            {selectedInvoiceIds.length > 0 ? (
              <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>This payment applies: {formatMoney(appliedTotalPreview)}</div>
            ) : null}
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

          {formData.customerId && loadingCustomerPayments ? (
            <div style={{ gridColumn: '1 / -1', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12, background: 'var(--role-card-subtle)', color: '#D7DEEA', fontWeight: 800 }}>
              Loading customer payment history...
            </div>
          ) : null}

          {formData.customerId && !loadingCustomerPayments && invoiceOptions.length > 0 ? (
            <div style={{ gridColumn: '1 / -1', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12, background: 'var(--role-card-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontWeight: 900, color: '#FFFFFF' }}>{editingPaymentId ? 'Apply to invoice' : 'Oldest-first invoice allocation'}</div>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>
                  {editingPaymentId ? 'Selected' : 'Total'} pending: {formatMoney(editingPaymentId ? selectedPendingTotal : totalPendingAmount)}
                </div>
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
                        cursor: editingPaymentId ? 'pointer' : 'default'
                      }}
                    >
                      <input
                        type={editingPaymentId ? 'radio' : 'checkbox'}
                        checked={checked}
                        disabled={!editingPaymentId}
                        onChange={() => toggleSelectedInvoice(invoice.id)}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', color: '#000000', fontWeight: 900 }}>{getInvoiceDisplayNumber(invoice)}</span>
                        <span style={{ display: 'block', color: '#7F1D1D', fontSize: 12, fontWeight: 800 }}>Pending {formatMoney(invoice.pendingAmount)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {allocationPreview.length > 0 ? (
                <div style={{ marginTop: 10, color: '#FFFFFF', fontSize: 12, fontWeight: 800 }}>
                  {allocationPreview.map((allocation) => (
                    <span key={allocation.invoice.id} style={{ display: 'inline-block', marginRight: 12, marginTop: 4 }}>
                      {getInvoiceDisplayNumber(allocation.invoice)}: {formatMoney(allocation.appliedTotal)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <label style={labelStyle}>
            Payment Amount
            <input style={inputStyle} type="number" min="0" value={formData.amount} onChange={(event) => handleFieldChange('amount', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Cash Discount
            <input style={inputStyle} type="number" min="0" value={formData.cashDiscount} onChange={(event) => handleFieldChange('cashDiscount', event.target.value)} />
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

        {error ? <div style={{ color: '#FCA5A5', marginTop: 12 }}>{error}</div> : null}
        {overpaymentAmount > 0 ? (
          <div style={{ color: '#B7791F', marginTop: 12, fontWeight: 800 }}>
            Extra amount of {formatMoney(overpaymentAmount)} will be stored as customer advance.
          </div>
        ) : null}
        {message ? <div style={{ color: '#1B7F3A', marginTop: 12 }}>{message}</div> : null}
        {warning ? <div style={{ color: '#B7791F', marginTop: 12, fontWeight: 800 }}>{warning}</div> : null}

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="submit" style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A' }} disabled={saving}>
            {saving ? 'Saving...' : editingPaymentId ? 'Update Payment' : 'Add Payment'}
          </button>
          {editingPaymentId ? (
            <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A' }} onClick={resetForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div style={recordCardStyle}>
        <div style={formGridStyle}>
          <label style={labelStyle}>
            Search Payments
            <input style={inputStyle} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Customer or invoice" />
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

        </div>

        <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 16 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, maxHeight: 520, overflowX: 'auto', overflowY: 'auto', borderRadius: 14, border: '1px solid #E8EDF4', marginTop: 8 }}>
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
                paymentRows.map((payment) => {
                  const linkedInvoice = invoices.find((invoice) => invoice.id === payment.invoiceId);
                  const invoiceLabel = linkedInvoice ? getInvoiceDisplayNumber(linkedInvoice) : payment.invoiceNumber || 'Advance';
                  const splitPaymentTotal = splitPaymentTotalById.get(payment.id);

                  return (
                  <tr className="role-record-row" key={payment.id}>
                    <td style={cellStyle}>{formatDate(payment.date)}</td>
                    <td style={cellStyle}>{payment.customerName}</td>
                    <td style={cellStyle}>{invoiceLabel}</td>
                    <td style={{ ...cellStyle, color: '#4ADE80', fontWeight: 800 }}>
                      {payment.paymentKind === 'advance_application'
                        ? `${formatMoney(payment.advanceAppliedAmount)} advance adjusted`
                        : formatMoney(payment.amount)}
                      {payment.advanceCreatedAmount > 0 ? (
                        <div style={{ color: '#4ADE80', fontSize: 12, fontWeight: 800 }}>
                          Advance stored: {formatMoney(payment.advanceCreatedAmount)}
                        </div>
                      ) : null}
                      {(payment.notes || '').includes('Split payment') ? (
                        <div style={{ color: '#4ADE80', fontSize: 12, fontWeight: 800 }}>
                          Split paid: {formatMoney(splitPaymentTotal ?? payment.amount)}
                        </div>
                      ) : null}
                      {payment.cashDiscount > 0 ? (
                        <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 700 }}>
                          Applied with discount: {formatMoney(getInvoicePaymentEffect(payment))}
                        </div>
                      ) : null}
                      {payment.amountUsedForOldBalance > 0 ? (
                        <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 700 }}>
                          Old balance: {formatMoney(payment.amountUsedForOldBalance)}
                        </div>
                      ) : null}
                      {payment.amountUsedForOldBalance > 0 ? (
                        <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 700 }}>
                          Invoice: {formatMoney(getAmountAppliedToInvoice(payment))}
                        </div>
                      ) : null}
                    </td>
                    <td style={cellStyle}>{formatMoney(payment.cashDiscount)}</td>
                    <td style={cellStyle}>{payment.mode}</td>
                    <td style={cellStyle}>{payment.notes || '-'}</td>
                    <td style={cellStyle}>
                      {canEditPayment(payment) ? (
                        <button type="button" style={{ ...buttonStyle, background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', color: '#FFFFFF', marginRight: 8 }} onClick={() => handleEdit(payment)}>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {canLoadMorePayments ? (
          <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginTop: 12 }} onClick={handleLoadMore}>
            Load 5 more
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default Payments;
