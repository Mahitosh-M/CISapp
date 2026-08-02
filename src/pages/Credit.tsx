import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Ban,
  Check,
  CircleDollarSign,
  Eye,
  PlayCircle,
  RefreshCw,
  Save,
  Settings2,
  X
} from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { getAppSettings } from '../services/firestoreService';
import {
  type CreditPageCursor,
  autoApproveCalculatedProfiles,
  getCreditProfilesPage,
  manageCustomerCredit,
  recalculateAllCustomerCredit,
  saveCreditPolicy
} from '../services/creditService';
import type { CustomerCreditProfile, CustomerTier } from '../types';
import { formatDate, formatMoney } from '../utils/formatters';

type CreditAction = 'approve' | 'reject' | 'manual_starter' | 'hold' | 'remove_hold' | 'override' | 'remove_override' | 'recalculate';

interface ActionDialog {
  profile: CustomerCreditProfile;
  action: CreditAction | 'breakdown';
}

const panelStyle: CSSProperties = {
  background: 'var(--role-card-background)',
  border: '1px solid var(--role-card-border)',
  borderRadius: 8,
  padding: 16,
  color: '#FFFFFF',
  boxShadow: '0 12px 28px rgba(11,31,58,0.12)'
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 40,
  padding: '9px 10px',
  border: '1px solid #D8DEE9',
  borderRadius: 6,
  color: '#11185A',
  background: '#FFFFFF'
};

const buttonStyle: CSSProperties = {
  minHeight: 36,
  border: 0,
  borderRadius: 6,
  padding: '8px 10px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontWeight: 850,
  cursor: 'pointer'
};

