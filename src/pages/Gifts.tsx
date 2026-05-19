import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { createGiftHistoryRecord, deleteGiftHistoryRecord, getGiftHistory } from '../services/firestoreService';
import type { GiftHistory, GiftPeriod } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { buildGiftEligibilityRows, getGiftPeriodLabel, getGiftPeriodStart } from '../utils/giftUtils';

const Gifts = () => {
  const { customers, invoices, settings, loading, error } = useErpData();
  const { userProfile } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [periodType, setPeriodType] = useState<GiftPeriod>('3_months');
  const [periodEnd, setPeriodEnd] = useState(getTodayDateString());
  const [notesByCustomer, setNotesByCustomer] = useState<Record<string, string>>({});
  const [giftError, setGiftError] = useState('');
  const [message, setMessage] = useState('');

  const periodStart = useMemo(() => getGiftPeriodStart(periodType, periodEnd), [periodEnd, periodType]);

  const loadGiftHistory = async () => {
    try {
      setGiftError('');
      setGiftHistory(await getGiftHistory());
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to load gift history.');
    }
  };

  useEffect(() => {
    loadGiftHistory();
  }, []);

  const giftRows = useMemo(() => {
    return buildGiftEligibilityRows(customers, invoices, giftHistory, settings, periodType, periodStart, periodEnd);
  }, [customers, giftHistory, invoices, periodEnd, periodStart, periodType, settings]);

  const totals = useMemo(() => {
    return {
      sales: giftRows.reduce((sum, row) => sum + row.salesAmount, 0),
      budget: giftRows.reduce((sum, row) => sum + row.giftBudget, 0),
      gifted: giftHistory.reduce((sum, gift) => sum + gift.giftAmount, 0),
      remaining: giftRows.reduce((sum, row) => sum + row.remainingEligibility, 0)
    };
  }, [giftHistory, giftRows]);

  const handleMarkGifted = async (row: (typeof giftRows)[number]) => {
    if (row.isDuplicatePeriod) {
      setGiftError('This customer already has a gift history record overlapping the selected period.');
      return;
    }

    if (row.giftBudget <= 0) {
      setGiftError('Gift budget is zero for this customer and period.');
      return;
    }

    const confirmed = window.confirm(`Mark ${formatMoney(row.giftBudget)} gifted to ${row.customer.name}?`);
    if (!confirmed) return;

    await createGiftHistoryRecord({
      customerId: row.customer.id,
      customerName: row.customer.name,
      tier: row.customer.tier,
      periodType,
      periodStart,
      periodEnd,
      salesAmount: row.salesAmount,
      giftPercentage: row.giftPercentage,
      giftAmount: row.giftBudget,
      giftedDate: getTodayDateString(),
      giftedBy: userProfile?.email || 'Admin',
      notes: notesByCustomer[row.customer.id] || ''
    });

    setMessage('Gift marked successfully.');
    await loadGiftHistory();
  };

  const handleDeleteGift = async (gift: GiftHistory) => {
    const confirmed = window.confirm(`Delete gift record for ${gift.customerName}?`);
    if (!confirmed) return;
    await deleteGiftHistoryRecord(gift.id);
    setMessage('Gift history record deleted.');
    await loadGiftHistory();
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const inputStyle: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#0B1F3A',
    width: '100%',
    boxSizing: 'border-box'
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
    minWidth: 980,
    borderCollapse: 'collapse'
  };

  const headerCellStyle: CSSProperties = {
    padding: '12px 14px',
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4',
    textAlign: 'left',
    fontWeight: 900
  };

  const cellStyle: CSSProperties = {
    padding: '12px 14px',
    borderBottom: '1px solid #E8EDF4'
  };

  if (loading) {
    return <SectionHeader title="Gift Budget" description="Loading gift eligibility..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Gift Budget"
        description="Calculate configurable gift eligibility and prevent duplicate rewards for the same sales period."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {giftError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{giftError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18, marginBottom: 24 }}>
        <StatCard title="Period Sales" value={formatMoney(totals.sales)} subtitle={`${periodStart} to ${periodEnd}`} />
        <StatCard title="Gift Budget" value={formatMoney(totals.budget)} subtitle="Calculated from tier settings" />
        <StatCard title="Total Gifted" value={formatMoney(totals.gifted)} subtitle="All gift history" />
        <StatCard title="Remaining Eligibility" value={formatMoney(totals.remaining)} subtitle="Current period" />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Gift Period
            <select style={{ ...inputStyle, marginTop: 6 }} value={periodType} onChange={(event) => setPeriodType(event.target.value as GiftPeriod)}>
              <option value="3_months">3 months</option>
              <option value="6_months">6 months</option>
              <option value="1_year">1 year</option>
            </select>
          </label>
          <label style={{ fontWeight: 800 }}>
            Period End
            <input style={{ ...inputStyle, marginTop: 6 }} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Gift Eligibility</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Tier', 'Sales', 'Gift %', 'Budget', 'Already Gifted', 'Remaining', 'Notes', 'Action'].map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {giftRows.map((row) => (
                <tr key={row.customer.id}>
                  <td style={cellStyle}><strong>{row.customer.name}</strong></td>
                  <td style={cellStyle}><TierBadge tier={row.customer.tier} /></td>
                  <td style={cellStyle}>{formatMoney(row.salesAmount)}</td>
                  <td style={cellStyle}>{row.giftPercentage}%</td>
                  <td style={cellStyle}>{formatMoney(row.giftBudget)}</td>
                  <td style={cellStyle}>{formatMoney(row.alreadyGiftedAmount)}</td>
                  <td style={{ ...cellStyle, color: row.remainingEligibility > 0 ? '#1B7F3A' : '#B42318', fontWeight: 900 }}>{formatMoney(row.remainingEligibility)}</td>
                  <td style={cellStyle}>
                    <input
                      style={inputStyle}
                      value={notesByCustomer[row.customer.id] || ''}
                      onChange={(event) => setNotesByCustomer((current) => ({ ...current, [row.customer.id]: event.target.value }))}
                      placeholder="Gift notes"
                    />
                  </td>
                  <td style={cellStyle}>
                    <button
                      type="button"
                      disabled={row.isDuplicatePeriod || row.giftBudget <= 0}
                      style={{ ...buttonStyle, background: row.isDuplicatePeriod ? '#E8EDF4' : '#D4AF37', color: '#0B1F3A' }}
                      onClick={() => handleMarkGifted(row)}
                    >
                      {row.isDuplicatePeriod ? 'Already Gifted' : 'Mark Gifted'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Gift History</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Tier', 'Period', 'Sales', 'Gift Amount', 'Gifted Date', 'Gifted By', 'Notes', 'Action'].map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {giftHistory.length === 0 ? (
                <tr><td style={cellStyle} colSpan={9}>No gift history yet.</td></tr>
              ) : (
                giftHistory.map((gift) => (
                  <tr key={gift.id}>
                    <td style={cellStyle}>{gift.customerName}</td>
                    <td style={cellStyle}><TierBadge tier={gift.tier} /></td>
                    <td style={cellStyle}>{getGiftPeriodLabel(gift.periodType)}: {gift.periodStart} to {gift.periodEnd}</td>
                    <td style={cellStyle}>{formatMoney(gift.salesAmount)}</td>
                    <td style={cellStyle}>{formatMoney(gift.giftAmount)}</td>
                    <td style={cellStyle}>{gift.giftedDate}</td>
                    <td style={cellStyle}>{gift.giftedBy}</td>
                    <td style={cellStyle}>{gift.notes || '-'}</td>
                    <td style={cellStyle}>
                      <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDeleteGift(gift)}>
                        Delete
                      </button>
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

export default Gifts;
