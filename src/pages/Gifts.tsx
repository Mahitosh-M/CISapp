import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import {
  createGiftHistoryRecord,
  createGiftItem,
  deleteGiftHistoryRecord,
  deleteGiftItemRecord,
  getGiftHistory,
  getGiftItems,
  updateGiftHistoryRecord,
  updateGiftItemRecord
} from '../services/firestoreService';
import type { GiftHistory, GiftItem, GiftItemFormData, GiftPeriod } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { buildGiftEligibilityRows, getGiftPeriodLabel, getGiftPeriodStart, getMonthEndDateString } from '../utils/giftUtils';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';

const emptyGiftItemForm: GiftItemFormData = {
  giftItemName: '',
  targetValue: 0,
  notes: '',
  isActive: true
};

const Gifts = () => {
  const { customers, invoices, settings, loading, error } = useErpData();
  const { userProfile } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [giftItemForm, setGiftItemForm] = useState<GiftItemFormData>(emptyGiftItemForm);
  const [editingGiftItemId, setEditingGiftItemId] = useState('');
  const [savingGiftItem, setSavingGiftItem] = useState(false);
  const defaultPeriodEnd = getMonthEndDateString(getTodayDateString());
  const [periodType, setPeriodType] = useState<GiftPeriod>('1_month');
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [customPeriodStart, setCustomPeriodStart] = useState(getGiftPeriodStart('1_month', defaultPeriodEnd));
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
      setGiftError(err instanceof Error ? err.message : 'Unable to load gift data.');
    }
  };

  useEffect(() => {
    loadGiftData();
  }, []);

  const giftRows = useMemo(() => {
    return buildGiftEligibilityRows(customers, invoices, giftHistory, settings, periodType, periodStart, periodEnd);
  }, [customers, giftHistory, invoices, periodEnd, periodStart, periodType, settings]);
  const sortedGiftItems = useMemo(() => sortNewestFirst(giftItems, ['updatedAt', 'createdAt']), [giftItems]);
  const sortedGiftRows = useMemo(() => {
    return sortNewestFirst(
      giftRows.map((row) => ({ ...row, updatedAt: row.customer.updatedAt, createdAt: row.customer.createdAt })),
      ['updatedAt', 'createdAt']
    );
  }, [giftRows]);
  const sortedGiftHistory = useMemo(() => sortNewestFirst(giftHistory, ['giftGivenDate', 'giftedDate', 'updatedAt', 'createdAt']), [giftHistory]);

  const getActionGiftBudget = (row: (typeof giftRows)[number]) => {
    return row.pendingApproval?.giftBudget ?? row.pendingApproval?.suggestedGiftBudget ?? row.remainingEligibility;
  };

  const totals = useMemo(() => {
    return {
      sales: giftRows.reduce((sum, row) => sum + row.salesAmount, 0),
      profit: giftRows.reduce((sum, row) => sum + row.profitConsidered, 0),
      budget: giftRows.reduce((sum, row) => sum + row.giftBudget, 0),
      gifted: giftHistory.reduce((sum, gift) => sum + gift.giftAmount, 0),
      remaining: giftRows.reduce((sum, row) => sum + row.remainingEligibility, 0)
    };
  }, [giftHistory, giftRows]);

  const buildGiftPayload = (row: (typeof giftRows)[number], status: 'Approved' | 'Given') => ({
    customerId: row.customer.id,
    customerName: row.customer.name,
    tier: row.customer.tier,
    tierAtGiftTime: row.customer.tier,
    periodType,
    periodStart,
    periodEnd,
    salesAmount: row.salesAmount,
    profitConsidered: row.profitConsidered,
    giftPercentage: row.giftPercentage,
    giftAmount: status === 'Given' ? getActionGiftBudget(row) : 0,
    suggestedGiftBudget: getActionGiftBudget(row),
    actualGiftAmount: status === 'Given' ? getActionGiftBudget(row) : 0,
    giftItem: row.suggestedGiftItem,
    giftBudget: getActionGiftBudget(row),
    giftedDate: status === 'Given' ? getTodayDateString() : '',
    giftGivenDate: status === 'Given' ? getTodayDateString() : '',
    giftedBy: status === 'Given' ? userProfile?.email || 'Admin' : '',
    approvedBy: userProfile?.email || 'Admin',
    status,
    notes: notesByCustomer[row.customer.id] || ''
  });

  const handleApproveGift = async (row: (typeof giftRows)[number]) => {
    if (row.isDuplicatePeriod) {
      setGiftError('This customer already has a gift history record overlapping the selected period.');
      return;
    }

    if (row.remainingEligibility <= 0) {
      setGiftError('Gift budget is zero for this customer and period.');
      return;
    }

    const confirmed = window.confirm(`Approve ${formatMoney(row.remainingEligibility)} gift budget for ${row.customer.name}?`);
    if (!confirmed) return;

    await createGiftHistoryRecord(buildGiftPayload(row, 'Approved'), auditUser);

    setMessage('Gift approved successfully.');
    await loadGiftData();
  };

  const handleMarkGifted = async (row: (typeof giftRows)[number]) => {
    if (!row.pendingApproval) {
      setGiftError('Admin approval is required before marking a gift as given.');
      return;
    }

    const confirmed = window.confirm(`Mark approved gift ${formatMoney(getActionGiftBudget(row))} as given to ${row.customer.name}?`);
    if (!confirmed) return;

    await updateGiftHistoryRecord(row.pendingApproval.id, buildGiftPayload(row, 'Given'), auditUser);
    setMessage('Gift marked as given.');
    await loadGiftData();
  };

  const handleDeleteGift = async (gift: GiftHistory) => {
    const confirmed = window.confirm(`Delete gift record for ${gift.customerName}?`);
    if (!confirmed) return;
    await deleteGiftHistoryRecord(gift.id, auditUser);
    setMessage('Gift history record deleted.');
    await loadGiftData();
  };

  const handleGiftItemNumberChange = (value: string) => {
    setGiftItemForm((current) => ({
      ...current,
      targetValue: value.trim() === '' ? 0 : Number(value)
    }));
  };

  const resetGiftItemForm = () => {
    setGiftItemForm({ ...emptyGiftItemForm });
    setEditingGiftItemId('');
  };

  const handleSaveGiftItem = async () => {
    if (userProfile?.role !== 'Admin') {
      setGiftError('Only Admin users can manage gift item rules.');
      return;
    }

    if (!giftItemForm.giftItemName.trim()) {
      setGiftError('Gift item name is required.');
      return;
    }

    if (
      !Number.isFinite(giftItemForm.targetValue) ||
      giftItemForm.targetValue < 0
    ) {
      setGiftError('Gift item target value must be a valid non-negative number.');
      return;
    }

    try {
      setSavingGiftItem(true);
      setGiftError('');

      // Admin-only rule: targetValue is the customer gift budget threshold used on Suggested Gifts.
      if (editingGiftItemId) {
        await updateGiftItemRecord(editingGiftItemId, giftItemForm, auditUser);
        setMessage('Gift item updated successfully.');
      } else {
        await createGiftItem(giftItemForm, auditUser);
        setMessage('Gift item added successfully.');
      }

      resetGiftItemForm();
      await loadGiftData();
    } catch (err) {
      setGiftError(err instanceof Error ? err.message : 'Unable to save gift item.');
    } finally {
      setSavingGiftItem(false);
    }
  };

  const handleEditGiftItem = (giftItem: GiftItem) => {
    setEditingGiftItemId(giftItem.id);
    setGiftItemForm({
      giftItemName: giftItem.giftItemName,
      targetValue: giftItem.targetValue,
      notes: giftItem.notes,
      isActive: giftItem.isActive
    });
  };

  const handleToggleGiftItem = async (giftItem: GiftItem) => {
    await updateGiftItemRecord(giftItem.id, { ...giftItem, isActive: !giftItem.isActive }, auditUser);
    setMessage(giftItem.isActive ? 'Gift item deactivated.' : 'Gift item activated.');
    await loadGiftData();
  };

  const handleDeleteGiftItem = async (giftItem: GiftItem) => {
    const confirmed = window.confirm(`Delete gift item ${giftItem.giftItemName}?`);
    if (!confirmed) return;

    await deleteGiftItemRecord(giftItem.id, auditUser);
    setMessage('Gift item deleted.');
    await loadGiftData();
  };

  const handlePeriodEndChange = (value: string) => {
    const normalizedMonthEnd = getMonthEndDateString(value);
    const minimumPeriodStart = getGiftPeriodStart('1_month', normalizedMonthEnd);
    setPeriodEnd(normalizedMonthEnd);
    setCustomPeriodStart((current) => (current > minimumPeriodStart ? minimumPeriodStart : current));
  };

  const handleCustomPeriodStartChange = (value: string) => {
    const minimumPeriodStart = getGiftPeriodStart('1_month', periodEnd);
    // Custom gift ranges cannot be shorter than one full month.
    setCustomPeriodStart(value > minimumPeriodStart ? minimumPeriodStart : value);
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
        <StatCard title="Period Profit" value={formatMoney(totals.profit)} subtitle="Used for gift budget" />
        <StatCard title="Gift Budget" value={formatMoney(totals.budget)} subtitle="Profit x tier gift %" />
        <StatCard title="Total Gifted" value={formatMoney(totals.gifted)} subtitle="All gift history" />
        <StatCard title="Remaining Eligibility" value={formatMoney(totals.remaining)} subtitle="Current period" />
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Admin Gift Item Settings</div>
        <div style={{ color: '#67738E', marginBottom: 14 }}>
          Gift item targets are admin-managed rules. Target Value means the customer gift budget needed before this item can be suggested.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Gift Item Name
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={giftItemForm.giftItemName}
              onChange={(event) => setGiftItemForm((current) => ({ ...current, giftItemName: event.target.value }))}
            />
          </label>
          <label style={{ fontWeight: 800 }}>
            Target Value
            <input style={{ ...inputStyle, marginTop: 6 }} type="number" min={0} value={giftItemForm.targetValue} onChange={(event) => handleGiftItemNumberChange(event.target.value)} />
          </label>
          <label style={{ fontWeight: 800 }}>
            Active / Inactive
            <select
              style={{ ...inputStyle, marginTop: 6 }}
              value={giftItemForm.isActive ? 'active' : 'inactive'}
              onChange={(event) => setGiftItemForm((current) => ({ ...current, isActive: event.target.value === 'active' }))}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label style={{ fontWeight: 800 }}>
            Notes
            <input
              style={{ ...inputStyle, marginTop: 6 }}
              value={giftItemForm.notes}
              onChange={(event) => setGiftItemForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={handleSaveGiftItem} disabled={savingGiftItem}>
            {savingGiftItem ? 'Saving...' : editingGiftItemId ? 'Update Gift Item' : 'Add Gift Item'}
          </button>
          {editingGiftItemId ? (
            <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetGiftItemForm}>
              Cancel
            </button>
          ) : null}
        </div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={{ ...tableStyle, minWidth: 820 }}>
            <thead>
              <tr>
                {['Gift Item', 'Target Value', 'Status', 'Notes', 'Actions'].map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedGiftItems.length === 0 ? (
                <tr><td style={cellStyle} colSpan={5}>No gift items added yet.</td></tr>
              ) : (
                sortedGiftItems.map((giftItem) => (
                  <tr key={giftItem.id}>
                    <td style={cellStyle}><strong>{giftItem.giftItemName}</strong></td>
                    <td style={cellStyle}>{formatMoney(giftItem.targetValue)}</td>
                    <td style={{ ...cellStyle, color: giftItem.isActive ? '#1B7F3A' : '#B42318', fontWeight: 900 }}>{giftItem.isActive ? 'Active' : 'Inactive'}</td>
                    <td style={cellStyle}>{giftItem.notes || '-'}</td>
                    <td style={cellStyle}>
                      <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginRight: 8 }} onClick={() => handleEditGiftItem(giftItem)}>
                        Edit
                      </button>
                      <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginRight: 8 }} onClick={() => handleToggleGiftItem(giftItem)}>
                        {giftItem.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDeleteGiftItem(giftItem)}>
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
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Gift Eligibility</div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>
          Period end is normalized to month-end. Already gifted overlapping periods are deducted from Remaining.
        </div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Tier', 'Profit', 'Gift %', 'Budget', 'Suggested Item', 'Already Gifted', 'Remaining', 'Notes', 'Action'].map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedGiftRows.map((row) => (
                <tr key={row.customer.id}>
                  <td style={cellStyle}><strong>{row.customer.name}</strong></td>
                  <td style={cellStyle}><TierBadge tier={row.customer.tier} /></td>
                  <td style={cellStyle}>{formatMoney(row.profitConsidered)}</td>
                  <td style={cellStyle}>{row.giftPercentage}%</td>
                  <td style={cellStyle}>{formatMoney(row.giftBudget)}</td>
                  <td style={cellStyle}>{row.suggestedGiftItem}</td>
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
                    {row.pendingApproval ? (
                      <button
                        type="button"
                        style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}
                        onClick={() => handleMarkGifted(row)}
                      >
                        Mark Gifted
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={row.isDuplicatePeriod || row.remainingEligibility <= 0}
                        style={{ ...buttonStyle, background: row.isDuplicatePeriod ? '#E8EDF4' : '#D4AF37', color: '#0B1F3A' }}
                        onClick={() => handleApproveGift(row)}
                      >
                        {row.isDuplicatePeriod ? 'Already Gifted' : 'Approve'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Gift History</div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Tier', 'Status', 'Period', 'Profit', 'Suggested', 'Actual Gift', 'Gift Item', 'Given Date', 'Approved By', 'Notes', 'Action'].map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedGiftHistory.length === 0 ? (
                <tr><td style={cellStyle} colSpan={12}>No gift history yet.</td></tr>
              ) : (
                sortedGiftHistory.map((gift) => (
                  <tr key={gift.id}>
                    <td style={cellStyle}>{gift.customerName}</td>
                    <td style={cellStyle}><TierBadge tier={gift.tierAtGiftTime} /></td>
                    <td style={cellStyle}>{gift.status}</td>
                    <td style={cellStyle}>{getGiftPeriodLabel(gift.periodType)}: {gift.periodStart} to {gift.periodEnd}</td>
                    <td style={cellStyle}>{formatMoney(gift.profitConsidered)}</td>
                    <td style={cellStyle}>{formatMoney(gift.suggestedGiftBudget)}</td>
                    <td style={cellStyle}>{formatMoney(gift.actualGiftAmount)}</td>
                    <td style={cellStyle}>{gift.selectedGiftItemName || gift.giftItem || '-'}</td>
                    <td style={cellStyle}>{gift.giftGivenDate || '-'}</td>
                    <td style={cellStyle}>{gift.approvedBy || '-'}</td>
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
