import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import ExternalImage from './ExternalImage';
import TierBadge from './TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { createGiftHistoryRecord, deleteGiftHistoryRecord, getAppSettings, getGiftHistoryByCustomerId, getRewardItems, updateGiftHistoryRecord } from '../services/firestoreService';
import { getIntelligenceSummariesPage, type IntelligencePageCursor } from '../services/derivedDataService';
import type { AppSettings, Customer, CustomerIntelligenceSummary, GiftHistory, GiftItem, GiftPeriod, RewardItem } from '../types';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { calculateGiftDifference } from '../utils/giftUtils';
import { latestFiveScrollStyle } from '../utils/listDisplay';
import { DEFAULT_SETTINGS } from '../utils/settings';

const REWARD_LEDGER_PERIOD_TYPE: GiftPeriod = 'custom';
const REWARD_LEDGER_PERIOD_START = '2000-01-01';

const SuggestedGiftManager = () => {
  const { userProfile, canApproveGifts } = useAuth();
  const [summaries, setSummaries] = useState<CustomerIntelligenceSummary[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [pageCursor, setPageCursor] = useState<IntelligencePageCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [error, setError] = useState('');
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

  const loadGiftData = async (append = false) => {
    try {
      setLoading(true);
      setGiftError('');
      const [summaryPage, rewardRows, appSettings] = await Promise.all([
        getIntelligenceSummariesPage(append ? pageCursor : undefined),
        getRewardItems(),
        getAppSettings()
      ]);
      setSummaries((current) => append ? [...current, ...summaryPage.rows] : summaryPage.rows);
      setPageCursor(summaryPage.cursor);
      setHasMore(summaryPage.hasMore);
      setGiftItems(rewardRows.map(mapRewardToGiftItem));
      setSettings(appSettings);
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to load reward suggestions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGiftData();
  }, []);

  const refreshSelectedGiftHistory = async () => {
    if (!selectedCustomerId) return;
    setGiftHistory(await getGiftHistoryByCustomerId(selectedCustomerId));
  };

  useEffect(() => {
    let active = true;
    if (!selectedCustomerId) {
      setGiftHistory([]);
      return undefined;
    }
    setGiftHistory([]);
    setLoadingCustomer(true);
    getGiftHistoryByCustomerId(selectedCustomerId)
      .then((rows) => active && setGiftHistory(rows))
      .catch((err) => active && setGiftError(err instanceof Error ? err.message : 'Unable to load customer reward history.'))
      .finally(() => active && setLoadingCustomer(false));
    return () => { active = false; };
  }, [selectedCustomerId]);

  const suggestedRows = useMemo(() => summaries.map((summary) => {
    const customer: Customer = {
      id: summary.customerId,
      name: summary.customerName,
      mobile: summary.customerMobile,
      area: summary.customerArea,
      tier: summary.tier,
      previousOutstandingAmount: 0,
      advanceBalance: 0,
      paymentTerms: summary.creditPolicyLabel,
      notes: '',
      createdAt: summary.calculatedAt
    };
    const customerHistory = summary.customerId === selectedCustomerId ? giftHistory : [];
    const pendingApproval = customerHistory.find((gift) => gift.status === 'Approved');
    const alreadyGiftedAmount = customerHistory
      .filter((gift) => gift.status === 'Given')
      .reduce((sum, gift) => sum + gift.actualGiftAmount, 0);
    const giftBudget = Math.max(0, summary.giftBudget);
    const matchedGiftItems = giftItems
      .filter((item) => item.isActive && item.targetValue <= giftBudget)
      .sort((left, right) => right.targetValue - left.targetValue);
    const status = pendingApproval ? 'Approved' : matchedGiftItems.length > 0 ? 'Eligible' : 'Not Eligible';
    return {
      customer,
      salesAmount: summary.totalSales,
      profitConsidered: summary.totalProfit,
      giftBudget,
      alreadyGiftedAmount,
      pendingApproval,
      matchedGiftItems,
      suggestedGiftNames: matchedGiftItems.map((item) => item.giftItemName),
      status,
      eligibilityReason: pendingApproval
        ? 'A reward is approved and waiting to be given.'
        : matchedGiftItems.length > 0
          ? 'Available PC is enough for one or more active rewards.'
          : 'Available PC is below the active reward thresholds.'
    };
  }), [giftHistory, giftItems, selectedCustomerId, summaries]);

  const sortedSuggestedRows = useMemo(() => {
    return [...suggestedRows].sort((a, b) => b.giftBudget - a.giftBudget || a.customer.name.localeCompare(b.customer.name));
  }, [suggestedRows]);

  const searchedCustomerRows = useMemo(() => {
    const searchTerm = customerSearchText.trim().toLowerCase();
    if (!searchTerm) return sortedSuggestedRows;

    return sortedSuggestedRows.filter((row) =>
      [row.customer.name, row.customer.area].some((value) => value.toLowerCase().includes(searchTerm))
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
    await refreshSelectedGiftHistory();
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
    await refreshSelectedGiftHistory();
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
    await refreshSelectedGiftHistory();
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
    await refreshSelectedGiftHistory();
  };

  const cardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 16,
    padding: 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const inputStyle: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#11185A',
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
            : '#475569';

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
          <div style={{ fontWeight: 900, color: '#FFFFFF', alignSelf: 'end' }}>
            Eligible: {eligibleCount} | Pending Approval: {blockedCount}
          </div>
          <div style={{ color: '#D7DEEA', fontSize: 13, lineHeight: 1.5 }}>
            Available PC points are lifetime earned points plus bonuses, reduced only when rewards are redeemed.
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D7DEEA', fontSize: 12, marginBottom: 8 }}>
          Select a customer to view reward suggestions. Search filters the dropdown list.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Search Customer
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={customerSearchText}
              onChange={(event) => setCustomerSearchText(event.target.value)}
              placeholder="Name or area"
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
              style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A' }}
              onClick={() => {
                setSelectedCustomerId('');
                setCustomerSearchText('');
              }}
            >
              Clear
            </button>
            {hasMore ? (
              <button
                type="button"
                style={{ ...buttonStyle, background: '#FFFFFF', color: '#11185A' }}
                onClick={() => loadGiftData(true)}
              >
                Load more customers
              </button>
            ) : null}
          </div>
        </div>
        {customerSearchText && searchedCustomerRows.length === 0 ? (
          <div style={{ color: '#FCA5A5', fontWeight: 800, marginBottom: 12 }}>No customer matches your search.</div>
        ) : null}
        {loadingCustomer ? <div style={{ color: '#D7DEEA', marginBottom: 10 }}>Loading customer rewards...</div> : null}
        <div style={{ ...latestFiveScrollStyle, maxHeight: 520, paddingRight: 6 }}>
          {!selectedCustomerId ? (
            <div style={{ color: '#D7DEEA', border: '1px solid #E8EDF4', borderRadius: 14, padding: 16 }}>
              Choose a customer from the dropdown to show reward eligibility, available PC points, and approval actions.
            </div>
          ) : visibleSuggestedRows.length === 0 ? (
            <div style={{ color: '#D7DEEA' }}>No reward suggestion found for the selected customer.</div>
          ) : (
            visibleSuggestedRows.map((row) => {
              const selectedGiftName = getSelectedGiftName(row);
              const selectedRewardCost = getSelectedRewardCost(row);
              const displayStatus = getDisplayStatus(row);

              return (
                <div key={row.customer.id} style={{ border: '1px solid var(--role-card-border)', borderRadius: 14, padding: 16, marginBottom: 14, background: 'var(--role-card-background)', color: '#FFFFFF', overflow: 'hidden' }}>
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

                  <div style={{ color: '#D7DEEA', marginBottom: 10 }}>{row.eligibilityReason}</div>

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
                              color: '#11185A'
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
                            <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>
                              {difference === 0 ? 'Exact PC match' : `${formatMoney(difference)} PC below limit`}
                            </div>
                            {giftItem.notes ? <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>{giftItem.notes}</div> : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ color: '#D7DEEA', marginBottom: 14 }}>
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
                      <span style={{ color: '#D7DEEA', fontWeight: 800 }}>View only</span>
                    ) : row.pendingApproval ? (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          disabled={!hasChangedApprovedGift(row)}
                          style={{ ...buttonStyle, background: hasChangedApprovedGift(row) ? 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)' : '#E8EDF4', color: hasChangedApprovedGift(row) ? '#FFFFFF' : '#D7DEEA' }}
                          onClick={() => handleUpdateApprovedGift(row)}
                        >
                          Update Approved Reward
                        </button>
                        <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleRemoveApproval(row)}>
                          Remove Approval
                        </button>
                        <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A' }} onClick={() => handleMarkGiven(row)}>
                          Mark as Redeemed
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={row.status !== 'Eligible' || !selectedGiftName}
                        style={{ ...buttonStyle, background: row.status === 'Eligible' && selectedGiftName ? '#D4AF37' : '#E8EDF4', color: '#11185A' }}
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
        <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 12 }}>
          Available PC points do not expire. Redeemed rewards are deducted from the customer balance.
        </div>
      </div>
    </>
  );
};

export default SuggestedGiftManager;
