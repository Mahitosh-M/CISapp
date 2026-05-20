import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import {
  deleteUserProfileRecord,
  getAppSettings,
  getUserProfiles,
  updateAppSettings,
  updateUserProfileRecord
} from '../services/firestoreService';
import { createStaffAuthAccount } from '../services/authService';
import { useAuth } from '../contexts/AuthContext';
import type { AppSettings, TargetTierKey, UserProfile, UserRole } from '../types';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { DEFAULT_SETTINGS, isScoringWeightTotalValid, mergeWithDefaultSettings, validateAppSettings } from '../utils/settings';

const Settings = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>('Staff');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { userProfile } = useAuth();
  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError('');
      const [appSettings, userRows] = await Promise.all([getAppSettings(), getUserProfiles()]);
      setSettings(mergeWithDefaultSettings(appSettings));
      setUsers(userRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const settingsValidation = useMemo(() => validateAppSettings(settings), [settings]);
  const hasValidScoringTotal = isScoringWeightTotalValid(settingsValidation.scoringWeightTotal);
  const sortedUsers = useMemo(() => sortNewestFirst(users, ['updatedAt', 'createdAt']), [users]);

  const updateNestedNumber = (
    group: 'giftPercentages' | 'creditDays' | 'paymentBuffers' | 'scoringWeights',
    key: string,
    value: string
  ) => {
    setSettings((current) => ({
      ...current,
      [group]: {
        ...current[group],
        [key]: Number(value) || 0
      }
    }));
  };

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();

    // Business rule: scoring parts must add to 100%, otherwise weighted customer scores can exceed 100.
    if (!settingsValidation.isValid) {
      setMessage('');
      setError(`Please adjust settings before saving. ${settingsValidation.errors.join(' ')}`);
      return;
    }

    try {
      setSaving(true);
      setError('');
      await updateAppSettings(settings, auditUser);
      setMessage('Settings saved successfully. New invoices, intelligence, reports, gifts, and overdue alerts will use the updated rules.');
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateStaff = async (event: FormEvent) => {
    event.preventDefault();

    if (!staffEmail || !staffPassword || !staffName) {
      setError('Name, email, and password are required for staff creation.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await createStaffAuthAccount(staffEmail, staffPassword, staffName, staffRole);
      setStaffEmail('');
      setStaffPassword('');
      setStaffName('');
      setStaffRole('Staff');
      setMessage('User account created successfully.');
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create user account.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (user: UserProfile, role: UserRole) => {
    await updateUserProfileRecord(user.id, { role }, auditUser);
    await loadSettings();
  };

  const handleToggleActive = async (user: UserProfile) => {
    await updateUserProfileRecord(user.id, { active: !user.active }, auditUser);
    await loadSettings();
  };

  const handleDeleteUserProfile = async (user: UserProfile) => {
    const confirmed = window.confirm(`Delete profile for ${user.email}? This removes ERP role access but does not delete the Firebase Auth account.`);
    if (!confirmed) return;
    await deleteUserProfileRecord(user.id, auditUser);
    await loadSettings();
  };

  const handleTopLevelSettingChange = (field: 'highOutstandingThreshold' | 'invoicePrefix' | 'financialYearReset' | 'defaultReportPeriod' | 'showCustomerTierToCustomer', value: string | boolean) => {
    setSettings((current) => ({
      ...current,
      [field]: field === 'highOutstandingThreshold' ? Number(value) || 0 : value
    }));
  };

  const handleStaffPermissionChange = (field: keyof AppSettings['staffPermissions'], value: boolean) => {
    setSettings((current) => ({
      ...current,
      staffPermissions: {
        ...current.staffPermissions,
        [field]: value
      }
    }));
  };

  const handleTargetSettingChange = (
    tierKey: TargetTierKey,
    field: keyof AppSettings['targetSettings'][TargetTierKey],
    value: string
  ) => {
    setSettings((current) => ({
      ...current,
      targetSettings: {
        ...current.targetSettings,
        [tierKey]: {
          ...current.targetSettings[tierKey],
          // Empty target fields intentionally become NaN so validation blocks saving instead of silently storing zero.
          [field]: value.trim() === '' ? Number.NaN : Number(value)
        }
      }
    }));
  };

  const handleResetTargetSettings = () => {
    setSettings((current) => ({
      ...current,
      targetSettings: DEFAULT_SETTINGS.targetSettings
    }));
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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

  const labelStyle: CSSProperties = {
    display: 'block',
    fontWeight: 800,
    fontSize: 13
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const sectionTitleStyle: CSSProperties = {
    color: '#D4AF37',
    fontWeight: 900,
    marginBottom: 12
  };

  if (loading) {
    return <SectionHeader title="Settings" description="Loading admin settings..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Settings"
        description="Admin-only rules for gifts, credit days, payment buffers, scoring weights, and staff access."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <form style={cardStyle} onSubmit={handleSaveSettings}>
        <div style={sectionTitleStyle}>Gift Settings</div>
        <div style={gridStyle}>
          {(['Tier 1', 'Tier 2', 'Tier 3'] as const).map((tier) => (
            <label key={tier} style={labelStyle}>
              {tier} Gift %
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.1"
                value={settings.giftPercentages[tier]}
                onChange={(event) => updateNestedNumber('giftPercentages', tier, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div style={{ ...sectionTitleStyle, marginTop: 24 }}>Credit Days</div>
        <div style={gridStyle}>
          {(['Tier 1', 'Tier 2', 'Tier 3'] as const).map((tier) => (
            <label key={tier} style={labelStyle}>
              {tier} Credit Days
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={settings.creditDays[tier]}
                onChange={(event) => updateNestedNumber('creditDays', tier, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div style={{ ...sectionTitleStyle, marginTop: 24 }}>Payment Buffer Days</div>
        <div style={gridStyle}>
          {(['Tier 1', 'Tier 2', 'Tier 3'] as const).map((tier) => (
            <label key={tier} style={labelStyle}>
              {tier} Buffer Days
              <input
                style={inputStyle}
                type="number"
                min="0"
                value={settings.paymentBuffers[tier]}
                onChange={(event) => updateNestedNumber('paymentBuffers', tier, event.target.value)}
              />
            </label>
          ))}
        </div>

        <div style={{ ...sectionTitleStyle, marginTop: 24 }}>Scoring Settings</div>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Profit Weight %
            <input style={inputStyle} type="number" min="0" step="0.1" value={settings.scoringWeights.profit} onChange={(event) => updateNestedNumber('scoringWeights', 'profit', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Payment Discipline %
            <input style={inputStyle} type="number" min="0" step="0.1" value={settings.scoringWeights.paymentDiscipline} onChange={(event) => updateNestedNumber('scoringWeights', 'paymentDiscipline', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Frequency %
            <input style={inputStyle} type="number" min="0" step="0.1" value={settings.scoringWeights.frequency} onChange={(event) => updateNestedNumber('scoringWeights', 'frequency', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Sales %
            <input style={inputStyle} type="number" min="0" step="0.1" value={settings.scoringWeights.sales} onChange={(event) => updateNestedNumber('scoringWeights', 'sales', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Loyalty %
            <input style={inputStyle} type="number" min="0" step="0.1" value={settings.scoringWeights.loyalty} onChange={(event) => updateNestedNumber('scoringWeights', 'loyalty', event.target.value)} />
          </label>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            background: hasValidScoringTotal ? '#ECFDF3' : '#FFF4E5',
            border: `1px solid ${hasValidScoringTotal ? '#ABEFC6' : '#FDB022'}`,
            color: hasValidScoringTotal ? '#067647' : '#93370D',
            fontWeight: 800
          }}
        >
          Scoring total: {settingsValidation.scoringWeightTotal}% {hasValidScoringTotal ? 'ready to save' : 'must be exactly 100% before saving'}
        </div>

        {settingsValidation.errors.length > 0 ? (
          <div style={{ marginTop: 10, color: '#B42318', fontWeight: 700 }}>
            {settingsValidation.errors.map((validationError) => (
              <div key={validationError}>{validationError}</div>
            ))}
          </div>
        ) : null}

        <div style={{ ...sectionTitleStyle, marginTop: 24 }}>Tier-wise Monthly Targets</div>
        <div style={{ color: '#5C6A84', fontSize: 13, marginBottom: 12 }}>
          These targets feed the Sales Performance and Order Performance score portions without changing the total 100% weight.
        </div>
        <div style={gridStyle}>
          {([
            { tierKey: 'tier1', label: 'Tier 1' },
            { tierKey: 'tier2', label: 'Tier 2' },
            { tierKey: 'tier3', label: 'Tier 3' }
          ] as { tierKey: TargetTierKey; label: string }[]).map(({ tierKey, label }) => (
            <div key={tierKey} style={{ border: '1px solid #E8EDF4', borderRadius: 12, padding: 12 }}>
              <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 10 }}>{label}</div>
              <label style={labelStyle}>
                Monthly Sales Target
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  value={Number.isNaN(settings.targetSettings[tierKey].monthlySalesTarget) ? '' : settings.targetSettings[tierKey].monthlySalesTarget}
                  onChange={(event) => handleTargetSettingChange(tierKey, 'monthlySalesTarget', event.target.value)}
                />
              </label>
              <label style={{ ...labelStyle, marginTop: 10 }}>
                Monthly Order Frequency Target
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="0.1"
                  value={Number.isNaN(settings.targetSettings[tierKey].monthlyOrderTarget) ? '' : settings.targetSettings[tierKey].monthlyOrderTarget}
                  onChange={(event) => handleTargetSettingChange(tierKey, 'monthlyOrderTarget', event.target.value)}
                />
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginTop: 12 }}
          onClick={handleResetTargetSettings}
        >
          Reset Targets to Defaults
        </button>

        <div style={{ ...sectionTitleStyle, marginTop: 24 }}>ERP Control Settings</div>
        <div style={gridStyle}>
          <label style={labelStyle}>
            High Outstanding Alert Threshold
            <input
              style={inputStyle}
              type="number"
              min="0"
              value={settings.highOutstandingThreshold}
              onChange={(event) => handleTopLevelSettingChange('highOutstandingThreshold', event.target.value)}
            />
          </label>
          <label style={labelStyle}>
            Invoice Prefix
            <input
              style={inputStyle}
              value={settings.invoicePrefix}
              onChange={(event) => handleTopLevelSettingChange('invoicePrefix', event.target.value.toUpperCase())}
            />
          </label>
          <label style={labelStyle}>
            Default Report Period
            <select
              style={inputStyle}
              value={settings.defaultReportPeriod}
              onChange={(event) => handleTopLevelSettingChange('defaultReportPeriod', event.target.value as AppSettings['defaultReportPeriod'])}
            >
              <option value="current_month">Current month</option>
              <option value="last_month">Last month</option>
              <option value="previous_30_days">Previous 30 days</option>
            </select>
          </label>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, marginTop: 26 }}>
            <input
              type="checkbox"
              checked={settings.financialYearReset}
              onChange={(event) => handleTopLevelSettingChange('financialYearReset', event.target.checked)}
            />
            Reset invoice number each financial year
          </label>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10, marginTop: 26 }}>
            <input
              type="checkbox"
              checked={settings.showCustomerTierToCustomer}
              onChange={(event) => handleTopLevelSettingChange('showCustomerTierToCustomer', event.target.checked)}
            />
            Show customer category in customer portal
          </label>
        </div>

        <div style={{ ...sectionTitleStyle, marginTop: 24 }}>Staff Permissions</div>
        <div style={gridStyle}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              checked={settings.staffPermissions.canViewDashboard}
              onChange={(event) => handleStaffPermissionChange('canViewDashboard', event.target.checked)}
            />
            Staff can view dashboard
          </label>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox"
              checked={settings.staffPermissions.canViewReports}
              onChange={(event) => handleStaffPermissionChange('canViewReports', event.target.checked)}
            />
            Staff can view reports
          </label>
        </div>

        <button type="submit" disabled={saving || !settingsValidation.isValid} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A', marginTop: 18 }}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <form style={cardStyle} onSubmit={handleCreateStaff}>
        <div style={sectionTitleStyle}>Manage Staff Accounts</div>
        <div style={gridStyle}>
          <label style={labelStyle}>Name<input style={inputStyle} value={staffName} onChange={(event) => setStaffName(event.target.value)} /></label>
          <label style={labelStyle}>Email<input style={inputStyle} type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} /></label>
          <label style={labelStyle}>Password<input style={inputStyle} type="password" value={staffPassword} onChange={(event) => setStaffPassword(event.target.value)} /></label>
          <label style={labelStyle}>
            Role
            <select style={inputStyle} value={staffRole} onChange={(event) => setStaffRole(event.target.value as UserRole)}>
              <option value="Staff">Staff</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
        </div>

        <button type="submit" disabled={saving} style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginTop: 18 }}>
          Create User
        </button>
      </form>

      <div style={cardStyle}>
        <div style={sectionTitleStyle}>Existing Users</div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Name', 'Email', 'Role', 'Linked Customer', 'Active', 'Actions'].map((header) => (
                  <th key={header} style={{ textAlign: 'left', padding: 12, background: '#F8F9FB', borderBottom: '1px solid #E8EDF4' }}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((user) => (
                <tr key={user.id}>
                  <td style={{ padding: 12, borderBottom: '1px solid #E8EDF4' }}>{user.name}</td>
                  <td style={{ padding: 12, borderBottom: '1px solid #E8EDF4' }}>{user.email}</td>
                  <td style={{ padding: 12, borderBottom: '1px solid #E8EDF4' }}>
                    <select style={inputStyle} value={user.role} onChange={(event) => handleRoleChange(user, event.target.value as UserRole)}>
                      <option value="Staff">Staff</option>
                      <option value="Admin">Admin</option>
                      <option value="customer">Customer</option>
                    </select>
                  </td>
                  <td style={{ padding: 12, borderBottom: '1px solid #E8EDF4' }}>{user.customerName || '-'}</td>
                  <td style={{ padding: 12, borderBottom: '1px solid #E8EDF4' }}>{user.active ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 12, borderBottom: '1px solid #E8EDF4' }}>
                    <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginRight: 8 }} onClick={() => handleToggleActive(user)}>
                      {user.active ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDeleteUserProfile(user)}>
                      Delete Profile
                    </button>
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

export default Settings;
