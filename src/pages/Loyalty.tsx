import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import { useAuth } from '../contexts/AuthContext';
import {
  createRewardItem,
  deleteRewardItemRecord,
  getAppSettings,
  getMonthlyCustomerStatsForMonth,
  getRedemptionRequests,
  getRewardItems,
  rebuildMonthlyCustomerStats,
  reviewRedemptionRequest,
  updateAppSettings,
  updateRewardItemRecord
} from '../services/firestoreService';
import type { AppSettings, MonthlyCustomerStats, PartnerLevel, RedemptionRequest, RewardFormData, RewardItem } from '../types';
import { formatDate, formatMoney } from '../utils/formatters';
import { getCurrentMonthKey, PARTNER_LEVELS } from '../utils/loyalty';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { DEFAULT_SETTINGS, mergeWithDefaultSettings, validateAppSettings } from '../utils/settings';

const emptyRewardForm: RewardFormData = {
  name: '',
  requiredPoints: 0,
  levelRequired: 'Active Partner',
  isActive: true,
  description: ''
};

const Loyalty = () => {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'Admin';
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<MonthlyCustomerStats[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [requests, setRequests] = useState<RedemptionRequest[]>([]);
  const [rewardForm, setRewardForm] = useState<RewardFormData>(emptyRewardForm);
  const [editingRewardId, setEditingRewardId] = useState('');
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [appSettings, statsRows, rewardRows, requestRows] = await Promise.all([
        getAppSettings(),
        getMonthlyCustomerStatsForMonth(month),
        getRewardItems(),
        getRedemptionRequests()
      ]);
      setSettings(mergeWithDefaultSettings(appSettings));
      setStats(statsRows);
      setRewards(rewardRows);
      setRequests(requestRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load loyalty data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [month]);

  const sortedRewards = useMemo(() => sortNewestFirst(rewards, ['updatedAt', 'createdAt']), [rewards]);
  const sortedRequests = useMemo(() => sortNewestFirst(requests, ['requestedAt']), [requests]);
  const pendingRequests = requests.filter((request) => request.status === 'Pending');

  const updateLoyaltyNumber = (field: keyof AppSettings['loyaltySettings'], value: string) => {
    if (field === 'partnerLevelThresholds') return;
    setSettings((current) => ({
      ...current,
      loyaltySettings: {
        ...current.loyaltySettings,
        [field]: Number(value) || 0
      }
    }));
  };

  const updateThreshold = (level: PartnerLevel, value: string) => {
    setSettings((current) => ({
      ...current,
      loyaltySettings: {
        ...current.loyaltySettings,
        partnerLevelThresholds: {
          ...current.loyaltySettings.partnerLevelThresholds,
          [level]: Number(value) || 0
        }
      }
    }));
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;

    const validation = validateAppSettings(settings);
    if (!validation.isValid) {
      setError(validation.errors.join(' '));
      return;
    }

    try {
      setSaving(true);
      setError('');
      await updateAppSettings(settings, auditUser);
      setMessage('Loyalty settings saved.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save loyalty settings.');
    } finally {
      setSaving(false);
    }
  };

  const rebuildStats = async () => {
    if (!isAdmin) return;

    try {
      setSaving(true);
      setError('');
      await rebuildMonthlyCustomerStats(month, auditUser);
      setMessage('Monthly loyalty summaries refreshed.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rebuild loyalty summaries.');
    } finally {
      setSaving(false);
    }
  };

  const saveReward = async () => {
    if (!isAdmin) return;
    if (!rewardForm.name.trim()) {
      setError('Reward name is required.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      if (editingRewardId) {
        await updateRewardItemRecord(editingRewardId, rewardForm, auditUser);
        setMessage('Reward updated.');
      } else {
        await createRewardItem(rewardForm, auditUser);
        setMessage('Reward added.');
      }
      setRewardForm(emptyRewardForm);
      setEditingRewardId('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save reward.');
    } finally {
      setSaving(false);
    }
  };

  const editReward = (reward: RewardItem) => {
    setEditingRewardId(reward.id);
    setRewardForm({
      name: reward.name,
      requiredPoints: reward.requiredPoints,
      levelRequired: reward.levelRequired,
      isActive: reward.isActive,
      description: reward.description || ''
    });
  };

  const deleteReward = async (reward: RewardItem) => {
    if (!isAdmin) return;
    const confirmed = window.confirm(`Delete reward ${reward.name}?`);
    if (!confirmed) return;
    await deleteRewardItemRecord(reward.id, auditUser);
    setMessage('Reward deleted.');
    await loadData();
  };

  const reviewRequest = async (request: RedemptionRequest, status: 'Approved' | 'Rejected') => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setError('');
      await reviewRedemptionRequest(request.id, status, auditUser);
      setMessage(`Redemption ${status.toLowerCase()}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review redemption.');
    } finally {
      setSaving(false);
    }
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 14
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    marginTop: 6
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
    minWidth: 820,
    borderCollapse: 'collapse'
  };

  const thStyle: CSSProperties = {
    textAlign: 'left',
    padding: 12,
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4'
  };

  const tdStyle: CSSProperties = {
    padding: 12,
    borderBottom: '1px solid #E8EDF4'
  };

  if (loading) {
    return <SectionHeader title="Ashoka Partner Program" description="Loading loyalty module..." />;
  }

  return (
    <div>
      <SectionHeader title="Ashoka Partner Program" description="Manage APC points, partner levels, rewards, and redemption approvals." />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18, marginBottom: 24 }}>
        <StatCard title="Customers Cached" value={`${stats.length}`} subtitle={month} />
        <StatCard title="Active Rewards" value={`${rewards.filter((reward) => reward.isActive).length}`} subtitle="Visible to eligible customers" />
        <StatCard title="Pending Requests" value={`${pendingRequests.length}`} subtitle="Waiting for Admin review" color="#B7791F" />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 14 }}>
          <label style={{ fontWeight: 800 }}>
            Loyalty Month
            <input style={inputStyle} type="month" value={month} onChange={(event) => setMonth(event.target.value || getCurrentMonthKey())} />
          </label>
          {isAdmin ? (
            <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF' }} onClick={rebuildStats}>
              Refresh Monthly Stats
            </button>
          ) : null}
        </div>
        <div style={{ color: '#67738E', fontSize: 12 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto', marginTop: 8 }}>
          <table style={tableStyle}>
            <thead>
              <tr>{['Customer', 'Level', 'APC Points', 'Target', 'Sales', 'Orders', 'Overdue', 'Progress'].map((header) => <th key={header} style={thStyle}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr><td style={tdStyle} colSpan={8}>No monthly loyalty summaries yet. Admin can refresh stats for this month.</td></tr>
              ) : (
                stats.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{row.customerId}</td>
                    <td style={tdStyle}>{row.currentLevel}</td>
                    <td style={tdStyle}>{row.pointsEarned}</td>
                    <td style={tdStyle}>{formatMoney(row.target)}</td>
                    <td style={tdStyle}>{formatMoney(row.totalSales)}</td>
                    <td style={tdStyle}>{row.orderCount}</td>
                    <td style={{ ...tdStyle, color: row.overdueAmount > 0 ? '#B42318' : '#166534', fontWeight: 800 }}>{formatMoney(row.overdueAmount)}</td>
                    <td style={tdStyle}>{row.progressPercent}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin ? (
        <form style={cardStyle} onSubmit={saveSettings}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Loyalty Settings</div>
          <div style={gridStyle}>
            <label style={{ fontWeight: 800 }}>Points per Rs. 1,000 purchase<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.pointsPerThousand} onChange={(event) => updateLoyaltyNumber('pointsPerThousand', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>On-time payment bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.onTimePaymentBonus} onChange={(event) => updateLoyaltyNumber('onTimePaymentBonus', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>Monthly target bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.monthlyTargetBonus} onChange={(event) => updateLoyaltyNumber('monthlyTargetBonus', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>Order frequency bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.orderFrequencyBonus} onChange={(event) => updateLoyaltyNumber('orderFrequencyBonus', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>Reward budget cap<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.rewardBudgetCap} onChange={(event) => updateLoyaltyNumber('rewardBudgetCap', event.target.value)} /></label>
          </div>
          <div style={{ color: '#D4AF37', fontWeight: 900, margin: '18px 0 12px' }}>Partner Level Thresholds</div>
          <div style={gridStyle}>
            {PARTNER_LEVELS.map((level) => (
              <label key={level} style={{ fontWeight: 800 }}>
                {level}
                <input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.partnerLevelThresholds[level]} onChange={(event) => updateThreshold(level, event.target.value)} />
              </label>
            ))}
          </div>
          <button type="submit" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A', marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save Loyalty Settings'}
          </button>
        </form>
      ) : null}

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Reward Catalogue</div>
        {isAdmin ? (
          <>
            <div style={gridStyle}>
              <label style={{ fontWeight: 800 }}>Reward Name<input style={inputStyle} value={rewardForm.name} onChange={(event) => setRewardForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label style={{ fontWeight: 800 }}>Required Points<input style={inputStyle} type="number" min="0" value={rewardForm.requiredPoints} onChange={(event) => setRewardForm((current) => ({ ...current, requiredPoints: Number(event.target.value) || 0 }))} /></label>
              <label style={{ fontWeight: 800 }}>Level Required<select style={inputStyle} value={rewardForm.levelRequired} onChange={(event) => setRewardForm((current) => ({ ...current, levelRequired: event.target.value as PartnerLevel }))}>{PARTNER_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
              <label style={{ fontWeight: 800 }}>Status<select style={inputStyle} value={rewardForm.isActive ? 'active' : 'inactive'} onChange={(event) => setRewardForm((current) => ({ ...current, isActive: event.target.value === 'active' }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label style={{ fontWeight: 800 }}>Description<input style={inputStyle} value={rewardForm.description} onChange={(event) => setRewardForm((current) => ({ ...current, description: event.target.value }))} /></label>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, marginBottom: 16 }}>
              <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={saveReward}>{editingRewardId ? 'Update Reward' : 'Add Reward'}</button>
              {editingRewardId ? <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={() => { setEditingRewardId(''); setRewardForm(emptyRewardForm); }}>Cancel</button> : null}
            </div>
          </>
        ) : null}
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead><tr>{['Reward', 'Points', 'Level', 'Status', 'Description', 'Actions'].map((header) => <th key={header} style={thStyle}>{header}</th>)}</tr></thead>
            <tbody>
              {sortedRewards.map((reward) => (
                <tr key={reward.id}>
                  <td style={tdStyle}>{reward.name}</td>
                  <td style={tdStyle}>{reward.requiredPoints}</td>
                  <td style={tdStyle}>{reward.levelRequired}</td>
                  <td style={tdStyle}>{reward.isActive ? 'Active' : 'Inactive'}</td>
                  <td style={tdStyle}>{reward.description || '-'}</td>
                  <td style={tdStyle}>
                    {isAdmin ? (
                      <>
                        <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginRight: 8 }} onClick={() => editReward(reward)}>Edit</button>
                        <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => deleteReward(reward)}>Delete</button>
                      </>
                    ) : 'View only'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Redemption Requests</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead><tr>{['Customer', 'Reward', 'Points', 'Status', 'Requested', 'Reviewed By', 'Actions'].map((header) => <th key={header} style={thStyle}>{header}</th>)}</tr></thead>
            <tbody>
              {sortedRequests.length === 0 ? (
                <tr><td style={tdStyle} colSpan={7}>No redemption requests yet.</td></tr>
              ) : sortedRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>{request.rewardName}</td>
                  <td style={tdStyle}>{request.points}</td>
                  <td style={tdStyle}>{request.status}</td>
                  <td style={tdStyle}>{request.requestedAt ? formatDate(request.requestedAt.slice(0, 10)) : '-'}</td>
                  <td style={tdStyle}>{request.reviewedBy || '-'}</td>
                  <td style={tdStyle}>
                    {isAdmin && request.status === 'Pending' ? (
                      <>
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF', marginRight: 8 }} onClick={() => reviewRequest(request, 'Approved')}>Approve</button>
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => reviewRequest(request, 'Rejected')}>Reject</button>
                      </>
                    ) : 'No action'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Loyalty;
