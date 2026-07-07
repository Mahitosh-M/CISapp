import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import ExternalImage from './ExternalImage';
import TierBadge from './TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { createGiftHistoryRecord, deleteGiftHistoryRecord, getApprovedBonusPcRequests, getApprovedOverduePcRequests, getGiftHistory, getRewardItems, updateGiftHistoryRecord } from '../services/firestoreService';
import type { BonusPcRequest, GiftHistory, GiftItem, GiftPeriod, OverduePcRequest, RewardItem } from '../types';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { buildSuggestedGiftRows, calculateGiftDifference } from '../utils/giftUtils';
import { latestFiveScrollStyle } from '../utils/listDisplay';

const REWARD_LEDGER_PERIOD_TYPE: GiftPeriod = 'custom';
const REWARD_LEDGER_PERIOD_START = '2000-01-01';

const SuggestedGiftManager = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const { userProfile, canApproveGifts } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [approvedOverduePcRequests, setApprovedOverduePcRequests] = useState<OverduePcRequest[]>([]);
  const [approvedBonusPcRequests, setApprovedBonusPcRequests] = useState<BonusPcRequest[]>([]);
  const [selectedGiftByCustomer, setSelectedGiftByCustomer] = useState<Record<string, string>>({});
  const [notesByCustomer, setNotesByCustomer] = useState<Record<string, string>>({});
  const [customerSearchText, setCustomerSearchText] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [giftError, setGiftError] = useState('');
  const [message, setMessage] = useState('');

  const mapRewardToGiftItem = (reward: RewardItem): GiftItem => ({
    id: reward.id,
    giftItemName: reward.name,
    targetType: 'score',
    targetValue: reward.requiredPoints,
    minBudget: 0,
    maxBudget: reward.requiredPoints,
    eligibleTier: 'All',
    notes: reward.description || '',
    isActive: reward.isActive,
    imageUrl: reward.imageUrl,
    imagePath: reward.imagePath,
    createdAt: reward.createdAt,
    updatedAt: reward.updatedAt
  });

  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadGiftData = async () => {
    try {
      setGiftError('');
      const [historyRows, rewardRows, overduePcRows, bonusPcRows] = await Promise.all([getGiftHistory(), getRewardItems(), getApprovedOverduePcRequests(100), getApprovedBonusPcRequests(100)]);
      setGiftHistory(historyRows);
      setGiftItems(rewardRows.map(mapRewardToGiftItem));
      setApprovedOverduePcRequests(overduePcRows);
      setApprovedBonusPcRequests(bonusPcRows);
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to load reward suggestions.');
    }
  };

  useEffect(() => {
    loadGiftData();
  }, []);

  const suggestedRows = useMemo(() => {
    return buildSuggestedGiftRows(customers, invoices, giftHistory, giftItems, settings, payments, approvedOverduePcRequests, approvedBonusPcRequests);
  }, [approvedBonusPcRequests, approvedOverduePcRequests, customers, giftHistory, giftItems, invoices, payments, settings]);

  const sortedSuggestedRows = useMemo(() => {
    return [...suggestedRows].sort((a, b) => b.giftBudget - a.giftBudget || a.customer.name.localeCompare(b.customer.name));
  }, [suggestedRows]);

  const searchedCustomerRows = useMemo(() => {
    const searchTerm = customerSearchText.trim().toLowerCase();
    if (!searchTerm) return sortedSuggestedRows;

    return sortedSuggestedRows.filter((row) =>
      [row.customer.name, row.customer.mobile, row.customer.area].some((value) => value.toLowerCase().includes(searchTerm))
    );
  }, [customerSearchText, sortedSuggestedRows]);

  const visibleSuggestedRows = useMemo(() => {
    if (!selectedCustomerId) return [];
    return sortedSuggestedRows.filter((row) => row.customer.id === selectedCustomerId);
  }, [selectedCustomerId, sortedSuggestedRows]);

  const eligibleCount = sortedSuggestedRows.filter((row) => row.status === 'Eligible').length;
  const blockedCount = sortedSuggestedRows.filter((row) => row.status === 'Approved').length;

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

  const getSelectedRewardCost = (row: (typeof suggestedRows)[number]) => getSelectedGiftItem(row)?.targetValue ?? 0;

  const getDisplayStatus = (row: (typeof suggestedRows)[number]) => {
    if (row.status === 'Eligible' && getSelectedGiftName(row)) return 'Selected';
    if (row.status === 'Already Gifted') return 'Already Redeemed';
    return row.status;
  };

  const handleSelectGift = (customerId: string, giftItemName: string) => {
    setSelectedGiftByCustomer((current) => ({ ...current, [customerId]: giftItemName }));
  };

  const buildGiftPayload = (row: (typeof suggestedRows)[number], status: 'Approved' | 'Given') => {
    const selectedGiftItemName = getSelectedGiftName(row);
    const selectedRewardCost = getSelectedRewardCost(row);

    return {
      customerId: row.customer.id,
      customerName: row.customer.name,
      tier: row.customer.tier,
      tierAtGiftTime: row.customer.tier,
      periodType: REWARD_LEDGER_PERIOD_TYPE,
      periodStart: REWARD_LEDGER_PERIOD_START,
      periodEnd: getTodayDateString(),
      salesAmount: row.salesAmount,
      profitConsidered: row.profitConsidered,
      giftPercentage: settings.giftPercentages[row.customer.tier],
      giftAmount: status === 'Given' ? selectedRewardCost : 0,
      suggestedGiftBudget: row.giftBudget,
      actualGiftAmount: status === 'Given' ? selectedRewardCost : 0,
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
      setGiftError('Only Admin users can approve rewards.');
      return;
    }

    if (row.status !== 'Eligible') {
      setGiftError('This customer is not eligible for a new reward approval.');
      return;
    }

    if (!getSelectedGiftName(row)) {
      setGiftError('Select a reward option before approving.');
      return;
    }

    await createGiftHistoryRecord(buildGiftPayload(row, 'Approved'), auditUser);
    setMessage('Suggested reward approved.');
    setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: '' }));
    await loadGiftData();
  };

  const handleUpdateApprovedGift = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can change approved rewards.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('Approve a reward before changing the approved selection.');
      return;
    }

    if (!getSelectedGiftName(row)) {
      setGiftError('Select a reward option before updating the approved reward.');
      return;
    }

    await updateGiftHistoryRecord(row.pendingApproval.id, buildGiftPayload(row, 'Approved'), auditUser);
    setMessage('Approved reward changed.');
    setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: '' }));
    await loadGiftData();
  };

  const handleMarkGiven = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can mark rewards as redeemed.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('Approve the selected reward before marking it as redeemed.');
      return;
    }

    await updateGiftHistoryRecord(row.pendingApproval.id, buildGiftPayload(row, 'Given'), auditUser);
    setMessage('Reward marked as redeemed.');
    await loadGiftData();
  };

  const handleRemoveApproval = async (row: (typeof suggestedRows)[number]) => {
    if (!canApproveGifts) {
      setGiftError('Only Admin users can remove reward approval.');
      return;
    }

    if (!row.pendingApproval) {
      setGiftError('There is no approved reward to remove for this customer.');
      return;
    }

    const confirmed = window.confirm(`Remove approved reward for ${row.customer.name}? This will allow a new reward selection.`);
    if (!confirmed) return;

    await deleteGiftHistoryRecord(row.pendingApproval.id, auditUser);
    setSelectedGiftByCustomer((current) => ({ ...current, [row.customer.id]: '' }));
    setMessage('Reward approval removed.');
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
          : status === 'Already Gifted' || status === 'Already Redeemed'
            ? '#FDECEC'
            : '#E8EDF4';
    const color =
      status === 'Selected' || status === 'Eligible'
        ? '#1B7F3A'
        : status === 'Approved'
          ? '#8A6D00'
          : status === 'Already Gifted' || status === 'Already Redeemed'
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
    return <div style={cardStyle}>Loading reward suggestions...</div>;
  }

  return (
    <>
      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {giftError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{giftError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Customer Reward Suggestions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <div style={{ fontWeight: 900, color: '#0B1F3A', alignSelf: 'end' }}>
            Eligible: {eligibleCount} | Pending Approval: {blockedCount}
          </div>
          <div style={{ color: '#67738E', fontSize: 13, lineHeight: 1.5 }}>
            Available PC points are lifetime earned points plus bonuses, reduced only when rewards are redeemed.
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>
          Select a customer to view reward suggestions. Search filters the dropdown list.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Search Customer
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={customerSearchText}
              onChange={(event) => setCustomerSearchText(event.target.value)}
              placeholder="Name, mobile, or area"
            />
          </label>
          <label style={{ fontWeight: 800 }}>
            Customer
            <select
              style={{ ...inputStyle, marginTop: 6 }}
              value={selectedCustomerId}
              onChange={(event) => setSelectedCustomerId(event.target.value)}
            >
              <option value="">Select customer</option>
              {searchedCustomerRows.map((row) => (
                <option key={row.customer.id} value={row.customer.id}>
                  {formatCustomerSelectLabel(row.customer)} - {formatMoney(row.giftBudget)} PC
                </option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: 'end', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }}
              onClick={() => {
                setSelectedCustomerId('');
                setCustomerSearchText('');
              }}
            >
              Clear
            </button>
          </div>
        </div>
        {customerSearchText && searchedCustomerRows.length === 0 ? (
          <div style={{ color: '#B42318', fontWeight: 800, marginBottom: 12 }}>No customer matches your search.</div>
        ) : null}
        <div style={{ ...latestFiveScrollStyle, maxHeight: 520, paddingRight: 6 }}>
          {!selectedCustomerId ? (
            <div style={{ color: '#67738E', border: '1px solid #E8EDF4', borderRadius: 14, padding: 16 }}>
              Choose a customer from the dropdown to show reward eligibility, available PC points, and approval actions.
            </div>
          ) : visibleSuggestedRows.length === 0 ? (
            <div style={{ color: '#67738E' }}>No reward suggestion found for the selected customer.</div>
          ) : (
            visibleSuggestedRows.map((row) => {
              const selectedGiftName = getSelectedGiftName(row);
              const selectedRewardCost = getSelectedRewardCost(row);
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
                    <div><strong>Available PC Points</strong><div>{formatMoney(row.giftBudget)}</div></div>
                    <div><strong>Redeemed PC Points</strong><div>{formatMoney(row.alreadyGiftedAmount)}</div></div>
                    <div><strong>Selected Reward</strong><div>{selectedGiftName || '-'}</div></div>
                    <div><strong>Selected Reward Cost</strong><div>{selectedGiftName ? formatMoney(selectedRewardCost) : '-'}</div></div>
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
                            {giftItem.imageUrl ? (
                              <ExternalImage
                                src={giftItem.imageUrl}
                                alt={giftItem.giftItemName}
                                style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 10, display: 'block', marginBottom: 8 }}
                              />
                            ) : null}
                            <div style={{ fontWeight: 900 }}>{giftItem.giftItemName}</div>
                            <div style={{ marginTop: 5 }}>{formatMoney(giftItem.targetValue)} PC</div>
                            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
                              {difference === 0 ? 'Exact PC match' : `${formatMoney(difference)} PC below limit`}
                            </div>
                            {giftItem.notes ? <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>{giftItem.notes}</div> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#67738E', marginBottom: 14 }}>
                      {row.pendingApproval ? `Approved reward: ${selectedGiftName || '-'}` : 'No selectable reward option for these available PC points.'}
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
                        placeholder="Reward notes"
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
                          Update Approved Reward
                        </button>
                        <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleRemoveApproval(row)}>
                          Remove Approval
                        </button>
                        <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={() => handleMarkGiven(row)}>
                          Mark as Redeemed
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={row.status !== 'Eligible' || !selectedGiftName}
                        style={{ ...buttonStyle, background: row.status === 'Eligible' && selectedGiftName ? '#D4AF37' : '#E8EDF4', color: '#0B1F3A' }}
                        onClick={() => handleApproveGift(row)}
                      >
                        Approve Reward
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ color: '#67738E', fontSize: 12, marginTop: 12 }}>
          Available PC points do not expire. Redeemed rewards are deducted from the customer balance.
        </div>
      </div>
    </>
  );
};

export default SuggestedGiftManager;
