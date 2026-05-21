import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { createGiftHistoryRecord, deleteGiftHistoryRecord, getGiftHistory, getGiftItems, updateGiftHistoryRecord } from '../services/firestoreService';
import type { GiftHistory, GiftItem, GiftPeriod } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { formatDateRange, formatMoney } from '../utils/formatters';
import { buildSuggestedGiftRows, calculateGiftDifference, getGiftPeriodLabel, getGiftPeriodStart, getMonthEndDateString } from '../utils/giftUtils';
import { latestEntriesNotice, latestFiveScrollStyle } from '../utils/listDisplay';

const SuggestedGifts = () => {
  const { customers, invoices, settings, loading, error } = useErpData();
  const { userProfile, canApproveGifts } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const defaultPeriodEnd = getMonthEndDateString(getTodayDateString());
  const [periodType, setPeriodType] = useState<GiftPeriod>('1_month');
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [customPeriodStart, setCustomPeriodStart] = useState(getGiftPeriodStart('1_month', defaultPeriodEnd));
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

  const handlePeriodEndChange = (value: string) => {
    const normalizedMonthEnd = getMonthEndDateString(value);
    const minimumPeriodStart = getGiftPeriodStart('1_month', normalizedMonthEnd);
    setPeriodEnd(normalizedMonthEnd);
    setCustomPeriodStart((current) => (current > minimumPeriodStart ? minimumPeriodStart : current));
  };

  const handleCustomPeriodStartChange = (value: string) => {
    const minimumPeriodStart = getGiftPeriodStart('1_month', periodEnd);
    // Custom ranges must still cover at least one full month ending on month-end.
    setCustomPeriodStart(value > minimumPeriodStart ? minimumPeriodStart : value);
  };

  const suggestedRows = useMemo(() => {
    return buildSuggestedGiftRows(customers, invoices, giftHistory, giftItems, settings, periodType, periodStart, periodEnd);
  }, [customers, giftHistory, giftItems, invoices, periodEnd, periodStart, periodType, settings]);

  const sortedSuggestedRows = useMemo(() => {
    // Customer gift suggestions are sorted by gift budget from high to low so Admin
    // can review the highest-value rewards first. Name is the stable fallback.
    return [...suggestedRows].sort((a, b) => b.giftBudget - a.giftBudget || a.customer.name.localeCompare(b.customer.name));
  }, [suggestedRows]);

  const eligibleCount = sortedSuggestedRows.filter((row) => row.status === 'Eligible').length;
  const blockedCount = sortedSuggestedRows.filter((row) => row.status === 'Approved' || row.status === 'Already Gifted').length;

  const getSelectedGiftName = (row: (typeof suggestedRows)[number]) => {
    return selectedGiftByCustomer[row.customer.id] || row.pendingApproval?.selectedGiftItemName || row.pendingApproval?.giftItem || '';
  };

  const getApprovedGiftName = (row: (typeof suggestedRows)[number]) => {
    return row.pendingApproval?.selectedGiftItemName || row.pendingApproval?.giftItem || '';
  };

  const hasChangedApprovedGift = (row: (typeof suggestedRows)[number]) => {
    return Boolean(row.pendingApproval && getSelectedGiftName(row) && getSelectedGiftName(row) !== getApprovedGiftName(row));
  };

  const getSelectedGiftItem = (row: (typeof suggestedRows)[number]) => {
    const selectedGiftName = getSelectedGiftName(row);
    if (!selectedGiftName) return undefined;
    return row.matchedGiftItems.find((giftItem) => giftItem.giftItemName === selectedGiftName) || giftItems.find((giftItem) => giftItem.giftItemName === selectedGiftName);
  };

  const getSelectedGiftTargetValue = (row: (typeof suggestedRows)[number]) => {
    return getSelectedGiftItem(row)?.targetValue ?? 0;
  };

  const getAvailableGiftBudgetAfterSelection = (row: (typeof suggestedRows)[number]) => {
    // Available Gift Budget = Gifts page gift budget - selected gift item target value.
    // If no gift is selected yet, the full budget remains available.
    return Math.max(0, row.giftBudget - getSelectedGiftTargetValue(row));
  };

  const getDisplayStatus = (row: (typeof suggestedRows)[number]) => {
    if (row.status === 'Eligible' && getSelectedGiftName(row)) return 'Selected';
    if (row.status === 'Already Gifted') return 'Already Gifted';
    return row.status;
  };

  const handleSelectGift = (customerId: string, giftItemName: string) => {
    // Selection is local until Admin approves. This lets staff view options without changing Firestore.
    setSelectedGiftByCustomer((current) => ({ ...current, [customerId]: giftItemName }));
  };

  const buildGiftPayload = (row: (typeof suggestedRows)[number], status: 'Approved' | 'Given') => {
    const selectedGiftItemName = getSelectedGiftName(row);
    const selectedGiftTargetValue = getSelectedGiftTargetValue(row);

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
      giftAmount: status === 'Given' ? selectedGiftTargetValue : 0,
      suggestedGiftBudget: row.giftBudget,
      actualGiftAmount: status === 'Given' ? selectedGiftTargetValue : 0,
      giftItem: selectedGiftItemName,
      selectedGiftItemName,
      suggestedGiftOptions: row.suggestedGiftNames.length > 0 ? row.suggestedGiftNames : row.pendingApproval?.suggestedGiftOptions ?? [],
      giftBudget: row.giftBudget,
      giftedDate: status === 'Given' ? getTodayDateString() : '',
      giftGivenDate: status === 'Given' ? getTodayDateString() : '',
      giftedBy: status === 'Given' ? userProfile?.email || 'Admin' : '',
      approvedBy: row.pendingApproval?.approvedBy || userProfile?.email || 'Admin',
      status,
      notes: notesByCustomer[row.customer.id] || row.pendingApproval?.notes || ''
    };
  };

  const handleApproveGift = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can approve gifts.');
      return;
    }

    if (row.status !== 'Eligible') {
      setGiftError('This customer is not eligible for a new gift approval for the selected period.');
      return;
    }

    if (!getSelectedGiftName(row)) {
      setGiftError('Select a gift option before approving.');
      return;
    }

    await createGiftHistoryRecord(buildGiftPayload(row, 'Approved'), auditUser);
    setMessage('Suggested gift approved.');
    setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: '' }));
    await loadGiftData();
  };

  const handleUpdateApprovedGift = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can change approved gifts.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('Approve a gift before changing the approved selection.');
      return;
    }

    if (!getSelectedGiftName(row)) {
      setGiftError('Select a gift option before updating the approved gift.');
      return;
    }

    // Approved gifts can be changed until they are marked Given. The same giftHistory
    // record is updated so duplicate period prevention remains intact.
    await updateGiftHistoryRecord(row.pendingApproval.id, buildGiftPayload(row, 'Approved'), auditUser);
    setMessage('Approved gift changed.');
    setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: '' }));
    await loadGiftData();
  };

  const handleMarkGiven = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can mark gifts as given.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('Approve the selected gift before marking it as gifted.');
      return;
    }

    await updateGiftHistoryRecord(row.pendingApproval.id, buildGiftPayload(row, 'Given'), auditUser);
    setMessage('Gift marked as gifted.');
    await loadGiftData();
  };

  const handleRemoveApproval = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can remove gift approval.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('There is no approved gift to remove for this customer and period.');
      return;
    }

    const confirmed = window.confirm(`Remove approved gift for ${row.customer.name}? This will allow a new gift selection for the same period.`);
    if (!confirmed) return;

    // Removing approval deletes only the pending Approved history row. Given rows are
    // not exposed here, so completed gift history remains protected.
    await deleteGiftHistoryRecord(row.pendingApproval.id, auditUser);
    setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: '' }));
    setMessage('Gift approval removed.');
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

  const getStatusStyle = (status: string): CSSProperties => {
    const background =
      status === 'Selected' || status === 'Eligible'
        ? '#EAF8EE'
        : status === 'Approved'
          ? '#FFF7D6'
          : status === 'Already Gifted'
            ? '#FDECEC'
            : '#E8EDF4';
    const color =
      status === 'Selected' || status === 'Eligible'
        ? '#1B7F3A'
        : status === 'Approved'
          ? '#8A6D00'
          : status === 'Already Gifted'
            ? '#B42318'
            : '#67738E';

    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6px 11px',
      borderRadius: 999,
      background,
      color,
      fontWeight: 900,
      fontSize: 12,
      lineHeight: 1.1,
      minWidth: 92,
      maxWidth: '100%',
      whiteSpace: 'nowrap',
      boxSizing: 'border-box'
    };
  };

  if (loading) {
    return <SectionHeader title="Suggested Gifts" description="Loading gift suggestions..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Suggested Gifts"
        description="Suggest gift items from the existing profit-based gift budget and prevent repeat rewards for the same period."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {giftError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{giftError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={cardStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Gift Period
            <select style={{ ...inputStyle, marginTop: 6 }} value={periodType} onChange={(event) => setPeriodType(event.target.value as GiftPeriod)}>
              <option value="1_month">1 month</option>
              <option value="3_months">3 months</option>
              <option value="6_months">6 months</option>
              <option value="1_year">1 year</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {periodType === 'custom' ? (
            <label style={{ fontWeight: 800 }}>
              Period Start
              <input style={{ ...inputStyle, marginTop: 6 }} type="date" value={customPeriodStart} onChange={(event) => handleCustomPeriodStartChange(event.target.value)} />
            </label>
          ) : null}
          <label style={{ fontWeight: 800 }}>
            Period End
            <input style={{ ...inputStyle, marginTop: 6 }} type="date" value={periodEnd} onChange={(event) => handlePeriodEndChange(event.target.value)} />
          </label>
          <div style={{ fontWeight: 900, color: '#0B1F3A', alignSelf: 'end' }}>
            Eligible: {eligibleCount} | Approved/Gifted: {blockedCount}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Customer Gift Suggestions</div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, maxHeight: 520, paddingRight: 6 }}>
          {sortedSuggestedRows.length === 0 ? (
            <div style={{ color: '#67738E' }}>No customers found.</div>
          ) : (
            sortedSuggestedRows.map((row) => {
              const selectedGiftName = getSelectedGiftName(row);
              const selectedGiftTargetValue = getSelectedGiftTargetValue(row);
              const availableGiftBudget = getAvailableGiftBudgetAfterSelection(row);
              const displayStatus = getDisplayStatus(row);

              return (
                <div key={row.customer.id} style={{ border: '1px solid #E8EDF4', borderRadius: 14, padding: 16, marginBottom: 14, background: '#FFFFFF', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 900 }}>{row.customer.name}</div>
                      <div style={{ marginTop: 6 }}><TierBadge tier={row.customer.tier} /></div>
                    </div>
                    <span style={{ ...getStatusStyle(displayStatus), flex: '0 0 auto' }}>{displayStatus}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
                    <div><strong>Profit Considered</strong><div>{formatMoney(row.profitConsidered)}</div></div>
                    <div><strong>Gift Budget</strong><div>{formatMoney(row.giftBudget)}</div></div>
                    <div><strong>Gift Item Target</strong><div>{selectedGiftName ? formatMoney(selectedGiftTargetValue) : '-'}</div></div>
                    <div><strong>Available Gift Budget</strong><div>{formatMoney(availableGiftBudget)}</div></div>
                    <div><strong>Already Gifted</strong><div>{formatMoney(row.alreadyGiftedAmount)}</div></div>
                    <div><strong>Selected Gift</strong><div>{selectedGiftName || '-'}</div></div>
                  </div>

                  <div style={{ color: '#67738E', marginBottom: 10 }}>{row.eligibilityReason}</div>

                  {row.matchedGiftItems.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                      {row.matchedGiftItems.map((giftItem) => {
                        const isSelected = selectedGiftName === giftItem.giftItemName;
                        const difference = calculateGiftDifference(row.giftBudget, giftItem);

                        return (
                          <button
                            key={giftItem.id}
                            type="button"
                            style={{
                              ...buttonStyle,
                              textAlign: 'left',
                              background: isSelected ? '#FFF7D6' : '#F8F9FB',
                              border: isSelected ? '2px solid #D4AF37' : '1px solid #E8EDF4',
                              color: '#0B1F3A'
                            }}
                            onClick={() => handleSelectGift(row.customer.id, giftItem.giftItemName)}
                          >
                            <div style={{ fontWeight: 900 }}>{giftItem.giftItemName}</div>
                            <div style={{ marginTop: 5 }}>{formatMoney(giftItem.targetValue)}</div>
                            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
                              {difference === 0 ? 'Exact budget match' : `${formatMoney(difference)} under budget`}
                            </div>
                            {giftItem.notes ? <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>{giftItem.notes}</div> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#67738E', marginBottom: 14 }}>
                      {row.pendingApproval ? `Approved gift: ${selectedGiftName || '-'}` : 'No selectable gift option for this budget.'}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) auto', gap: 12, alignItems: 'end' }}>
                    <label style={{ fontWeight: 800 }}>
                      Notes
                      <input
                        style={{ ...inputStyle, marginTop: 6 }}
                        value={notesByCustomer[row.customer.id] ?? row.pendingApproval?.notes ?? ''}
                        disabled={!canApproveGifts}
                        onChange={(event) => setNotesByCustomer((current) => ({ ...current, [row.customer.id]: event.target.value }))}
                        placeholder="Gift notes"
                      />
                    </label>
                    {!canApproveGifts ? (
                      <span style={{ color: '#67738E', fontWeight: 800 }}>View only</span>
                    ) : row.pendingApproval ? (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          disabled={!hasChangedApprovedGift(row)}
                          style={{ ...buttonStyle, background: hasChangedApprovedGift(row) ? '#0B1F3A' : '#E8EDF4', color: hasChangedApprovedGift(row) ? '#FFFFFF' : '#67738E' }}
                          onClick={() => handleUpdateApprovedGift(row)}
                        >
                          Update Approved Gift
                        </button>
                        <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleRemoveApproval(row)}>
                          Remove Approval
                        </button>
                        <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={() => handleMarkGiven(row)}>
                          Mark as Gifted
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={row.status !== 'Eligible' || !selectedGiftName}
                        style={{ ...buttonStyle, background: row.status === 'Eligible' && selectedGiftName ? '#D4AF37' : '#E8EDF4', color: '#0B1F3A' }}
                        onClick={() => handleApproveGift(row)}
                      >
                        Approve Gift
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ color: '#67738E', fontSize: 12, marginTop: 12 }}>
          {getGiftPeriodLabel(periodType)} period: {formatDateRange(periodStart, periodEnd)}. Period end is always month-end. Earlier gifted amounts inside this range are deducted from available gift budget.
        </div>
      </div>

    </div>
  );
};

export default SuggestedGifts;
