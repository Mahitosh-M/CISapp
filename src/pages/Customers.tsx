import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AlertCircle, BellRing, BookOpen, ChevronDown, ChevronUp, CircleDollarSign, Download, FileText, ShoppingCart, UserPlus } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  createCustomer,
  deleteCustomerRecord,
  deleteDueCustomerRecord,
  getAppSettings,
  getCustomers,
  getInvoices,
  getInvoicesByCustomerId,
  getPayments,
  getPaymentsByCustomerId,
  getPaymentTermsForTier,
  syncDueCustomerRecords,
  updateCustomerRecord
} from '../services/firestoreService';
import type { AppSettings, Customer, CustomerFormData, CustomerTier, DueCustomerRecord, Invoice, Payment } from '../types';
import { buildCustomerLedger, getLedgerPaymentParts, getPaymentNoteWithoutSplitMarker } from '../utils/customerLedger';
import { downloadCustomerLedgerPdf } from '../utils/customerLedgerPdf';
import { applyIntelligenceTiersToCustomers } from '../utils/customerTiering';
import { addDaysToDateString, getTodayDateString } from '../utils/dateUtils';
import { formatDate, formatMoney, formatShortDate } from '../utils/formatters';
import { latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getBusinessInvoices, getInvoiceDisplayNumber, isOpeningBalanceInvoice } from '../utils/openingBalance';
import { buildCustomerOutstandingRows, buildDueCustomerRows } from '../utils/overdueUtils';
import { DEFAULT_SETTINGS } from '../utils/settings';
import { getShopName } from '../utils/shops';
import { CUSTOMER_TIERS, getTierWithCodeLabel } from '../utils/tiers';
import { formatCustomerSelectLabel } from '../utils/customerLabels';

const LIST_PAGE_SIZE = 1;
const ORDER_APP_URL = 'https://orderapp-35200.web.app';

const emptyCustomerForm: CustomerFormData = {
  name: '',
  mobile: '',
  area: '',
  branchId: 'SINDHANUR',
  tier: 'Tier 4',
  paymentTerms: getPaymentTermsForTier('Tier 4'),
  notes: '',
  previousOutstandingAmount: 0,
  status: 'Active'
};

type CustomerTextField = Exclude<keyof CustomerFormData, 'previousOutstandingAmount'>;
type LedgerRange = 'last_10' | 'last_month' | 'last_3_months' | 'overall';

