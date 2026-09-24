import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Download } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import {
  listenToCustomersByBranchId,
  listenToPaymentsByShopId
} from '../services/firestoreService';
import type { Customer, Payment, ShopId } from '../types';
import { downloadCollectionsPdf } from '../utils/collectionsPdf';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney, formatShortDate } from '../utils/formatters';
import { getAssignedStaffShopId, getShopName } from '../utils/shops';

type CollectionCustomerRow = {
  customer: Customer;
  outstandingAmount: number;
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
  const visibleShopIds: ShopId[] = staffShopId === 'SHOP_A'
    ? ['SHOP_A', 'SHOP_S']
    : staffShopId === 'SHOP_S'
      ? ['SHOP_S']
      : [];
  const [selectedShopId, setSelectedShopId] = useState<ShopId | undefined>(staffShopId);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    setSelectedShopId(staffShopId);
  }, [staffShopId]);

  useEffect(() => {
    if (!selectedShopId) {
      setCustomers([]);
      setPayments([]);
      setError('Your staff account is not assigned to a branch. Ask an Admin to assign your branch.');
      setLoading(false);
      return;
    }

    let active = true;
    const pendingSources = new Set(['customers', 'payments']);
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
    setCustomers([]);
    setPayments([]);
    const stopCustomers = listenToCustomersByBranchId(getBranchForShop(selectedShopId), (rows) => {
      if (!active) return;
      setCustomers(rows);
      markLoaded('customers');
    }, handleError);
    const stopPayments = listenToPaymentsByShopId(selectedShopId, (rows) => {
      if (!active) return;
      setPayments(rows);
      markLoaded('payments');
    }, handleError);
    return () => {
      active = false;
      stopCustomers();
      stopPayments();
    };
  }, [selectedShopId]);

  const rows = useMemo<CollectionCustomerRow[]>(() => {
    return customers
      .map((customer) => {
        const paymentDates = payments
          .filter((payment) => payment.customerId === customer.id && Boolean(payment.date))
          .map((payment) => payment.date)
          .sort();
        const lastPaymentDate = paymentDates[paymentDates.length - 1];
        return {
          customer,
          outstandingAmount: Math.max(0, customer.totalOutstandingAmount ?? 0),
          lastPaymentDate,
          lastPaymentDays: getDaysSince(lastPaymentDate)
        };
      })
      .filter((row) => row.outstandingAmount > 0)
      .sort((left, right) => right.outstandingAmount - left.outstandingAmount || left.customer.name.localeCompare(right.customer.name));
  }, [customers, payments]);

  const totalOverdue = useMemo(() => rows.reduce((sum, row) => sum + row.outstandingAmount, 0), [rows]);

  const handleDownloadPdf = async () => {
    if (!selectedShopId || rows.length === 0) return;
    try {
      setDownloadingPdf(true);
      await downloadCollectionsPdf({
        totalOverdue,
        rows: rows.map((row) => ({
          customerName: row.customer.name,
          area: row.customer.area,
          overdueAmount: row.outstandingAmount,
          lastPaymentDate: row.lastPaymentDate,
          lastPaymentDays: row.lastPaymentDays
        }))
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div>
      <SectionHeader title="Collections" description={selectedShopId ? `${getShopName(selectedShopId)} overdue customer balances` : 'Overdue customer balances'} />

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            {visibleShopIds.map((shopId) => (
              <button
                key={shopId}
                type="button"
                onClick={() => setSelectedShopId(shopId)}
                style={{ border: `1px solid ${selectedShopId === shopId ? '#D4AF37' : '#5B6A83'}`, borderRadius: 9, background: selectedShopId === shopId ? '#D4AF37' : '#17233B', color: selectedShopId === shopId ? '#11185A' : '#FFFFFF', padding: '8px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}
              >
                {getShopName(shopId)}
              </button>
            ))}
            <div style={{ textAlign: 'center', minWidth: 118 }}>
              <div style={{ color: '#D7DEEA', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Total overdue</div>
              <div style={{ color: '#FCA5A5', fontSize: 21, fontWeight: 900, marginTop: 3 }}>{formatMoney(totalOverdue)}</div>
            </div>
            <button type="button" onClick={() => void handleDownloadPdf()} disabled={loading || rows.length === 0 || downloadingPdf} style={{ border: 0, borderRadius: 9, background: '#E8F5EC', color: '#166534', padding: '9px 11px', fontSize: 11, fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: loading || rows.length === 0 || downloadingPdf ? 'wait' : 'pointer', opacity: loading || rows.length === 0 || downloadingPdf ? 0.55 : 1 }}>
              <Download size={15} />{downloadingPdf ? 'Preparing...' : 'PDF'}
            </button>
          </div>
        </div>

        {error ? <div style={{ color: '#FCA5A5', fontWeight: 700 }}>{error}</div> : null}

        {!error ? (
          <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--role-card-border)' }}>
            <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(17, 24, 90, 0.26)' }}>
                  {['Customer', 'Area', 'Total overdue', 'Last payment'].map((heading) => (
                    <th key={heading} style={{ color: '#D7DEEA', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, textAlign: heading === 'Total overdue' || heading === 'Area' ? 'center' : 'left', padding: '11px 12px', width: heading === 'Total overdue' || heading === 'Area' ? '1%' : undefined, whiteSpace: heading === 'Total overdue' || heading === 'Area' ? 'nowrap' : undefined }}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={4} style={{ padding: 18, color: '#D7DEEA' }}>Loading collection customers...</td></tr> : null}
                {!loading && rows.length === 0 ? <tr><td colSpan={4} style={{ padding: 18, color: '#D7DEEA' }}>No overdue customer balances in your branch.</td></tr> : null}
                {!loading && rows.map((row) => (
                  <tr className="role-record-row" key={row.customer.id}>
                    <td style={{ padding: '13px 12px', color: '#FFFFFF', fontWeight: 900 }}>{row.customer.name}</td>
                    <td style={{ padding: '13px 12px', color: '#D7DEEA', textAlign: 'center', width: '1%', whiteSpace: 'nowrap' }}>{row.customer.area || '-'}</td>
                    <td style={{ padding: '13px 12px', color: '#FCA5A5', fontWeight: 900, textAlign: 'center', width: '1%', whiteSpace: 'nowrap' }}>{formatMoney(row.outstandingAmount)}</td>
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
