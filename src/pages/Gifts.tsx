import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  createGiftItem,
  deleteGiftHistoryRecord,
  deleteGiftItemRecord,
  getGiftHistory,
  getGiftItems,
  updateGiftItemRecord
} from '../services/firestoreService';
import type { GiftHistory, GiftItem, GiftItemFormData } from '../types';
import { formatDate, formatDateRange, formatMoney } from '../utils/formatters';
import { getGiftPeriodLabel } from '../utils/giftUtils';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';

const emptyGiftItemForm: GiftItemFormData = {
  giftItemName: '',
  targetValue: 0,
  notes: '',
  isActive: true
};

const Gifts = () => {
  const { loading, error } = useErpData();
  const { userProfile } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [giftItemForm, setGiftItemForm] = useState<GiftItemFormData>(emptyGiftItemForm);
  const [editingGiftItemId, setEditingGiftItemId] = useState('');
  const [savingGiftItem, setSavingGiftItem] = useState(false);
  const [giftError, setGiftError] = useState('');
  const [message, setMessage] = useState('');
  const isMobile = useIsMobile();

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

  const sortedGiftItems = useMemo(() => sortNewestFirst(giftItems, ['updatedAt', 'createdAt']), [giftItems]);
  const sortedGiftHistory = useMemo(() => sortNewestFirst(giftHistory, ['giftGivenDate', 'giftedDate', 'updatedAt', 'createdAt']), [giftHistory]);

  const totals = useMemo(() => {
    return {
      activeItems: giftItems.filter((giftItem) => giftItem.isActive).length,
      inactiveItems: giftItems.filter((giftItem) => !giftItem.isActive).length,
      historyCount: giftHistory.length,
      pending: giftHistory.filter((gift) => gift.status === 'Approved').length,
      gifted: giftHistory.reduce((sum, gift) => sum + gift.giftAmount, 0)
    };
  }, [giftHistory, giftItems]);

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

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 12,
    padding: isMobile ? 14 : 20,
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
    minWidth: isMobile ? 720 : 980,
    borderCollapse: 'collapse'
  };

  const headerCellStyle: CSSProperties = {
    padding: isMobile ? '9px 10px' : '12px 14px',
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4',
    textAlign: 'left',
    fontWeight: 900
  };

  const cellStyle: CSSProperties = {
    padding: isMobile ? '9px 10px' : '12px 14px',
    borderBottom: '1px solid #E8EDF4'
  };

  if (loading) {
    return <SectionHeader title="Gift Budget" description="Loading gift eligibility..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Gifts"
        description="Manage gift item rules and review gift history. Gift approval and selection are handled in Suggested Gifts."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {giftError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{giftError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18, marginBottom: 24 }}>
        <StatCard title="Active Gift Items" value={`${totals.activeItems}`} subtitle="Available for suggestions" />
        <StatCard title="Inactive Gift Items" value={`${totals.inactiveItems}`} subtitle="Saved but hidden" />
        <StatCard title="Gift Records" value={`${totals.historyCount}`} subtitle="Approved and gifted" />
        <StatCard title="Pending Gifts" value={`${totals.pending}`} subtitle="Approve flow in Suggested Gifts" />
        <StatCard title="Total Gifted" value={formatMoney(totals.gifted)} subtitle="All gift history" />
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
                    <td style={cellStyle}>{getGiftPeriodLabel(gift.periodType)}: {formatDateRange(gift.periodStart, gift.periodEnd)}</td>
                    <td style={cellStyle}>{formatMoney(gift.profitConsidered)}</td>
                    <td style={cellStyle}>{formatMoney(gift.suggestedGiftBudget)}</td>
                    <td style={cellStyle}>{formatMoney(gift.actualGiftAmount)}</td>
                    <td style={cellStyle}>{gift.selectedGiftItemName || gift.giftItem || '-'}</td>
                    <td style={cellStyle}>{gift.giftGivenDate ? formatDate(gift.giftGivenDate) : '-'}</td>
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
