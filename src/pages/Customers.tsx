import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  createCustomer,
  deleteCustomerRecord,
  getAppSettings,
  getCustomers,
  getInvoices,
  getInvoicesByCustomerId,
  getPayments,
  getPaymentTermsForTier,
  updateCustomerRecord
} from '../services/firestoreService';
import type { AppSettings, Customer, CustomerFormData, CustomerTier, Invoice, Payment } from '../types';
import { formatMoney } from '../utils/formatters';
import { buildCustomerOutstandingRows } from '../utils/overdueUtils';
import { DEFAULT_SETTINGS } from '../utils/settings';

const emptyCustomerForm: CustomerFormData = {
  name: '',
  mobile: '',
  area: '',
  tier: 'Tier 3',
  paymentTerms: getPaymentTermsForTier('Tier 3'),
  notes: ''
};

const Customers = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [formData, setFormData] = useState<CustomerFormData>(emptyCustomerForm);
  const [editingCustomerId, setEditingCustomerId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { canDeleteRecords } = useAuth();

  const loadCustomers = async () => {
    try {
      setLoading(true);
      setError('');

      // Customers page needs invoice/payment totals only for display; CRUD still writes to the customers collection.
      const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
        getCustomers(),
        getInvoices(),
        getPayments(),
        getAppSettings()
      ]);

      setCustomers(customerRows);
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

  const filteredCustomers = useMemo(() => {
    const term = searchText.trim().toLowerCase();

    if (!term) return customers;

    return customers.filter((customer) =>
      [customer.name, customer.mobile, customer.area].some((value) => value.toLowerCase().includes(term))
    );
  }, [customers, searchText]);

  const suggestions = useMemo(() => {
    if (searchText.trim().length < 2) return [];
    return filteredCustomers.slice(0, 5);
  }, [filteredCustomers, searchText]);

  const outstandingByCustomerId = useMemo(() => {
    return new Map(
      buildCustomerOutstandingRows(customers, invoices, payments, settings).map((row) => [row.customerId, row])
    );
  }, [customers, invoices, payments, settings]);

  const handleFieldChange = (field: keyof CustomerFormData, value: string) => {
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

  const resetForm = () => {
    setFormData(emptyCustomerForm);
    setEditingCustomerId('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formData.name.trim() || !formData.mobile.trim()) {
      setError('Customer name and mobile number are required.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (editingCustomerId) {
        await updateCustomerRecord(editingCustomerId, formData);
        setMessage('Customer updated successfully.');
      } else {
        await createCustomer(formData);
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
      tier: customer.tier,
      paymentTerms: customer.paymentTerms,
      notes: customer.notes
    });
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

      const linkedInvoices = await getInvoicesByCustomerId(customer.id);
      const extraWarning = linkedInvoices.length > 0 ? ` This customer has ${linkedInvoices.length} invoice(s). Invoice history will remain with stored customer name.` : '';
      const confirmed = window.confirm(`Delete ${customer.name}?${extraWarning}`);

      if (!confirmed) return;

      await deleteCustomerRecord(customer.id);
      setMessage('Customer deleted successfully.');
      await loadCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete customer.');
    }
  };

  const pageGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 360px) 1fr',
    gap: 20,
    alignItems: 'start'
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
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

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: 1320,
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
        title="Customers"
        description="Create, search, edit, and delete customer accounts directly in Firestore."
      />

      <div style={pageGridStyle}>
        <form style={cardStyle} onSubmit={handleSubmit}>
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
            Tier
            <select style={inputStyle} value={formData.tier} onChange={(event) => handleFieldChange('tier', event.target.value)}>
              <option value="Tier 1">Tier 1</option>
              <option value="Tier 2">Tier 2</option>
              <option value="Tier 3">Tier 3</option>
            </select>
          </label>

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

          {error ? <div style={{ color: '#B42318', marginBottom: 10 }}>{error}</div> : null}
          {message ? <div style={{ color: '#1B7F3A', marginBottom: 10 }}>{message}</div> : null}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} disabled={saving}>
              {saving ? 'Saving...' : editingCustomerId ? 'Update Customer' : 'Add Customer'}
            </button>
            {editingCustomerId ? (
              <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetForm}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div style={cardStyle}>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <label style={labelStyle}>
              Search by Name, Mobile, or Area
              <input
                style={inputStyle}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Type at least 2 letters, e.g. ab"
              />
            </label>

            {suggestions.length > 0 ? (
              <div style={{ position: 'absolute', zIndex: 2, left: 0, right: 0, top: 72, background: '#FFFFFF', border: '1px solid #D8DEE9', borderRadius: 12, overflow: 'hidden' }}>
                {suggestions.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    style={{ display: 'block', width: '100%', padding: 12, textAlign: 'left', background: '#FFFFFF', border: 0, borderBottom: '1px solid #EEF2F6', cursor: 'pointer' }}
                    onClick={() => setSearchText(customer.name)}
                  >
                    <strong>{customer.name}</strong>
                    <div style={{ color: '#67738E', fontSize: 12 }}>{customer.mobile} | {customer.area}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid #E8EDF4' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={headerCellStyle}>Customer</th>
                  <th style={headerCellStyle}>Area</th>
                  <th style={headerCellStyle}>Tier</th>
                  <th style={headerCellStyle}>Sales</th>
                  <th style={headerCellStyle}>Payments</th>
                  <th style={headerCellStyle}>Outstanding</th>
                  <th style={headerCellStyle}>Overdue</th>
                  <th style={headerCellStyle}>Payment Terms</th>
                  <th style={headerCellStyle}>Notes</th>
                  <th style={headerCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td style={cellStyle} colSpan={10}>Loading customers...</td></tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr><td style={cellStyle} colSpan={10}>No customers found.</td></tr>
                ) : (
                  filteredCustomers.map((customer) => (
                    <tr key={customer.id}>
                      {/*
                        Business totals are calculated from invoices/payments so the customer master record stays clean.
                        Future edit point: add credit-limit logic beside these indicators.
                      */}
                      <td style={cellStyle}>
                        <strong>{customer.name}</strong>
                        <div style={{ color: '#67738E', fontSize: 12 }}>{customer.mobile}</div>
                      </td>
                      <td style={cellStyle}>{customer.area}</td>
                      <td style={cellStyle}><TierBadge tier={customer.tier} /></td>
                      <td style={cellStyle}>{formatMoney(outstandingByCustomerId.get(customer.id)?.totalSales ?? 0)}</td>
                      <td style={cellStyle}>{formatMoney(outstandingByCustomerId.get(customer.id)?.totalPayments ?? 0)}</td>
                      <td style={{ ...cellStyle, color: outstandingByCustomerId.get(customer.id)?.indicator === 'green' ? '#1B7F3A' : outstandingByCustomerId.get(customer.id)?.indicator === 'yellow' ? '#B7791F' : '#B42318', fontWeight: 800 }}>
                        {formatMoney(outstandingByCustomerId.get(customer.id)?.outstanding ?? 0)}
                      </td>
                      <td style={{ ...cellStyle, color: (outstandingByCustomerId.get(customer.id)?.overdueAmount ?? 0) > 0 ? '#B42318' : '#1B7F3A', fontWeight: 800 }}>
                        {formatMoney(outstandingByCustomerId.get(customer.id)?.overdueAmount ?? 0)}
                        <div style={{ color: '#67738E', fontSize: 12 }}>{outstandingByCustomerId.get(customer.id)?.overdueDays ?? 0} day(s)</div>
                      </td>
                      <td style={cellStyle}>{customer.paymentTerms}</td>
                      <td style={cellStyle}>{customer.notes || '-'}</td>
                      <td style={cellStyle}>
                        <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginRight: 8 }} onClick={() => handleEdit(customer)}>
                          Edit
                        </button>
                        {canDeleteRecords ? (
                          <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDelete(customer)}>
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
    </div>
  );
};

export default Customers;
