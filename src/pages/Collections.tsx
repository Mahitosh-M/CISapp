import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  getAppSettings,
  listenToCustomersByBranchId,
  listenToInvoicesByShopId,
  listenToPaymentsByShopId
} from '../services/firestoreService';
import type { AppSettings, Customer, Invoice, Payment } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney, formatShortDate } from '../utils/formatters';
import { buildOverdueInvoiceRisks } from '../utils/overdueUtils';
import { DEFAULT_SETTINGS } from '../utils/settings';
import { getAssignedStaffShopId, getShopName } from '../utils/shops';

type CollectionCustomerRow = {
  customer: Customer;
  overdueAmount: number;
  lastPaymentDate?: string;
  lastPaymentDays?: number;
};

const getBranchForShop = (shopId: 'SHOP_A' | 'SHOP_S') => shopId === 'SHOP_S' ? 'SINDHANUR' : 'MASKI';

const getDaysSince = (date?: string) => {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const today = new Date(`${getTodayDateString()}T00:00:00`).getTime();
  const paymentDate = new Date(`${date}T00:00:00`).getTime();
  return Number.isNaN(paymentDate) ? undefined : Math.max(0, Math.floor((today - paymentDate) / 86400000));
};

const Collections = () => {
  const { userProfile } = useAuth();
  const staffShopId = getAssignedStaffShopId(userProfile);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!staffShopId) {
      setCustomers([]);
      setInvoices([]);
      setPayments([]);
      setError('Your staff account is not assigned to a branch. Ask an Admin to assign your branch.');
      setLoading(false);
      return;
    }

    let active = true;
    const pendingSources = new Set(['customers', 'invoices', 'payments', 'settings']);
    const markLoaded = (source: string) => {
      pendingSources.delete(source);
      if (pendingSources.size === 0 && active) setLoading(false);
    };
    const handleError = (err: Error) => {
      if (!active) return;
      setError(err.message || 'Unable to load collection records.');
      setLoading(false);
    };

    setLoading(true);
    setError('');
    const stopCustomers = listenToCustomersByBranchId(getBranchForShop(staffShopId), (rows) => {
      if (!active) return;
      setCustomers(rows);
      markLoaded('customers');
    }, handleError);
    const stopInvoices = listenToInvoicesByShopId(staffShopId, (rows) => {
      if (!active) return;
      setInvoices(rows);
      markLoaded('invoices');
    }, handleError);
    const stopPayments = listenToPaymentsByShopId(staffShopId, (rows) => {
      if (!active) return;
      setPayments(rows);
      markLoaded('payments');
    }, handleError);
    void getAppSettings()
      .then((appSettings) => {
        if (!active) return;
        setSettings(appSettings);
        markLoaded('settings');
      })
      .catch((err: unknown) => handleError(err instanceof Error ? err : new Error('Unable to load collection settings.')));

    return () => {
      active = false;
      stopCustomers();
      stopInvoices();
      stopPayments();
    };
  }, [staffShopId]);

  const rows = useMemo<CollectionCustomerRow[]>(() => {
    const overdueByCustomerId = new Map<string, number>();
    buildOverdueInvoiceRisks(customers, invoices, payments, settings).forEach((invoice) => {
      overdueByCustomerId.set(invoice.customerId, (overdueByCustomerId.get(invoice.customerId) ?? 0) + invoice.overdueAmount);
    });

    return customers
      .map((customer) => {
        const paymentDates = payments
          .filter((payment) => payment.customerId === customer.id && Boolean(payment.date))
          .map((payment) => payment.date)
          .sort();
        const lastPaymentDate = paymentDates[paymentDates.length - 1];
        return {
          customer,
          overdueAmount: overdueByCustomerId.get(customer.id) ?? 0,
          lastPaymentDate,
          lastPaymentDays: getDaysSince(lastPaymentDate)
        };
      })
      .filter((row) => row.overdueAmount > 0)
      .sort((left, right) => right.overdueAmount - left.overdueAmount || left.customer.name.localeCompare(right.customer.name));
  }, [customers, invoices, payments, settings]);

  const totalOverdue = useMemo(() => rows.reduce((sum, row) => sum + row.overdueAmount, 0), [rows]);

  return (
    <div>
      <SectionHeader title="Collections" description={staffShopId ? `${getShopName(staffShopId)} overdue customer balances` : 'Overdue customer balances'} />

      <div style={{
        background: 'var(--role-card-background)',
        border: '1px solid var(--role-card-border)',
        borderRadius: 16,
        padding: 'clamp(14px, 3vw, 20px)',
        boxShadow: '0 14px 30px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 38, height: 38, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: '#FDECEC', color: '#B91C1C' }}><CircleDollarSign size={20} /></span>
            <div>
              <div style={{ color: '#FFFFFF', fontWeight: 900 }}>OVERDUE COLLECTIONS</div>
              <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 3 }}>Customers who need payment follow-up</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#D7DEEA', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Total overdue</div>
              <div style={{ color: '#FCA5A5', fontSize: 21, fontWeight: 900, marginTop: 3 }}>{formatMoney(totalOverdue)}</div>
            </div>
          </div>
        </div>

        {error ? <div style={{ color: '#FCA5A5', fontWeight: 700 }}>{error}</div> : null}

        {!error ? (
          <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--role-card-border)' }}>
            <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(17, 24, 90, 0.26)' }}>
                  {['Customer', 'Area', 'Total overdue', 'Last payment'].map((heading) => (
                    <th key={heading} style={{ color: '#D7DEEA', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: heading === 'Total overdue' ? 'right' : 'left', padding: '11px 12px' }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={4} style={{ padding: 18, color: '#D7DEEA' }}>Loading collection customers...</td></tr> : null}
                {!loading && rows.length === 0 ? <tr><td colSpan={4} style={{ padding: 18, color: '#D7DEEA' }}>No overdue customer balances in your branch.</td></tr> : null}
                {!loading && rows.map((row) => (
                  <tr className="role-record-row" key={row.customer.id}>
                    <td style={{ padding: '13px 12px', color: '#FFFFFF', fontWeight: 900 }}>{row.customer.name}</td>
                    <td style={{ padding: '13px 12px', color: '#D7DEEA' }}>{row.customer.area || '-'}</td>
                    <td style={{ padding: '13px 12px', color: '#FCA5A5', fontWeight: 900, textAlign: 'right' }}>{formatMoney(row.overdueAmount)}</td>
                    <td style={{ padding: '13px 12px', color: '#FFFFFF' }}>
                      {row.lastPaymentDate ? <><strong>{formatShortDate(row.lastPaymentDate)}</strong><div style={{ color: '#FDE68A', fontSize: 10, fontWeight: 800, marginTop: 3 }}>{row.lastPaymentDays} days ago</div></> : <span style={{ color: '#FCA5A5', fontWeight: 800 }}>No payment recorded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Collections;
