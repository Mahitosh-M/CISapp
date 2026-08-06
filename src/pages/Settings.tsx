import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import {
  getAppSettings,
  updateAppSettings,
  updateAppSettingsToggle
} from '../services/firestoreService';
import { useAuth } from '../contexts/AuthContext';
import type { AppSettings, TargetTierKey } from '../types';
import type { AppSettingsToggleField } from '../services/firestoreService';
import { getDerivedDataMigrationStatus, runDerivedDataMigration } from '../services/migrationService';
import type { DerivedDataMigrationStatus } from '../services/migrationService';
import { DEFAULT_SETTINGS, isScoringWeightTotalValid, mergeWithDefaultSettings, validateAppSettings } from '../utils/settings';
import { CUSTOMER_TIERS, getTierDisplayName } from '../utils/tiers';

interface ToggleSettingProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const ToggleSetting = ({ checked, label, onChange, disabled = false }: ToggleSettingProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{
      position: 'relative',
      width: 178,
      height: 54,
      boxSizing: 'border-box',
      padding: checked ? '0 56px 0 14px' : '0 14px 0 56px',
      border: '2px solid rgba(255,255,255,0.78)',
      borderRadius: 999,
      background: checked ? 'linear-gradient(180deg, #22C55E 0%, #16A34A 100%)' : 'linear-gradient(180deg, #EF233C 0%, #DC2626 100%)',
      color: '#FFFFFF',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 900,
      fontSize: 14,
      lineHeight: 1.1,
      textAlign: 'center',
      boxShadow: checked
        ? 'inset 0 3px 7px rgba(6,95,70,0.35), 0 2px 7px rgba(0,0,0,0.24)'
        : 'inset 0 3px 7px rgba(127,29,29,0.38), 0 2px 7px rgba(0,0,0,0.24)',
      cursor: disabled ? 'wait' : 'pointer',
      opacity: disabled ? 0.65 : 1,
      transition: 'background 180ms ease, box-shadow 180ms ease'
    }}
  >
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 5,
        left: checked ? 131 : 5,
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'linear-gradient(145deg, #FFFFFF 0%, #E5E7EB 100%)',
        border: '1px solid rgba(15,23,42,0.16)',
        boxShadow: '0 3px 8px rgba(0,0,0,0.34)',
        transition: 'left 180ms ease'
      }}
    />
    <span style={{ width: '100%', overflowWrap: 'anywhere' }}>{label}</span>
  </button>
);

const SettingsSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <details
    style={{
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: 8,
      marginTop: 12,
      overflow: 'hidden'
    }}
  >
    <summary
      style={{
        padding: '14px 16px',
        color: '#D4AF37',
        fontWeight: 900,
        cursor: 'pointer',
        background: 'rgba(2,6,23,0.2)'
      }}
    >
      {title}
    </summary>
    <div style={{ padding: 16 }}>{children}</div>
  </details>
);