const LEDGER_RANGES: Array<{ id: LedgerRange; label: string }> = [
  { id: 'last_10', label: 'Last 10 Transactions' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_3_months', label: 'Last 3 Months' },
  { id: 'overall', label: 'Overall' }
];

const Customers = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [inactiveCustomers, setInactiveCustomers] = useState<Customer[]>([]);
  const [inactiveInvoices, setInactiveInvoices] = useState<Invoice[]>([]);
  const [inactivePayments, setInactivePayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [formData, setFormData] = useState<CustomerFormData>(emptyCustomerForm);
  const [editingCustomerId, setEditingCustomerId] = useState('');
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedSearchCustomerId, setSelectedSearchCustomerId] = useState('');
  const [searchCustomers, setSearchCustomers] = useState<Customer[] | null>(null);
  const [loadingSearchCustomers, setLoadingSearchCustomers] = useState(false);
  const [inactiveSearchText, setInactiveSearchText] = useState('');
  const [calledCustomerIds, setCalledCustomerIds] = useState<Set<string>>(() => new Set());
  const [showInactiveCustomers, setShowInactiveCustomers] = useState(false);
  const [inactiveDataLoaded, setInactiveDataLoaded] = useState(false);
  const [loadingInactiveCustomers, setLoadingInactiveCustomers] = useState(false);
  const [dueCustomers, setDueCustomers] = useState<DueCustomerRecord[]>([]);
  const [showDueCustomers, setShowDueCustomers] = useState(false);
  const [dueDataLoaded, setDueDataLoaded] = useState(false);
  const [loadingDueCustomers, setLoadingDueCustomers] = useState(false);
  const [deletingDueCustomerId, setDeletingDueCustomerId] = useState('');
  const [expandedDueCustomerIds, setExpandedDueCustomerIds] = useState<Set<string>>(() => new Set());
  const [dueMessage, setDueMessage] = useState('');
  const [dueError, setDueError] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerCustomers, setLedgerCustomers] = useState<Customer[]>([]);
  const [ledgerCustomerListLoaded, setLedgerCustomerListLoaded] = useState(false);
  const [loadingLedgerCustomers, setLoadingLedgerCustomers] = useState(false);
  const [selectedLedgerCustomerId, setSelectedLedgerCustomerId] = useState('');
  const [ledgerInvoices, setLedgerInvoices] = useState<Invoice[]>([]);
  const [ledgerPayments, setLedgerPayments] = useState<Payment[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [activeLedgerRange, setActiveLedgerRange] = useState<LedgerRange | null>(null);
  const [loadedLedgerRangeKey, setLoadedLedgerRangeKey] = useState('');
  const [downloadingLedgerPdf, setDownloadingLedgerPdf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const ledgerRequestRef = useRef(0);
  const { canDeleteRecords, userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'Admin';
  const isStaff = userProfile?.role === 'Staff';
  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadCustomers = async () => {
    try {
      setLoading(true);
      setError('');

      const [customerRows, appSettings] = await Promise.all([
        getCustomers({ limitCount: LIST_PAGE_SIZE, sortBy: 'createdAt', sortDirection: 'desc' }),
        getAppSettings()
      ]);
      const [invoiceRows, paymentRows] = isAdmin ? await Promise.all([getInvoices(), getPayments()]) : [[], []];

      setCustomers(
        isAdmin
          ? applyIntelligenceTiersToCustomers(customerRows, invoiceRows, paymentRows, appSettings)
          : customerRows
      );
      setInvoices(invoiceRows);
      setPayments(paymentRows);
      setSettings(appSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    if (!searchText.trim()) {
      setSearchCustomers(null);
      setLoadingSearchCustomers(false);
      return;
    }

    let cancelled = false;
    setLoadingSearchCustomers(true);

    getCustomers()
      .then((customerRows) => {
        if (!cancelled) setSearchCustomers(customerRows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to search customers.');
      })
      .finally(() => {
        if (!cancelled) setLoadingSearchCustomers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [searchText]);

  const filteredCustomers = useMemo(() => {
    if (selectedSearchCustomerId) {
      return (searchCustomers ?? customers).filter((customer) => customer.id === selectedSearchCustomerId);
    }

    const term = searchText.trim().toLowerCase();

    if (!term) return [];

    return sortNewestFirst(
      (searchCustomers ?? customers).filter((customer) =>
        [customer.name, customer.area].some((value) => value.toLowerCase().includes(term))
      ),
      ['updatedAt', 'createdAt']
    );
  }, [customers, searchCustomers, searchText, selectedSearchCustomerId]);

  const suggestions = useMemo(() => {
    if (searchText.trim().length < 2) return [];
    return filteredCustomers.slice(0, 5);
  }, [filteredCustomers, searchText]);

  const getStoredCustomerTotal = (customer: Customer) => customer.totalOutstandingAmount ?? 0;

  const handleToggleInactiveCustomers = async () => {
    if (showInactiveCustomers) {
      setShowInactiveCustomers(false);
      return;
    }

    setShowInactiveCustomers(true);

    if (inactiveDataLoaded) return;

    try {
      setLoadingInactiveCustomers(true);
      setError('');
      const [customerRows, invoiceRows, paymentRows] = await Promise.all([
        getCustomers(),
        getInvoices(),
        getPayments()
      ]);

      setInactiveCustomers(customerRows);
      setInactiveInvoices(invoiceRows);
      setInactivePayments(paymentRows);
      setInactiveDataLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load follow-up customers.');
    } finally {
      setLoadingInactiveCustomers(false);
    }
  };

  const handleToggleDueCustomers = async () => {
    if (showDueCustomers) {
      setShowDueCustomers(false);
      return;
    }

    setShowDueCustomers(true);
    setDueMessage('');
    setDueError('');

    if (dueDataLoaded) return;

    try {
      setLoadingDueCustomers(true);
      const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
        getCustomers(),
        getInvoices(),
        getPayments(),
        getAppSettings()
      ]);
      const dueRows = buildDueCustomerRows(customerRows, invoiceRows, paymentRows, appSettings);
      const syncedRows = await syncDueCustomerRecords(dueRows);

      setDueCustomers(syncedRows);
      setDueDataLoaded(true);
    } catch (err) {
      setDueError(err instanceof Error ? err.message : 'Unable to load overdue customers.');
    } finally {
      setLoadingDueCustomers(false);
    }
  };

  const handleDuePaid = async (row: DueCustomerRecord) => {
    try {
      setDeletingDueCustomerId(row.customerId);
      setDueMessage('');
      setDueError('');
      await deleteDueCustomerRecord(row.customerId);
      setDueCustomers((current) => current.filter((item) => item.customerId !== row.customerId));
      setExpandedDueCustomerIds((current) => {
        const next = new Set(current);
        next.delete(row.customerId);
        return next;
      });
      setDueMessage(`${row.customerName} removed from DUE.`);
    } catch (err) {
      setDueError(err instanceof Error ? err.message : 'Unable to remove the due record.');
    } finally {
      setDeletingDueCustomerId('');
    }
  };

  const toggleDueInvoiceDetails = (customerId: string) => {
    setExpandedDueCustomerIds((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  };

  const handleToggleLedger = async () => {
    if (showLedger) {
      setShowLedger(false);
      return;
    }

    setShowLedger(true);
    setLedgerError('');
    if (ledgerCustomerListLoaded) return;

    try {
      setLoadingLedgerCustomers(true);
      setLedgerCustomers(await getCustomers());
      setLedgerCustomerListLoaded(true);
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Unable to load customers for the ledger.');
    } finally {
      setLoadingLedgerCustomers(false);
    }
  };

  const handleLedgerCustomerChange = (customerId: string) => {
    ++ledgerRequestRef.current;
    setSelectedLedgerCustomerId(customerId);
    setLedgerInvoices([]);
    setLedgerPayments([]);
    setLedgerError('');
    setActiveLedgerRange(null);
    setLoadedLedgerRangeKey('');
    setLoadingLedger(false);
  };

  const handleLedgerRangeChange = async (range: LedgerRange) => {
    if (!selectedLedgerCustomerId) return;
    const rangeKey = `${selectedLedgerCustomerId}:${range}`;
    setActiveLedgerRange(range);
    setLedgerError('');
    if (loadedLedgerRangeKey === rangeKey) return;
    const requestId = ++ledgerRequestRef.current;
    const today = getTodayDateString();
    const queryOptions = range === 'last_month'
      ? { fromDate: addDaysToDateString(today, -30), toDate: today }
      : range === 'last_3_months'
        ? { fromDate: addDaysToDateString(today, -90), toDate: today }
        : range === 'last_10'
          ? { limitCount: 10 }
          : undefined;

    try {
      setLoadingLedger(true);
      const [invoiceRows, paymentRows] = await Promise.all([
        getInvoicesByCustomerId(selectedLedgerCustomerId, queryOptions),
        getPaymentsByCustomerId(selectedLedgerCustomerId, queryOptions)
      ]);
      if (requestId !== ledgerRequestRef.current) return;
      if (range === 'last_10') {
        const latestRows = buildCustomerLedger(invoiceRows, paymentRows).slice(-10);
        const invoiceIds = new Set(latestRows.flatMap((row) => row.invoice ? [row.invoice.id] : []));
        const paymentIds = new Set(latestRows.flatMap((row) => getLedgerPaymentParts(row).map((payment) => payment.id)));
        setLedgerInvoices(invoiceRows.filter((invoice) => invoiceIds.has(invoice.id)));
        setLedgerPayments(paymentRows.filter((payment) => paymentIds.has(payment.id)));
      } else {
        setLedgerInvoices(invoiceRows);
        setLedgerPayments(paymentRows);
      }
      setLoadedLedgerRangeKey(rangeKey);
    } catch (err) {
      if (requestId === ledgerRequestRef.current) {
        setLedgerError(err instanceof Error ? err.message : 'Unable to load the customer ledger.');
      }
    } finally {
      if (requestId === ledgerRequestRef.current) setLoadingLedger(false);
    }
  };

  const selectedLedgerCustomer = useMemo(
    () => ledgerCustomers.find((customer) => customer.id === selectedLedgerCustomerId),
    [ledgerCustomers, selectedLedgerCustomerId]
  );
  const ledgerRows = useMemo(
    () => buildCustomerLedger(
      ledgerInvoices,
      ledgerPayments,
      activeLedgerRange && activeLedgerRange !== 'overall' && selectedLedgerCustomer?.totalOutstandingAmount !== undefined
        ? { endingBalance: selectedLedgerCustomer.totalOutstandingAmount }
        : undefined
    ),
    [activeLedgerRange, ledgerInvoices, ledgerPayments, selectedLedgerCustomer]
  );
  const ledgerOpeningBalance = activeLedgerRange && activeLedgerRange !== 'overall' && ledgerRows.length > 0
    ? Math.max(0, ledgerRows[0].runningBalance - ledgerRows[0].invoiceAmount + ledgerRows[0].paymentAmount)
    : undefined;
  const displayedLedgerRows = useMemo(() => [...ledgerRows].reverse(), [ledgerRows]);
  const ledgerRangeLabel = LEDGER_RANGES.find((range) => range.id === activeLedgerRange)?.label ?? '';

  const handleDownloadLedgerPdf = async () => {
    if (!selectedLedgerCustomer || ledgerRows.length === 0 || !ledgerRangeLabel) return;
    try {
      setDownloadingLedgerPdf(true);
      setLedgerError('');
      await downloadCustomerLedgerPdf({
        customer: selectedLedgerCustomer,
        rows: ledgerRows,
        rangeLabel: ledgerRangeLabel,
        openingBalance: ledgerOpeningBalance
      });
    } catch (err) {
      setLedgerError(err instanceof Error ? err.message : 'Unable to download the ledger PDF.');
    } finally {
      setDownloadingLedgerPdf(false);
    }
  };

  const inactiveOutstandingByCustomerId = useMemo(() => {
    return new Map(
      buildCustomerOutstandingRows(inactiveCustomers, inactiveInvoices, inactivePayments, settings).map((row) => [row.customerId, row])
    );
  }, [inactiveCustomers, inactiveInvoices, inactivePayments, settings]);

  const inactiveCustomerRows = useMemo(() => {
    const today = getTodayDateString();
    const cutoffDate = addDaysToDateString(today, -15);
    const todayTime = new Date(`${today}T00:00:00`).getTime();
    const term = inactiveSearchText.trim().toLowerCase();
    const lastOrderByCustomerId = new Map<string, string>();

    getBusinessInvoices(inactiveInvoices).forEach((invoice) => {
      const currentDate = lastOrderByCustomerId.get(invoice.customerId);

      if (!currentDate || invoice.date > currentDate) {
        lastOrderByCustomerId.set(invoice.customerId, invoice.date);
      }
    });

    return inactiveCustomers
      .map((customer) => {
        const lastOrderDate = lastOrderByCustomerId.get(customer.id) ?? '';
        const lastOrderTime = lastOrderDate ? new Date(`${lastOrderDate}T00:00:00`).getTime() : 0;
        const daysSinceLastOrder = lastOrderTime > 0 ? Math.max(0, Math.floor((todayTime - lastOrderTime) / (24 * 60 * 60 * 1000))) : null;
        const outstanding = inactiveOutstandingByCustomerId.get(customer.id)?.outstanding ?? customer.totalOutstandingAmount ?? 0;

        return {
          customer,
          lastOrderDate,
          daysSinceLastOrder,
          outstanding
        };
      })
      .filter((row) => !row.lastOrderDate || row.lastOrderDate <= cutoffDate)
      .filter((row) => !calledCustomerIds.has(row.customer.id))
      .filter((row) => {
        if (!term) return true;

        return [row.customer.name, row.customer.area].some((value) =>
          value.toLowerCase().includes(term)
        );
      })
      .sort((left, right) => {
        if (!left.lastOrderDate && right.lastOrderDate) return -1;
        if (left.lastOrderDate && !right.lastOrderDate) return 1;
        return left.lastOrderDate.localeCompare(right.lastOrderDate) || left.customer.name.localeCompare(right.customer.name);
      });
  }, [calledCustomerIds, inactiveCustomers, inactiveInvoices, inactiveOutstandingByCustomerId, inactiveSearchText]);

  const handleFieldChange = (field: CustomerTextField, value: string) => {
    if (field === 'tier') {
      const tier = value as CustomerTier;
      setFormData((current) => ({
        ...current,
        tier,
        paymentTerms: getPaymentTermsForTier(tier)
      }));
      return;
    }

    setFormData((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handlePreviousOutstandingChange = (value: string) => {
    const parsedValue = value.trim() === '' ? 0 : Number(value);

    setFormData((current) => ({
      ...current,
      // This is an Admin-only opening balance from before the ERP was implemented.
      previousOutstandingAmount: parsedValue
    }));
  };

  const resetForm = () => {
    setFormData({ ...emptyCustomerForm });
    setEditingCustomerId('');
    setShowCustomerForm(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formData.name.trim() || !formData.mobile.trim()) {
      setError('Customer name and mobile number are required.');
      return;
    }

    const previousOutstandingAmount = Number(formData.previousOutstandingAmount ?? 0);
    if (!Number.isFinite(previousOutstandingAmount) || previousOutstandingAmount < 0) {
      setError('Previous outstanding amount must be a valid number greater than or equal to 0.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const customerPayload = {
        ...formData,
        previousOutstandingAmount
      };

      if (editingCustomerId) {
        await updateCustomerRecord(editingCustomerId, customerPayload, auditUser);
        setMessage('Customer updated successfully.');
      } else {
        await createCustomer(customerPayload, auditUser);
        setMessage('Customer added successfully.');
      }

      resetForm();
      await loadCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save customer.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomerId(customer.id);
    setFormData({
      name: customer.name,
      mobile: customer.mobile,
      area: customer.area,
      branchId: customer.branchId || 'SINDHANUR',
      tier: customer.tier,
      paymentTerms: customer.paymentTerms,
      notes: customer.notes,
      previousOutstandingAmount: customer.previousOutstandingAmount ?? 0,
      status: customer.status || 'Active'
    });
    setShowCustomerForm(true);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (customer: Customer) => {
    try {
      // This where-query checks whether operational invoice history exists before deletion.
      if (!canDeleteRecords) {
        setError('Only Admin users can delete customer records.');
        return;
      }

      const linkedInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
      const extraWarning = linkedInvoices.length > 0 ? ` This customer has ${linkedInvoices.length} invoice(s). Invoice history will remain with stored customer name.` : '';
      const confirmed = window.confirm(`Delete ${customer.name}?${extraWarning}`);

      if (!confirmed) return;

      await deleteCustomerRecord(customer.id, auditUser);
      setMessage('Customer deleted successfully.');
      await loadCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete customer.');
    }
  };

  const openStaffOrderApp = () => {
    const orderUrl = new URL(ORDER_APP_URL);
    orderUrl.searchParams.set('name', 'staff');
    orderUrl.searchParams.set('role', 'staff');
    orderUrl.searchParams.set('returnUrl', window.location.href);
    window.open(orderUrl.toString(), '_blank', 'noopener,noreferrer');
  };

  const handleToggleCustomerForm = () => {
    if (showCustomerForm && !editingCustomerId) {
      resetForm();
      return;
    }

    setShowCustomerForm(true);
  };

  const pageGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 20,
    alignItems: 'start'
  };

  const cardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 16,
    padding: 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
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
    marginBottom: 12,
    fontSize: 13
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const compactTableStyle: CSSProperties = {
    width: '100%',
    minWidth: 0,
    borderCollapse: 'collapse',
    tableLayout: 'fixed'
  };

  const headerCellStyle: CSSProperties = {
    padding: '8px 7px',
    background: 'var(--role-card-subtle)',
    borderBottom: '1px solid var(--role-card-border)',
    textAlign: 'left',
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1.2,
    wordBreak: 'break-word'
  };

  const cellStyle: CSSProperties = {
    padding: '9px 7px',
    borderBottom: '1px solid var(--role-card-border)',
    color: '#FFFFFF',
    verticalAlign: 'top',
    fontSize: 11,
    lineHeight: 1.25,
    wordBreak: 'break-word'
  };

  const compactActionButtonStyle: CSSProperties = {
    ...buttonStyle,
    width: '100%',
    padding: '7px 8px',
    fontSize: 11,
    borderRadius: 8,
    marginBottom: 6
  };

  const staffTileGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 16
  };

  const staffTileStyle: CSSProperties = {
    border: '1px solid var(--role-card-border)',
    borderRadius: 16,
    padding: 14,
    background: 'var(--role-card-background)',
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    cursor: 'pointer',
    textAlign: 'center',
    minHeight: 112,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease'
  };

  const staffTileIconStyle: CSSProperties = {
    width: 38,
    height: 38,
    borderRadius: 12,
    display: 'grid',
    placeItems: 'center',
    background: '#FFF4BF',
    color: '#11185A'
  };

  return (
    <div>
      <SectionHeader title="Customers" />

      {isStaff || isAdmin ? (
        <div style={staffTileGridStyle}>
          <button
            type="button"
            className="customer-action-tile"
            style={staffTileStyle}
            onClick={openStaffOrderApp}
          >
            <span style={staffTileIconStyle}><ShoppingCart size={20} /></span>
            <span>
              <span style={{ display: 'block', fontWeight: 900 }}>Order</span>
              <span style={{ display: 'block', color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>Open order entry</span>
            </span>
          </button>
          <button
            type="button"
            className="customer-action-tile"
            style={staffTileStyle}
            onClick={handleToggleCustomerForm}
          >
            <span style={staffTileIconStyle}><UserPlus size={20} /></span>
            <span>
              <span style={{ display: 'block', fontWeight: 900 }}>{showCustomerForm && !editingCustomerId ? 'Hide Form' : 'Add Customer'}</span>
              <span style={{ display: 'block', color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>Create customer record</span>
            </span>
          </button>
          <button
            type="button"
            className="customer-action-tile"
            style={staffTileStyle}
            onClick={handleToggleInactiveCustomers}
            disabled={loadingInactiveCustomers}
          >
            <span style={staffTileIconStyle}><BellRing size={20} /></span>
            <span>
              <span style={{ display: 'block', fontWeight: 900 }}>{showInactiveCustomers ? 'Hide Follow-up' : 'Follow-up'}</span>
              <span style={{ display: 'block', color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>
                {loadingInactiveCustomers ? 'Loading customers' : 'Not ordered in 15+ days'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="customer-action-tile"
            style={{
              ...staffTileStyle,
              ...(showDueCustomers ? { borderColor: '#D4AF37', background: 'var(--role-card-subtle)' } : {})
            }}
            onClick={handleToggleDueCustomers}
            disabled={loadingDueCustomers}
          >
            <span style={{ ...staffTileIconStyle, background: '#FDECEC', color: '#B42318' }}><AlertCircle size={20} /></span>
            <span>
              <span style={{ display: 'block', fontWeight: 900 }}>{showDueCustomers ? 'Hide DUE' : 'DUE'}</span>
              <span style={{ display: 'block', color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>
                {loadingDueCustomers ? 'Loading overdue invoices' : 'More than 7 days overdue'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="customer-action-tile"
            style={{
              ...staffTileStyle,
              ...(showLedger ? { borderColor: '#D4AF37', background: 'var(--role-card-subtle)' } : {})
            }}
            onClick={handleToggleLedger}
            disabled={loadingLedgerCustomers}
          >
            <span style={{ ...staffTileIconStyle, background: '#E8F5EC', color: '#166534' }}><BookOpen size={20} /></span>
            <span>
              <span style={{ display: 'block', fontWeight: 900 }}>{showLedger ? 'Hide LEDGER' : 'LEDGER'}</span>
              <span style={{ display: 'block', color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>
                {loadingLedgerCustomers ? 'Loading customers' : 'Customer account history'}
              </span>
            </span>
          </button>
        </div>
      ) : null}

      <div style={pageGridStyle}>
        {showCustomerForm ? (
          <div style={cardStyle}>
            <form onSubmit={handleSubmit}>
              <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 14 }}>
                {editingCustomerId ? 'Edit Customer' : 'Add Customer'}
              </div>

          <label style={labelStyle}>
            Customer Name
            <input style={inputStyle} value={formData.name} onChange={(event) => handleFieldChange('name', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Mobile Number
            <input style={inputStyle} value={formData.mobile} onChange={(event) => handleFieldChange('mobile', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Area
            <input style={inputStyle} value={formData.area} onChange={(event) => handleFieldChange('area', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Branch
            <select
              style={inputStyle}
              value={formData.branchId}
              onChange={(event) => handleFieldChange('branchId', event.target.value)}
              required
            >
              <option value="SINDHANUR">SINDHANUR</option>
              <option value="MASKI">MASKI</option>
            </select>
          </label>

          <label style={labelStyle}>
            Partner Level
            <select style={inputStyle} value={formData.tier} onChange={(event) => handleFieldChange('tier', event.target.value)}>
              {CUSTOMER_TIERS.map((tier) => (
                <option key={tier} value={tier}>{getTierWithCodeLabel(tier)}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Status
            <select style={inputStyle} value={formData.status || 'Active'} onChange={(event) => handleFieldChange('status', event.target.value)}>
              <option value="Active">Active</option>
              <option value="Watch">Watch</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>

          {isAdmin ? (
            <>
              <label style={labelStyle}>
                Previous Outstanding Amount
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  step="0.01"
                  value={Number.isFinite(formData.previousOutstandingAmount) ? formData.previousOutstandingAmount : ''}
                  onChange={(event) => handlePreviousOutstandingChange(event.target.value)}
                />
              </label>

              <div style={{ color: '#D7DEEA', fontSize: 12, lineHeight: 1.5, marginTop: -6, marginBottom: 12 }}>
                Old opening balance before this ERP. It creates one opening-balance invoice and is paid before newer invoices.
              </div>

            </>
          ) : null}

          <label style={labelStyle}>
            Payment Terms
            <input
              style={inputStyle}
              value={formData.paymentTerms}
              onChange={(event) => handleFieldChange('paymentTerms', event.target.value)}
            />
          </label>

          <label style={labelStyle}>
            Notes
            <textarea
              style={{ ...inputStyle, minHeight: 78, resize: 'vertical' }}
              value={formData.notes}
              onChange={(event) => handleFieldChange('notes', event.target.value)}
            />
          </label>

          {error ? <div style={{ color: '#FCA5A5', marginBottom: 10 }}>{error}</div> : null}
          {message ? <div style={{ color: '#1B7F3A', marginBottom: 10 }}>{message}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A' }} disabled={saving}>
              {saving ? 'Saving...' : editingCustomerId ? 'Update Customer' : 'Add Customer'}
            </button>
            {editingCustomerId ? (
              <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A' }} onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
          </div>
        ) : null}

        {showInactiveCustomers ? (
          <div style={cardStyle}>
            {showInactiveCustomers ? (
              <div>
                <label style={labelStyle}>
                  Search follow-up customers
                  <input
                    style={inputStyle}
                    value={inactiveSearchText}
                    onChange={(event) => setInactiveSearchText(event.target.value)}
                    placeholder="Search follow-up customers"
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ color: '#D7DEEA', fontSize: 12 }}>
                    Follow-up list based on normal business invoices only.
                  </div>
                  <div style={{ color: '#FFFFFF', fontWeight: 900 }}>{inactiveCustomerRows.length} customer(s)</div>
                </div>

                <div style={{ ...latestFiveScrollStyle, overflowX: 'hidden', borderRadius: 14, border: '1px solid #E8EDF4' }}>
                  <table style={compactTableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...headerCellStyle, width: '42%' }}>Customer</th>
                        <th style={{ ...headerCellStyle, width: '18%' }}>Days</th>
                        <th style={{ ...headerCellStyle, width: '20%' }}>Total</th>
                        <th style={{ ...headerCellStyle, width: '20%' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingInactiveCustomers ? (
                        <tr><td style={cellStyle} colSpan={4}>Loading follow-up customers...</td></tr>
                      ) : inactiveCustomerRows.length === 0 ? (
                        <tr><td style={cellStyle} colSpan={4}>No customers found for this follow-up list.</td></tr>
                      ) : (
                        inactiveCustomerRows.map(({ customer, daysSinceLastOrder, outstanding }) => (
                          <tr className="role-record-row" key={customer.id}>
                            <td style={cellStyle}>
                              <strong>{customer.name}</strong>
                              {customer.area ? (
                                <div style={{ marginTop: 4 }}>
                                  <div style={{ color: '#D7DEEA', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Area</div>
                                  <div style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 800 }}>{customer.area}</div>
                                </div>
                              ) : null}
                            </td>
                            <td style={{ ...cellStyle, color: '#B7791F', fontWeight: 900 }}>
                              {daysSinceLastOrder === null ? '-' : `${daysSinceLastOrder} day(s)`}
                            </td>
                            <td style={{ ...cellStyle, fontWeight: 900 }}>{formatMoney(outstanding)}</td>
                            <td style={cellStyle}>
                              <button
                                type="button"
                                style={{ ...buttonStyle, width: '100%', padding: '6px 10px', background: '#E8F5EC', color: '#166534', fontSize: 11 }}
                                onClick={() => setCalledCustomerIds((current) => new Set(current).add(customer.id))}
                              >
                                Called
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {showDueCustomers ? (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 18 }}>DUE</div>
              {!loadingDueCustomers ? (
                <div style={{ color: '#FFFFFF', fontWeight: 900 }}>{dueCustomers.length}</div>
              ) : null}
            </div>

            {dueError ? <div style={{ color: '#FCA5A5', marginBottom: 12 }}>{dueError}</div> : null}
            {dueMessage ? <div style={{ color: '#4ADE80', marginBottom: 12, fontWeight: 800 }}>{dueMessage}</div> : null}

            <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--role-card-border)' }}>
              <table style={{ ...compactTableStyle, minWidth: 500 }}>
                <thead>
                  <tr>
                    <th style={{ ...headerCellStyle, width: '32%' }}>Customer</th>
                    <th style={{ ...headerCellStyle, width: '20%' }}>Overdue Days</th>
                    <th style={{ ...headerCellStyle, width: '28%' }}>Amount</th>
                    <th style={{ ...headerCellStyle, width: '20%' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingDueCustomers ? (
                    <tr><td style={cellStyle} colSpan={4}>Loading DUE records...</td></tr>
                  ) : dueCustomers.length === 0 ? (
                    <tr><td style={cellStyle} colSpan={4}>No customers have pending invoices overdue by more than 7 days.</td></tr>
                  ) : (
                    dueCustomers.map((row) => {
                      const detailsExpanded = expandedDueCustomerIds.has(row.customerId);

                      return (
                        <Fragment key={row.customerId}>
                          <tr className="role-record-row">
                            <td style={{ ...cellStyle, fontWeight: 900 }}>{row.customerName}</td>
                            <td style={{ ...cellStyle, color: '#FCA5A5', fontWeight: 900 }}>{row.overdueDays} days</td>
                            <td style={{ ...cellStyle, fontWeight: 900 }}>
                              {row.invoices.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleDueInvoiceDetails(row.customerId)}
                                  aria-expanded={detailsExpanded}
                                  title="Show invoice amounts"
                                  style={{
                                    border: 0,
                                    padding: 0,
                                    background: 'transparent',
                                    color: '#F6E6A8',
                                    font: 'inherit',
                                    fontWeight: 900,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5
                                  }}
                                >
                                  {formatMoney(row.amount)}
                                  {detailsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                                </button>
                              ) : formatMoney(row.amount)}
                            </td>
                            <td style={cellStyle}>
                              <button
                                type="button"
                                style={{ ...buttonStyle, width: '100%', padding: '7px 8px', background: '#E8F5EC', color: '#166534', fontSize: 11 }}
                                disabled={Boolean(deletingDueCustomerId)}
                                onClick={() => handleDuePaid(row)}
                              >
                                {deletingDueCustomerId === row.customerId ? '...' : 'PAID'}
                              </button>
                            </td>
                          </tr>
                          {detailsExpanded ? (
                            <tr>
                              <td style={{ ...cellStyle, paddingTop: 7, paddingBottom: 12 }} colSpan={4}>
                                <div style={{ display: 'grid', gap: 6 }}>
                                  {row.invoices.map((invoice) => (
                                    <div
                                      key={invoice.invoiceId}
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        gap: 12,
                                        padding: '7px 9px',
                                        borderRadius: 8,
                                        background: 'var(--role-card-subtle)'
                                      }}
                                    >
                                      <span style={{ color: '#D7DEEA', fontWeight: 800 }}>{invoice.invoiceNumber}</span>
                                      <strong style={{ color: '#FFFFFF' }}>{formatMoney(invoice.amount)}</strong>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {showLedger ? (
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 14, borderBottom: '1px solid var(--role-card-border)' }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 18 }}>LEDGER</div>
                {selectedLedgerCustomer ? (
                  <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 5 }}>{selectedLedgerCustomer.area || 'No area'}</div>
                ) : null}
              </div>
              {selectedLedgerCustomer && activeLedgerRange && !loadingLedger ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#D7DEEA', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Current Balance</div>
                    <div style={{ color: '#FCA5A5', fontSize: 20, fontWeight: 900, marginTop: 3 }}>
                      {formatMoney(ledgerRows[ledgerRows.length - 1]?.runningBalance ?? selectedLedgerCustomer.totalOutstandingAmount ?? 0)}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{ ...buttonStyle, display: 'inline-flex', alignItems: 'center', gap: 7, background: '#E8F5EC', color: '#166534', opacity: ledgerRows.length === 0 || downloadingLedgerPdf ? 0.55 : 1 }}
                    disabled={ledgerRows.length === 0 || downloadingLedgerPdf}
                    onClick={() => void handleDownloadLedgerPdf()}
                  >
                    <Download size={16} />{downloadingLedgerPdf ? 'Preparing...' : 'Download PDF'}
                  </button>
                </div>
              ) : null}
            </div>

            <label style={{ ...labelStyle, maxWidth: 520, marginTop: 16 }}>
              Customer
              <select
                style={inputStyle}
                value={selectedLedgerCustomerId}
                disabled={loadingLedgerCustomers}
                onChange={(event) => handleLedgerCustomerChange(event.target.value)}
              >
                <option value="">{loadingLedgerCustomers ? 'Loading customers...' : 'Select customer'}</option>
                {ledgerCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
                ))}
              </select>
            </label>

            {selectedLedgerCustomerId ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }} role="group" aria-label="Ledger range">
                {LEDGER_RANGES.map((range) => {
                  const active = activeLedgerRange === range.id;
                  return (
                    <button
                      key={range.id}
                      type="button"
                      aria-pressed={active}
                      disabled={loadingLedger}
                      onClick={() => void handleLedgerRangeChange(range.id)}
                      style={{
                        ...buttonStyle,
                        minHeight: 38,
                        padding: '8px 12px',
                        border: active ? '1px solid #D4AF37' : '1px solid var(--role-card-border)',
                        borderRadius: 8,
                        background: active ? '#D4AF37' : 'var(--role-card-subtle)',
                        color: active ? '#11185A' : '#FFFFFF',
                        opacity: loadingLedger && !active ? 0.65 : 1
                      }}
                    >
                      {range.label}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {ledgerError ? <div style={{ color: '#FCA5A5', marginBottom: 12 }}>{ledgerError}</div> : null}

            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid var(--role-card-border)' }}>
              <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ ...headerCellStyle, width: '11%' }}>Date</th>
                    <th style={{ ...headerCellStyle, width: '13%' }}>Entry</th>
                    <th style={{ ...headerCellStyle, width: '34%' }}>Details</th>
                    <th style={{ ...headerCellStyle, width: '14%', textAlign: 'right' }}>Invoice (+)</th>
                    <th style={{ ...headerCellStyle, width: '14%', textAlign: 'right' }}>Payment (-)</th>
                    <th style={{ ...headerCellStyle, width: '14%', textAlign: 'right' }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingLedger ? (
                    <tr><td style={{ ...cellStyle, padding: 18 }} colSpan={6}>Loading ledger...</td></tr>
                  ) : !selectedLedgerCustomerId ? (
                    <tr><td style={{ ...cellStyle, padding: 18 }} colSpan={6}>No customer selected.</td></tr>
                  ) : !activeLedgerRange ? (
                    <tr><td style={{ ...cellStyle, padding: 18 }} colSpan={6}>No range selected.</td></tr>
                  ) : ledgerRows.length === 0 ? (
                    <tr><td style={{ ...cellStyle, padding: 18 }} colSpan={6}>No invoice or payment records found.</td></tr>
                  ) : (
                    <>
                      {displayedLedgerRows.map((row) => {
                      const invoice = row.invoice;
                      const payment = row.payment;
                      const paymentParts = getLedgerPaymentParts(row);
                      const paymentInvoiceCount = new Set(paymentParts.map((part) => part.invoiceId).filter(Boolean)).size;
                      const paymentModes = [...new Set(paymentParts.map((part) => part.mode).filter(Boolean))].join(', ');
                      const paymentShops = [...new Set(paymentParts.map((part) => part.shopId).filter(Boolean))]
                        .map((shopId) => getShopName(shopId))
                        .join(', ');
                      const paymentNotes = [...new Set(paymentParts
                        .map(getPaymentNoteWithoutSplitMarker)
                        .filter(Boolean))].join(' | ');
                      const totalCashDiscount = paymentParts.reduce((total, part) => total + Math.max(0, part.cashDiscount || 0), 0);
                      const totalAdvanceCreated = paymentParts.reduce((total, part) => total + Math.max(0, part.advanceCreatedAmount || 0), 0);
                      const paymentMeta = payment ? [
                        paymentParts.length > 1
                          ? `${paymentInvoiceCount || paymentParts.length} ${paymentInvoiceCount === 1 ? 'invoice' : 'invoices'}`
                          : payment.invoiceNumber ? `Invoice ${payment.invoiceNumber}` : 'Unallocated',
                        paymentModes,
                        paymentShops
                      ].filter(Boolean).join(' | ') : '';

                      return (
                        <tr
                          className="role-record-row"
                          key={row.id}
                          style={{ background: row.kind === 'payment' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(248, 113, 113, 0.06)' }}
                        >
                          <td style={{ ...cellStyle, fontWeight: 800, whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{formatShortDate(row.date)}</td>
                          <td style={{ ...cellStyle, verticalAlign: 'middle' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: row.kind === 'payment' ? '#86EFAC' : '#FCA5A5', fontWeight: 900 }}>
                              {row.kind === 'payment' ? <CircleDollarSign size={16} /> : <FileText size={16} />}
                              {payment?.paymentKind === 'advance_application' ? 'Advance' : row.kind === 'payment' ? 'Payment' : invoice && isOpeningBalanceInvoice(invoice) ? 'Opening' : 'Invoice'}
                            </span>
                          </td>
                          <td style={{ ...cellStyle, verticalAlign: 'middle' }}>
                            {invoice ? (
                              <>
                                <div style={{ fontWeight: 900 }}>{getInvoiceDisplayNumber(invoice)}</div>
                                <div style={{ color: '#D7DEEA', fontSize: 10, marginTop: 4 }}>
                                  Due {formatShortDate(invoice.dueDate)} | Cost {formatMoney(invoice.totalCost)}
                                </div>
                                {invoice.notes ? <div style={{ color: '#D7DEEA', fontSize: 10, marginTop: 3 }}>{invoice.notes}</div> : null}
                              </>
                            ) : payment ? (
                              <>
                                <div style={{ fontWeight: 900 }}>{paymentMeta}</div>
                                <div style={{ color: '#D7DEEA', fontSize: 10, marginTop: 4 }}>
                                  Received {formatMoney(row.paymentReceived)}
                                  {totalCashDiscount > 0 ? ` | Discount ${formatMoney(totalCashDiscount)}` : ''}
                                  {totalAdvanceCreated > 0 ? ` | Advance ${formatMoney(totalAdvanceCreated)}` : ''}
                                </div>
                                {paymentNotes ? <div style={{ color: '#D7DEEA', fontSize: 10, marginTop: 3 }}>{paymentNotes}</div> : null}
                              </>
                            ) : null}
                          </td>
                          <td style={{ ...cellStyle, textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap', color: row.invoiceAmount > 0 ? '#FCA5A5' : '#8792A9', fontWeight: 900 }}>
                            {row.invoiceAmount > 0 ? `+ ${formatMoney(row.invoiceAmount)}` : '-'}
                          </td>
                          <td style={{ ...cellStyle, textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap', color: row.paymentAmount > 0 ? '#86EFAC' : '#8792A9', fontWeight: 900 }}>
                            {row.paymentAmount > 0 ? `- ${formatMoney(row.paymentAmount)}` : '-'}
                          </td>
                          <td style={{ ...cellStyle, textAlign: 'right', verticalAlign: 'middle', whiteSpace: 'nowrap', color: row.runningBalance > 0 ? '#FCA5A5' : '#86EFAC', fontWeight: 900 }}>
                            {formatMoney(row.runningBalance)}
                          </td>
                        </tr>
                      );
                      })}
                      {ledgerOpeningBalance !== undefined ? (
                        <tr style={{ background: 'rgba(148, 163, 184, 0.10)' }}>
                          <td style={{ ...cellStyle, verticalAlign: 'middle' }}>-</td>
                          <td style={{ ...cellStyle, verticalAlign: 'middle', fontWeight: 900 }}>B/F</td>
                          <td style={{ ...cellStyle, verticalAlign: 'middle', color: '#D7DEEA' }}>Balance brought forward</td>
                          <td style={{ ...cellStyle, textAlign: 'right' }}>-</td>
                          <td style={{ ...cellStyle, textAlign: 'right' }}>-</td>
                          <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap', color: ledgerOpeningBalance > 0 ? '#FCA5A5' : '#86EFAC', fontWeight: 900 }}>
                            {formatMoney(ledgerOpeningBalance)}
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div style={cardStyle}>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <label style={labelStyle}>
              Search by Name or Area
              <input
                style={inputStyle}
                value={searchText}
                onFocus={() => setShowSearchSuggestions(true)}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  setSelectedSearchCustomerId('');
                  setShowSearchSuggestions(true);
                }}
                placeholder="Type at least 2 letters, e.g. ab"
              />
            </label>

            {showSearchSuggestions && suggestions.length > 0 ? (
              <div style={{ position: 'absolute', zIndex: 2, left: 0, right: 0, top: 72, background: '#FFFFFF', border: '1px solid #D8DEE9', borderRadius: 12, overflow: 'hidden' }}>
                {suggestions.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    style={{ display: 'block', width: '100%', padding: 12, textAlign: 'left', background: '#FFFFFF', border: 0, borderBottom: '1px solid #EEF2F6', cursor: 'pointer' }}
                    onClick={() => {
                      setSearchText(formatCustomerSelectLabel(customer));
                      setSelectedSearchCustomerId(customer.id);
                      setShowSearchSuggestions(false);
                    }}
                  >
                    <strong>{customer.name}</strong>
                    <div style={{ color: '#67738E', fontSize: 12 }}>{customer.area || 'No area'}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ color: '#D7DEEA', fontSize: 12, marginBottom: 8 }}>
            {selectedSearchCustomerId ? 'Selected customer only.' : searchText.trim() ? 'Matching customers.' : 'Search to show matching customers.'}
          </div>
          <div style={{ ...latestFiveScrollStyle, overflowX: 'hidden', borderRadius: 14, border: '1px solid #E8EDF4' }}>
            <table style={compactTableStyle}>
              <thead>
                  <tr>
                    <th style={{ ...headerCellStyle, width: '50%' }}>Customer</th>
                    <th style={{ ...headerCellStyle, width: '25%' }}>Total</th>
                    <th style={{ ...headerCellStyle, width: '25%' }}>Action</th>
                  </tr>
              </thead>
              <tbody>
                {loading || loadingSearchCustomers ? (
                  <tr><td style={cellStyle} colSpan={3}>Loading customers...</td></tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr><td style={cellStyle} colSpan={3}>{searchText.trim() ? 'No customers found.' : 'Search by name or area to show customers.'}</td></tr>
                ) : (
                  filteredCustomers.map((customer) => {
                    const storedTotal = getStoredCustomerTotal(customer);
                    const totalColor = storedTotal <= 0 ? '#1B7F3A' : '#B7791F';

                    return (
                    <tr className="role-record-row" key={customer.id}>
                      {/*
                        Customer total mirrors the stored customer value shown in the customer portal.
                        Future edit point: add credit-limit logic beside these indicators.
                      */}
                        <>
                          <td style={cellStyle}>
                            <strong>{customer.name}</strong>
                            {customer.area ? (
                              <div style={{ marginTop: 4 }}>
                                <div style={{ color: '#D7DEEA', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Area</div>
                                <div style={{ color: '#FFFFFF', fontSize: 11, fontWeight: 800 }}>{customer.area}</div>
                              </div>
                            ) : null}
                            <div style={{ color: '#D7DEEA', fontSize: 11 }}>Branch: {customer.branchId || 'Not selected'}</div>
                            {customer.status ? <div style={{ color: '#D7DEEA', fontSize: 11 }}>Status: {customer.status}</div> : null}
                          </td>
                          <td style={{ ...cellStyle, color: totalColor, fontWeight: 800 }}>
                            {formatMoney(storedTotal)}
                          </td>
                          <td style={cellStyle}>
                            <button type="button" style={{ ...compactActionButtonStyle, background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', color: '#FFFFFF' }} onClick={() => handleEdit(customer)}>
                              Edit
                            </button>
                            {canDeleteRecords ? (
                              <button type="button" style={{ ...compactActionButtonStyle, background: '#FDECEC', color: '#B42318', marginBottom: 0 }} onClick={() => handleDelete(customer)}>
                                Delete
                              </button>
                            ) : null}
                          </td>
                        </>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Customers;
