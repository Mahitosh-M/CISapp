import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { createGiftHistoryRecord, getGiftHistory, getGiftItems, updateGiftHistoryRecord } from '../services/firestoreService';
import type { GiftHistory, GiftItem, GiftPeriod } from '../types';
import { buildCustomerScoresForDateRange } from '../utils/customerAnalytics';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { buildSuggestedGiftRows, getGiftPeriodLabel, getGiftPeriodStart } from '../utils/giftUtils';

const SuggestedGifts = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const { userProfile, canApproveGifts } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [periodType, setPeriodType] = useState<GiftPeriod>('3_months');
  const [periodEnd, setPeriodEnd] = useState(getTodayDateString());
  const [customPeriodStart, setCustomPeriodStart] = useState(getGiftPeriodStart('3_months', getTodayDateString()));
  const [selectedGiftByCustomer, setSelectedGiftByCustomer] = useState<Record<string, string>>({});
  const [notesByCustomer, setNotesByCustomer] = useState<Record<string, string>>({});
  const [giftError, setGiftError] = useState('');
  const [message, setMessage] = useState('');

  const periodStart = useMemo(() => (periodType === 'custom' ? customPeriodStart : getGiftPeriodStart(periodType, periodEnd)), [customPeriodStart, periodEnd, periodType]);
  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadGiftData = async () => {
    try {
      setGiftError('');
      const [historyRows, itemRows] = await Promise.all([getGiftHistory(), getGiftItems()]);
      setGiftHistory(historyRows);
      setGiftItems(itemRows);
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to load suggested gifts.');
    }
  };

  useEffect(() => {
    loadGiftData();
  }, []);

  const customerScores = useMemo(() => {
    return buildCustomerScoresForDateRange(customers, invoices, payments, periodStart, periodEnd, settings);
  }, [customers, invoices, payments, periodEnd, periodStart, settings]);

  const suggestedRows = useMemo(() => {
    return buildSuggestedGiftRows(customers, invoices, giftHistory, giftItems, settings, periodType, periodStart, periodEnd, customerScores);
  }, [customerScores, customers, giftHistory, giftItems, invoices, periodEnd, periodStart, periodType, settings]);

  const eligibleCount = suggestedRows.filter((row) => row.status === 'Eligible').length;
  const alreadyGiftedCount = suggestedRows.filter((row) => row.status === 'Already Gifted').length;

  const getSelectedGiftName = (row: (typeof suggestedRows)[number]) => {
    return selectedGiftByCustomer[row.customer.id] || row.pendingApproval?.selectedGiftItemName || row.pendingApproval?.giftItem || row.suggestedGiftNames[0] || '';
  };

  const buildGiftPayload = (row: (typeof suggestedRows)[number], status: 'Approved' | 'Given') => {
    const selectedGiftItemName = getSelectedGiftName(row);

    return {
      customerId: row.customer.id,
      customerName: row.customer.name,
      tier: row.customer.tier,
      tierAtGiftTime: row.customer.tier,
      periodType,
      periodStart,
      periodEnd,
      salesAmount: row.salesAmount,
      profitConsidered: row.profitConsidered,
      giftPercentage: settings.giftPercentages[row.customer.tier],
      giftAmount: status === 'Given' ? row.giftBudget : 0,
      suggestedGiftBudget: row.giftBudget,
      actualGiftAmount: status === 'Given' ? row.giftBudget : 0,
      giftItem: selectedGiftItemName,
      selectedGiftItemName,
      // Multiple gift options in the same budget range are stored so history explains the final choice.
      suggestedGiftOptions: row.suggestedGiftNames,
      giftBudget: row.giftBudget,
      giftedDate: status === 'Given' ? getTodayDateString() : '',
      giftGivenDate: status === 'Given' ? getTodayDateString() : '',
      giftedBy: status === 'Given' ? userProfile?.email || 'Admin' : '',
      approvedBy: userProfile?.email || 'Admin',
      status,
      notes: notesByCustomer[row.customer.id] || row.pendingApproval?.notes || ''
    };
  };

  const handleApproveGift = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can approve gifts.');
      return;
    }

    if (row.status !== 'Eligible' || row.suggestedGiftNames.length === 0) {
      setGiftError('This customer does not have an eligible suggested gift for the selected period.');
      return;
    }

    await createGiftHistoryRecord(buildGiftPayload(row, 'Approved'), auditUser);
    setMessage('Suggested gift approved.');
    await loadGiftData();
  };

  const handleMarkGiven = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can mark gifts as given.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('Approve the suggested gift before marking it as given.');
      return;
    }

    await updateGiftHistoryRecord(row.pendingApproval.id, buildGiftPayload(row, 'Given'), auditUser);
    setMessage('Gift marked as given.');
    await loadGiftData();
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
    minWidth: 1180,
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
    borderBottom: '1px solid #E8EDF4',
    verticalAlign: 'top'
  };

  if (loading) {
    return <SectionHeader title="Suggested Gifts" description="Loading gift suggestions..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Suggested Gifts"
        description="View gift item suggestions from real Firestore sales, profit, score, tier, budget, and gift history."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {giftError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{giftError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Gift Period
            <select style={{ ...inputStyle, marginTop: 6 }} value={periodType} onChange={(event) => setPeriodType(event.target.value as GiftPeriod)}>
              <option value="3_months">3 months</option>
              <option value="6_months">6 months</option>
              <option value="1_year">1 year</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {periodType === 'custom' ? (
            <label style={{ fontWeight: 800 }}>
              Period Start
              <input style={{ ...inputStyle, marginTop: 6 }} type="date" value={customPeriodStart} onChange={(event) => setCustomPeriodStart(event.target.value)} />
            </label>
          ) : null}
          <label style={{ fontWeight: 800 }}>
            Period End
            <input style={{ ...inputStyle, marginTop: 6 }} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
          <div style={{ fontWeight: 900, color: '#0B1F3A', alignSelf: 'end' }}>
            Eligible: {eligibleCount} | Already Gifted: {alreadyGiftedCount}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Suggested Gifts Table</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Tier', 'Sales', 'Profit', 'Score', 'Gift Budget', 'Suggested Gifts', 'Reason', 'Status', 'Final Gift', 'Notes', 'Action'].map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suggestedRows.length === 0 ? (
                <tr><td style={cellStyle} colSpan={12}>No customers found.</td></tr>
              ) : (
                suggestedRows.map((row) => {
                  const selectedGiftName = getSelectedGiftName(row);
                  const giftOptions =
                    selectedGiftName && !row.suggestedGiftNames.includes(selectedGiftName)
                      ? [selectedGiftName, ...row.suggestedGiftNames]
                      : row.suggestedGiftNames;
                  const statusColor = row.status === 'Eligible' ? '#1B7F3A' : row.status === 'Already Gifted' ? '#B7791F' : '#67738E';

                  return (
                    <tr key={row.customer.id}>
                      <td style={cellStyle}><strong>{row.customer.name}</strong></td>
                      <td style={cellStyle}><TierBadge tier={row.customer.tier} /></td>
                      <td style={cellStyle}>{formatMoney(row.salesAmount)}</td>
                      <td style={cellStyle}>{formatMoney(row.profitConsidered)}</td>
                      <td style={cellStyle}>{row.score}</td>
                      <td style={cellStyle}>{formatMoney(row.giftBudget)}</td>
                      <td style={cellStyle}>{row.suggestedGiftNames.length > 0 ? row.suggestedGiftNames.join(', ') : '-'}</td>
                      <td style={{ ...cellStyle, color: '#67738E' }}>{row.eligibilityReason}</td>
                      <td style={{ ...cellStyle, color: statusColor, fontWeight: 900 }}>{row.pendingApproval ? 'Eligible' : row.status}</td>
                      <td style={cellStyle}>
                        <select
                          style={inputStyle}
                          value={selectedGiftName}
                          disabled={!canApproveGifts || giftOptions.length === 0 || row.status === 'Already Gifted'}
                          onChange={(event) => setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: event.target.value }))}
                        >
                          {giftOptions.length === 0 ? <option value="">No option</option> : null}
                          {giftOptions.map((giftName) => (
                            <option key={giftName} value={giftName}>{giftName}</option>
                          ))}
                        </select>
                      </td>
                      <td style={cellStyle}>
                        <input
                          style={inputStyle}
                          value={notesByCustomer[row.customer.id] ?? row.pendingApproval?.notes ?? ''}
                          disabled={!canApproveGifts}
                          onChange={(event) => setNotesByCustomer((current) => ({ ...current, [row.customer.id]: event.target.value }))}
                          placeholder="Gift notes"
                        />
                      </td>
                      <td style={cellStyle}>
                        {!canApproveGifts ? (
                          <span style={{ color: '#67738E', fontWeight: 800 }}>View only</span>
                        ) : row.pendingApproval ? (
                          <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={() => handleMarkGiven(row)}>
                            Mark Given
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={row.status !== 'Eligible'}
                            style={{ ...buttonStyle, background: row.status === 'Eligible' ? '#D4AF37' : '#E8EDF4', color: '#0B1F3A' }}
                            onClick={() => handleApproveGift(row)}
                          >
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div style={{ color: '#67738E', fontSize: 12, marginTop: 12 }}>
          {getGiftPeriodLabel(periodType)} period: {periodStart} to {periodEnd}. Duplicate prevention hides suggestions after a Given gift exists for an overlapping period.
        </div>
      </div>
    </div>
  );
};

export default SuggestedGifts;