const Settings = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingToggle, setSavingToggle] = useState<AppSettingsToggleField | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<DerivedDataMigrationStatus>();
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
      const appSettings = await getAppSettings();
      setSettings(mergeWithDefaultSettings(appSettings));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (userProfile?.role !== 'Admin') return;
    void getDerivedDataMigrationStatus()
      .then(setMigrationStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load migration status.'));
  }, [userProfile?.role]);

  const settingsValidation = useMemo(() => validateAppSettings(settings), [settings]);
  const hasValidScoringTotal = isScoringWeightTotalValid(settingsValidation.scoringWeightTotal);

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
      setMessage('Settings saved successfully. New invoices, intelligence, gifts, and overdue checks will use the updated rules.');
      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTopLevelSettingChange = (field: 'highOutstandingThreshold' | 'invoicePrefix' | 'financialYearReset' | 'defaultReportPeriod' | 'showCustomerTierToCustomer' | 'turnOnOrder' | 'headerOrder' | 'down' | 'customerDown', value: string | boolean) => {
    setSettings((current) => ({
      ...current,
      [field]: field === 'highOutstandingThreshold' ? Number(value) || 0 : value
    }));
  };

  const handleToggleChange = async (field: AppSettingsToggleField, value: boolean) => {
    const previousValue = settings[field];
    setSettings((current) => ({ ...current, [field]: value }));
    setSavingToggle(field);
    setMessage('');
    setError('');

    try {
      await updateAppSettingsToggle(field, value);
      const label = field === 'down' ? 'App Down' : field === 'customerDown' ? 'Customer' : field === 'turnOnOrder' ? 'Order Page' : 'Header Order';
      setMessage(label + ' updated.');
    } catch (err) {
      setSettings((current) => ({ ...current, [field]: previousValue }));
      setError(err instanceof Error ? err.message : 'Unable to update setting.');
    } finally {
      setSavingToggle(null);
    }
  };

  const handleBusinessCostChange = (field: 'fixedMonthlyCosts', value: string) => {
    setSettings((current) => ({
      ...current,
      [field]: Number(value) || 0
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
          [field]: value.trim() === '' ? Number.NaN : field === 'monthlyOrderTarget' ? Math.trunc(Number(value)) : Number(value)
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

  const handleDerivedDataMigration = async () => {
    try {
      setMigrating(true);
      setError('');
      setMessage('');
      const completed = await runDerivedDataMigration(auditUser, setMigrationStatus);
      setMigrationStatus(completed);
      setMessage(`Historical migration completed: ${completed.updatedInvoices} invoice terms, ${completed.processedCustomers} customer summaries, and ${completed.processedBusinessMonths} business months processed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run historical migration. Run it again to resume.');
    } finally {
      setMigrating(false);
    }
  };

  const handleOverduePolicyChange = (field: keyof AppSettings['overduePolicy'], value: string) => {
    setSettings((current) => ({
      ...current,
      overduePolicy: {
        ...current.overduePolicy,
        [field]: Math.max(0, Number(value) || 0)
      }
    }));
  };

  const cardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 16,
    padding: 20,
    color: '#FFFFFF',
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
        <div style={sectionTitleStyle}>Operational Controls</div>
        <div style={{ ...gridStyle, marginBottom: 20 }}>
          <ToggleSetting
            checked={settings.down}
            label="App Down"
            disabled={savingToggle === 'down'}
            onChange={(checked) => handleToggleChange('down', checked)}
          />
          <ToggleSetting
            checked={settings.customerDown}
            label="Customer"
            disabled={savingToggle === 'customerDown'}
            onChange={(checked) => handleToggleChange('customerDown', checked)}
          />
          <ToggleSetting
            checked={settings.turnOnOrder}
            label="Order Page"
            disabled={savingToggle === 'turnOnOrder'}
            onChange={(checked) => handleToggleChange('turnOnOrder', checked)}
          />
          <ToggleSetting
            checked={settings.headerOrder}
            label="Header Order"
            disabled={savingToggle === 'headerOrder'}
            onChange={(checked) => handleToggleChange('headerOrder', checked)}
          />
        </div>

        <SettingsSection title="Gift Settings">
          <div style={gridStyle}>
          {CUSTOMER_TIERS.map((tier) => (
            <label key={tier} style={labelStyle}>
              {getTierDisplayName(tier)} Gift %
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.1"
                readOnly
                value={settings.giftPercentages[tier]}
              />
            </label>
          ))}
          </div>
        </SettingsSection>

        <SettingsSection title="Credit Days">
          <div style={gridStyle}>
          {CUSTOMER_TIERS.map((tier) => (
            <label key={tier} style={labelStyle}>
              {getTierDisplayName(tier)} Credit Days
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
        </SettingsSection>

        <SettingsSection title="Payment Buffer Days">
          <div style={gridStyle}>
          {CUSTOMER_TIERS.map((tier) => (
            <label key={tier} style={labelStyle}>
              {getTierDisplayName(tier)} Buffer Days
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
        </SettingsSection>

        <SettingsSection title="Scoring Settings">
          <div style={gridStyle}>
          <label style={labelStyle}>
            Profit Weight %
            <input style={inputStyle} type="number" readOnly value={settings.scoringWeights.profit} />
          </label>
          <label style={labelStyle}>
            Payment Discipline %
            <input style={inputStyle} type="number" readOnly value={settings.scoringWeights.paymentDiscipline} />
          </label>
          <label style={labelStyle}>
            Frequency %
            <input style={inputStyle} type="number" readOnly value={settings.scoringWeights.frequency} />
          </label>
          <label style={labelStyle}>
            Sales %
            <input style={inputStyle} type="number" readOnly value={settings.scoringWeights.sales} />
          </label>
          <label style={labelStyle}>
            Loyalty %
            <input style={inputStyle} type="number" readOnly value={settings.scoringWeights.loyalty} />
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
          <div style={{ marginTop: 10, color: '#FCA5A5', fontWeight: 700 }}>
            {settingsValidation.errors.map((validationError) => (
              <div key={validationError}>{validationError}</div>
            ))}
          </div>
        ) : null}
        </SettingsSection>

        <SettingsSection title="Overdue Risk Thresholds">
          <div style={gridStyle}>
            {([
              ['minorSalesRatioPercent', 'Minor sales ratio %'],
              ['seriousSalesRatioPercent', 'Serious sales ratio %'],
              ['materialDays', 'Material overdue days'],
              ['seriousDays', 'Serious overdue days'],
              ['seriousInvoiceCount', 'Serious invoice count'],
              ['repeatedEventCount', 'Repeated event count']
            ] as [keyof AppSettings['overduePolicy'], string][]).map(([field, label]) => (
              <label key={field} style={labelStyle}>
                {label}
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step={field.includes('Percent') ? '0.1' : '1'}
                  value={settings.overduePolicy[field]}
                  onChange={(event) => handleOverduePolicyChange(field, event.target.value)}
                />
              </label>
            ))}
          </div>
        </SettingsSection>

        <SettingsSection title="Partner Level Monthly Targets">
          <div style={{ color: '#BFC8D9', fontSize: 13, marginBottom: 12 }}>
          These targets feed the Sales Performance and Order Performance score portions without changing the total 100% weight.
        </div>
          <div style={gridStyle}>
          {([
            { tierKey: 'tier1', label: 'Platinum Partner' },
            { tierKey: 'tier2', label: 'Gold Partner' },
            { tierKey: 'tier3', label: 'Silver Partner' },
            { tierKey: 'tier4', label: 'Active Partner' }
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
                  step="1"
                  value={Number.isNaN(settings.targetSettings[tierKey].monthlyOrderTarget) ? '' : settings.targetSettings[tierKey].monthlyOrderTarget}
                  onChange={(event) => handleTargetSettingChange(tierKey, 'monthlyOrderTarget', event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === '.' || event.key === ',') {
                      event.preventDefault();
                    }
                  }}
                />
              </label>
            </div>
          ))}
          </div>
          <button
          type="button"
          style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginTop: 12 }}
          onClick={handleResetTargetSettings}
        >
          Reset Targets to Defaults
          </button>
        </SettingsSection>

        <SettingsSection title="Business Cost Settings">
          <div style={gridStyle}>
          <label style={labelStyle}>
            Fixed Monthly Costs Per Month
            <input
              style={inputStyle}
              type="number"
              min="0"
              step="0.01"
              value={settings.fixedMonthlyCosts}
              onChange={(event) => handleBusinessCostChange('fixedMonthlyCosts', event.target.value)}
            />
          </label>
          </div>
          <div style={{ color: '#BFC8D9', fontSize: 13, marginTop: 8 }}>
          Enter the cost for one full month only. Analytics allocates it to the selected date range automatically.
          </div>
        </SettingsSection>

        <SettingsSection title="ERP Control Settings">
          <div style={gridStyle}>
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
        </SettingsSection>

        {userProfile?.role === 'Admin' ? (
          <SettingsSection title="Data Maintenance">
            <div style={{ display: 'grid', gap: 8, color: '#D7DEEA', fontSize: 13 }}>
              <div>Migration: <strong style={{ color: '#FFFFFF' }}>{migrationStatus?.phase ?? 'not_started'}</strong></div>
              <div>Invoices checked: <strong style={{ color: '#FFFFFF' }}>{migrationStatus?.processedInvoices ?? 0}</strong></div>
              <div>Customers rebuilt: <strong style={{ color: '#FFFFFF' }}>{migrationStatus?.processedCustomers ?? 0}</strong></div>
              <div>Business months rebuilt: <strong style={{ color: '#FFFFFF' }}>{migrationStatus?.processedBusinessMonths ?? 0}</strong></div>
            </div>
            <button
              type="button"
              disabled={migrating || migrationStatus?.phase === 'complete'}
              onClick={handleDerivedDataMigration}
              style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              <RefreshCw size={16} />
              {migrating ? 'Rebuilding stored data...' : migrationStatus?.phase === 'complete' ? 'Migration Complete' : migrationStatus ? 'Resume Migration' : 'Run Migration'}
            </button>
          </SettingsSection>
        ) : null}

        <button type="submit" disabled={saving || !settingsValidation.isValid} style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A', marginTop: 18 }}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

    </div>
  );
};

export default Settings;