const Credit = () => {
  const [profiles, setProfiles] = useState<CustomerCreditProfile[]>([]);
  const [metrics, setMetrics] = useState({
    totalOutstanding: 0,
    totalAvailableCredit: 0
  });
  const [starterLimitCap, setStarterLimitCap] = useState(25000);
  const [overdueGraceDays, setOverdueGraceDays] = useState(3);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<'all' | CustomerTier>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [overdueFilter, setOverdueFilter] = useState('all');
  const [dialog, setDialog] = useState<ActionDialog>();
  const [actionAmount, setActionAmount] = useState(0);
  const [actionReason, setActionReason] = useState('');
  const [overrideExpiry, setOverrideExpiry] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsVisible, setRecordsVisible] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const loadAllProfiles = async () => {
    const rows: CustomerCreditProfile[] = [];
    let nextCursor: CreditPageCursor | undefined;
    let hasNextPage = true;
    while (hasNextPage) {
      const page = await getCreditProfilesPage(nextCursor);
      rows.push(...page.rows);
      nextCursor = page.cursor;
      hasNextPage = page.hasMore && Boolean(nextCursor);
    }
    return rows;
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');
      const settings = await getAppSettings();
      setStarterLimitCap(settings.creditPolicy.starterLimitCap);
      setOverdueGraceDays(settings.creditPolicy.overdueGraceDays);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer credit.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const loadRecords = async () => {
    try {
      setLoadingRecords(true);
      setError('');
      const rows = await autoApproveCalculatedProfiles(await loadAllProfiles());
      setProfiles(rows);
      setMetrics({
        totalOutstanding: rows.reduce((sum, profile) => sum + profile.currentOutstanding, 0),
        totalAvailableCredit: rows.reduce((sum, profile) => sum + profile.availableCredit, 0)
      });
      setRecordsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer credit records.');
    } finally {
      setLoadingRecords(false);
    }
  };

  const handleViewAll = async () => {
    if (recordsVisible) {
      setRecordsVisible(false);
      return;
    }
    setRecordsVisible(true);
    if (!recordsLoaded) await loadRecords();
  };

  const visibleProfiles = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (normalizedSearch && !profile.customerName.toLowerCase().includes(normalizedSearch)) return false;
      if (tierFilter !== 'all' && profile.tier !== tierFilter) return false;
      if (statusFilter !== 'all' && profile.creditStatus !== statusFilter) return false;
      if (overdueFilter === 'overdue' && !profile.hasOverdueBeyondGrace) return false;
      if (overdueFilter === 'clear' && profile.hasOverdueBeyondGrace) return false;
      return true;
    });
  }, [overdueFilter, profiles, search, statusFilter, tierFilter]);

  const openAction = (profile: CustomerCreditProfile, action: ActionDialog['action']) => {
    setDialog({ profile, action });
    setActionReason('');
    setOverrideExpiry('');
    setActionAmount(action === 'override' ? profile.approvedCreditLimit : profile.calculatedCreditLimit);
    setError('');
    setMessage('');
  };

  const submitAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!dialog || dialog.action === 'breakdown') return;

    try {
      setSaving(true);
      setError('');
      await manageCustomerCredit({
        customerId: dialog.profile.customerId,
        action: dialog.action,
        reason: actionReason,
        amount: ['approve', 'manual_starter', 'override'].includes(dialog.action) ? actionAmount : undefined,
        expiresAt: dialog.action === 'override' ? overrideExpiry : undefined,
        lookbackDays: 90
      });
      setDialog(undefined);
      setMessage('Customer credit updated.');
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update customer credit.');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePolicy = async () => {
    try {
      setSaving(true);
      setError('');
      await saveCreditPolicy(starterLimitCap, overdueGraceDays, 90);
      setMessage('Credit policy saved. Calculations use complete customer history.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save credit policy.');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkReview = async () => {
    try {
      setSaving(true);
      setError('');
      const result = await recalculateAllCustomerCredit(90);
      setMessage(`${result.count} customer credit profiles recalculated and automatically approved.`);
      if (recordsVisible) await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to recalculate customer credit.');
    } finally {
      setSaving(false);
    }
  };

  const metricCards = [
    { label: 'Current outstanding', value: formatMoney(metrics.totalOutstanding), icon: CircleDollarSign },
    { label: 'Available credit', value: formatMoney(metrics.totalAvailableCredit), icon: Check }
  ];

  if (loading) return <SectionHeader title="Credit" description="Loading customer credit controls..." />;

  return (
    <div className="credit-page">
      <SectionHeader title="Credit" description="Review customer credit eligibility, limits, exposure, and holds." />

      {error ? <div className="admin-alert admin-alert-error" role="alert">{error}</div> : null}
      {message ? <div className="admin-alert admin-alert-success" role="status">{message}</div> : null}

      {recordsVisible && !loadingRecords ? <div className="credit-metric-grid">
        {metricCards.map(({ label, value, icon: Icon }) => (
          <div key={label} style={panelStyle}>
            <Icon size={20} color="#D4AF37" />
            <div style={{ fontSize: 21, fontWeight: 900, marginTop: 10 }}>{value}</div>
            <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>{label}</div>
          </div>
        ))}
      </div> : null}

      <section style={{ ...panelStyle, marginTop: 16 }} aria-labelledby="credit-policy-title">
        <div className="credit-section-row">
          <div>
            <div id="credit-policy-title" style={{ fontWeight: 900, color: '#D4AF37' }}>Credit policy</div>
            <div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 4 }}>Applies to starter approvals and overdue holds.</div>
          </div>
          <div className="credit-policy-controls">
            <div>
              <span style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Calculation basis</span>
              <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', fontWeight: 850 }}>Complete customer history</div>
            </div>
            <label>
              <span>Starter cap</span>
              <input style={inputStyle} type="number" min="0" value={starterLimitCap} onChange={(event) => setStarterLimitCap(Number(event.target.value) || 0)} />
            </label>
            <label>
              <span>Grace days</span>
              <input style={inputStyle} type="number" min="0" step="1" value={overdueGraceDays} onChange={(event) => setOverdueGraceDays(Math.max(0, Math.trunc(Number(event.target.value) || 0)))} />
            </label>
            <button type="button" disabled={saving} onClick={handleSavePolicy} style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A', alignSelf: 'end' }}>
              <Save size={16} /> Save
            </button>
            <button type="button" disabled={saving} onClick={handleBulkReview} style={{ ...buttonStyle, background: '#FFFFFF', color: '#11185A', alignSelf: 'end' }}>
              <RefreshCw size={16} /> Recalculate and approve all
            </button>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 16 }} aria-labelledby="credit-table-title">
        <div className="credit-toolbar">
          <div id="credit-table-title" style={{ color: '#FFFFFF', fontWeight: 900 }}>Customer credit</div>
          <button
            type="button"
            disabled={loadingRecords}
            onClick={handleViewAll}
            style={{ ...buttonStyle, background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', color: '#FFFFFF' }}
          >
            {loadingRecords ? <RefreshCw size={16} /> : <Eye size={16} />}
            {loadingRecords ? 'Loading...' : recordsVisible ? 'Hide all' : 'View all'}
          </button>
          <input aria-label="Customer name" style={inputStyle} placeholder="Customer name" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label="Filter by tier" style={inputStyle} value={tierFilter} onChange={(event) => setTierFilter(event.target.value as 'all' | CustomerTier)}>
            <option value="all">All tiers</option>
            {['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4'].map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>
          <select aria-label="Filter by credit status" style={inputStyle} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="starter">Starter</option>
            <option value="active">Active</option>
            <option value="hold">Hold</option>
            <option value="disabled">Disabled</option>
          </select>
          <select aria-label="Filter by overdue status" style={inputStyle} value={overdueFilter} onChange={(event) => setOverdueFilter(event.target.value)}>
            <option value="all">All overdue</option>
            <option value="overdue">Overdue only</option>
            <option value="clear">No overdue</option>
          </select>
        </div>

        {recordsVisible && !loadingRecords ? <div className="credit-table-wrap">
          <table className="credit-table">
            <thead>
              <tr>
                {['Customer', 'Tier', 'Days', 'Outstanding', 'Calculated', 'Approved', 'Available', 'On time', 'Invoices', 'Overdue', 'Status', 'Last review', 'Actions'].map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleProfiles.length === 0 ? (
                <tr><td colSpan={13}>No customer credit profiles match these filters.</td></tr>
              ) : visibleProfiles.map((profile) => (
                <tr key={profile.id}>
                  <td><strong>{profile.customerName}</strong><div className="credit-subtext">{profile.creditLimitApprovalStatus.replace(/_/g, ' ')}</div></td>
                  <td>{profile.tier}</td>
                  <td>{profile.creditDays}</td>
                  <td>{formatMoney(profile.currentOutstanding)}</td>
                  <td>{formatMoney(profile.calculatedCreditLimit)}</td>
                  <td>{formatMoney(profile.approvedCreditLimit)}</td>
                  <td style={{ color: '#86EFAC', fontWeight: 900 }}>{formatMoney(profile.availableCredit)}</td>
                  <td>{profile.onTimePaymentPercentage.toFixed(1)}%</td>
                  <td>{profile.completedCreditInvoices}</td>
                  <td style={{ color: profile.overdueAmount > 0 ? '#FCA5A5' : 'inherit' }}>{formatMoney(profile.overdueAmount)}</td>
                  <td><span className={`credit-status credit-status-${profile.creditStatus}`}>{profile.creditStatus}</span></td>
                  <td>{formatDate(profile.lastCreditReviewAt)}</td>
                  <td>
                    <div className="credit-actions">
                      <button title="View calculation breakdown" type="button" onClick={() => openAction(profile, 'breakdown')}><Eye size={16} /></button>
                      <button title="Recalculate" type="button" onClick={() => openAction(profile, 'recalculate')}><RefreshCw size={16} /></button>
                      <button title={profile.creditStatus === 'hold' ? 'Remove manual hold' : 'Place hold'} type="button" onClick={() => openAction(profile, profile.creditStatus === 'hold' ? 'remove_hold' : 'hold')}>
                        {profile.creditStatus === 'hold' ? <PlayCircle size={16} /> : <Ban size={16} />}
                      </button>
                      <button title={profile.creditOverride ? 'Remove override' : 'Set override'} type="button" onClick={() => openAction(profile, profile.creditOverride ? 'remove_override' : 'override')}><Settings2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : null}

      </section>

      {dialog ? (
        <div className="credit-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDialog(undefined)}>
          <div className="credit-modal" role="dialog" aria-modal="true" aria-labelledby="credit-dialog-title">
            <div className="credit-section-row">
              <div>
                <div id="credit-dialog-title" style={{ fontWeight: 900, fontSize: 18 }}>{dialog.profile.customerName}</div>
                <div style={{ color: '#67738E', fontSize: 12, marginTop: 3 }}>{dialog.action.replace(/_/g, ' ')}</div>
              </div>
              <button type="button" title="Close" onClick={() => setDialog(undefined)} className="credit-icon-button"><X size={18} /></button>
            </div>

            {dialog.action === 'breakdown' ? (
              <div className="credit-breakdown">
                <div><span>Lifetime completed credit sales</span><strong>{formatMoney(dialog.profile.totalCreditInvoiceAmountInLookback)}</strong></div>
                <div><span>Average monthly credit sales</span><strong>{formatMoney(dialog.profile.averageMonthlyCreditSales)}</strong></div>
                <div><span>Base credit limit</span><strong>{formatMoney(dialog.profile.baseCreditLimit)}</strong></div>
                <div><span>Payment factor</span><strong>{dialog.profile.paymentFactor.toFixed(2)}</strong></div>
                <div><span>History factor</span><strong>{dialog.profile.historyFactor.toFixed(2)}</strong></div>
                <div><span>Completed credit invoices</span><strong>{dialog.profile.completedCreditInvoices}</strong></div>
                <div><span>Current outstanding</span><strong>{formatMoney(dialog.profile.currentOutstanding)}</strong></div>
                <div><span>Confirmed uninvoiced orders</span><strong>{formatMoney(dialog.profile.confirmedUninvoicedCreditOrders)}</strong></div>
                {dialog.profile.creditOverride ? <div><span>Override until {formatDate(dialog.profile.creditOverride.expiresAt)}</span><strong>{formatMoney(dialog.profile.creditOverride.amount)}</strong></div> : null}
              </div>
            ) : (
              <form onSubmit={submitAction} style={{ display: 'grid', gap: 12, marginTop: 18 }}>
                {['approve', 'manual_starter', 'override'].includes(dialog.action) ? (
                  <label>Amount<input required style={inputStyle} type="number" min="0" step="0.01" value={actionAmount} onChange={(event) => setActionAmount(Number(event.target.value) || 0)} /></label>
                ) : null}
                {dialog.action === 'override' ? (
                  <label>Expiry date<input required style={inputStyle} type="date" min={new Date().toISOString().slice(0, 10)} value={overrideExpiry} onChange={(event) => setOverrideExpiry(event.target.value)} /></label>
                ) : null}
                {dialog.action !== 'recalculate' ? (
                  <label>Reason (optional)<textarea style={{ ...inputStyle, minHeight: 88, resize: 'vertical' }} maxLength={500} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label>
                ) : null}
                <button disabled={saving} type="submit" style={{ ...buttonStyle, background: '#11185A', color: '#FFFFFF' }}>
                  {saving ? <RefreshCw size={16} /> : <Check size={16} />} Confirm
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Credit;
