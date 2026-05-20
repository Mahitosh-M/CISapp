import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { createStaffAuthAccount } from '../services/authService';
import {
  getActivityLogs,
  getAlerts,
  getGiftHistory,
  getUserProfiles,
  logActivity,
  updateAlertStatus,
  updateCustomerRecord,
  updateGiftHistoryRecord,
  updateUserProfileRecord,
  upsertAlerts
} from '../services/firestoreService';
import { useErpData } from '../hooks/useErpData';
import type { ActivityLog, Alert, GiftHistory, UserProfile, UserRole } from '../types';
import { buildOperationalAlerts } from '../utils/alertUtils';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { getTodayDateString } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { getPaymentTermsLabel } from '../utils/settings';

const Admin = () => {
  const { customers, invoices, payments, settings, loading, error, refreshData } = useErpData();
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>('Staff');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [adminError, setAdminError] = useState('');

  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadAdminData = async () => {
    try {
      setAdminError('');
      const [userRows, logRows, alertRows, giftRows] = await Promise.all([
        getUserProfiles(),
        getActivityLogs(),
        getAlerts(),
        getGiftHistory()
      ]);
      setUsers(userRows);
      setActivityLogs(logRows);
      setAlerts(alertRows);
      setGiftHistory(giftRows);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to load admin data.');
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const generatedAlerts = useMemo(() => buildOperationalAlerts(customers, invoices, payments, settings), [customers, invoices, payments, settings]);
  const openAlerts = alerts.filter((alert) => alert.status === 'Open');
  const pendingGifts = giftHistory.filter((gift) => gift.status !== 'Given');
  const tierOverrides = customers.filter((customer) => customer.tierOverride);
  const negativeProfitInvoices = invoices.filter((invoice) => invoice.totalProfit < 0);

  const handleSyncAlerts = async () => {
    try {
      setSaving(true);

      // Auto-tier sync respects Admin overrides and logs every real tier movement.
      const scoresByCustomerId = new Map(buildCustomerScores(customers, invoices, payments, new Date(), settings).map((score) => [score.customerId, score]));
      await Promise.all(
        customers.map(async (customer) => {
          const score = scoresByCustomerId.get(customer.id);

          if (!score || customer.tierOverride || score.tier === customer.tier) {
            return;
          }

          await updateCustomerRecord(
            customer.id,
            {
              name: customer.name,
              mobile: customer.mobile,
              area: customer.area,
              tier: score.tier,
              paymentTerms: getPaymentTermsLabel(score.tier, settings),
              notes: customer.notes,
              previousOutstandingAmount: customer.previousOutstandingAmount ?? 0,
              status: customer.status,
              tierOverride: false
            },
            auditUser
          );
          await logActivity('tier changed', 'customer', customer.id, auditUser, { tier: customer.tier }, { tier: score.tier, reason: score.movementReason || `Score ${score.intelligenceScore}` });
        })
      );

      const giftPendingAlerts = giftHistory
        .filter((gift) => gift.status !== 'Given')
        .map((gift) => ({
          uniqueKey: `gift_pending:${gift.id}`,
          customerId: gift.customerId,
          customerName: gift.customerName,
          alertType: 'gift_pending' as const,
          severity: 'Medium' as const,
          date: getTodayDateString(),
          status: 'Open' as const,
          actionRequired: 'Approve or mark the pending gift as given.',
          message: `${gift.customerName} has a pending gift for ${gift.periodStart} to ${gift.periodEnd}.`
        }));

      await upsertAlerts([...generatedAlerts, ...giftPendingAlerts], auditUser);
      setMessage('Alerts and automatic tier changes synced from current Firestore ERP data.');
      await refreshData();
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to sync alerts.');
    } finally {
      setSaving(false);
    }
  };

  const handleAlertStatus = async (alert: Alert, status: Alert['status']) => {
    await updateAlertStatus(alert.id, status, auditUser);
    await loadAdminData();
  };

  const handleCreateStaff = async (event: FormEvent) => {
    event.preventDefault();

    if (!staffName || !staffEmail || !staffPassword) {
      setAdminError('Name, email, and password are required.');
      return;
    }

    try {
      setSaving(true);
      const uid = await createStaffAuthAccount(staffEmail, staffPassword, staffName, staffRole);
      await logActivity('user created', 'user', uid, auditUser, undefined, { email: staffEmail, name: staffName, role: staffRole });
      setStaffName('');
      setStaffEmail('');
      setStaffPassword('');
      setStaffRole('Staff');
      setMessage('Staff account created.');
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to create staff account.');
    } finally {
      setSaving(false);
    }
  };

  const handleUserRoleChange = async (user: UserProfile, role: UserRole) => {
    await updateUserProfileRecord(user.id, { role }, auditUser);
    await loadAdminData();
  };

  const handleGiftStatus = async (gift: GiftHistory, status: GiftHistory['status']) => {
    await updateGiftHistoryRecord(
      gift.id,
      {
        ...gift,
        status,
        actualGiftAmount: status === 'Given' ? gift.suggestedGiftBudget : gift.actualGiftAmount,
        giftAmount: status === 'Given' ? gift.suggestedGiftBudget : gift.giftAmount,
        giftGivenDate: status === 'Given' ? getTodayDateString() : gift.giftGivenDate,
        giftedDate: status === 'Given' ? getTodayDateString() : gift.giftedDate,
        giftedBy: status === 'Given' ? userProfile?.email || 'Admin' : gift.giftedBy,
        approvedBy: gift.approvedBy || userProfile?.email || 'Admin'
      },
      auditUser
    );
    await loadAdminData();
  };

  const clearTierOverride = async (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    if (!customer) return;

    await updateCustomerRecord(
      customer.id,
      {
        name: customer.name,
        mobile: customer.mobile,
        area: customer.area,
        tier: customer.tier,
        paymentTerms: customer.paymentTerms,
        notes: customer.notes,
        previousOutstandingAmount: customer.previousOutstandingAmount ?? 0,
        status: customer.status,
        tierOverride: false
      },
      auditUser
    );
    await refreshData();
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
    padding: '9px 12px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const headerCellStyle: CSSProperties = {
    padding: 12,
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4',
    textAlign: 'left',
    fontWeight: 900
  };

  const cellStyle: CSSProperties = {
    padding: 12,
    borderBottom: '1px solid #E8EDF4',
    verticalAlign: 'top'
  };

  const renderTable = (headers: string[], body: JSX.Element) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
        <thead>
          <tr>{headers.map((header) => <th key={header} style={headerCellStyle}>{header}</th>)}</tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );

  if (loading) {
    return <SectionHeader title="Admin" description="Loading system health..." />;
  }

  return (
    <div>
      <SectionHeader title="Admin" description="Manage staff, alerts, gift approvals, tier overrides, activity logs, and system health." />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {adminError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{adminError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18, marginBottom: 24 }}>
        <StatCard title="Customers" value={`${customers.length}`} subtitle="Firestore records" />
        <StatCard title="Invoices" value={`${invoices.length}`} subtitle="Invoice collection" />
        <StatCard title="Payments" value={`${payments.length}`} subtitle="Payment collection" />
        <StatCard title="Open Alerts" value={`${openAlerts.length}`} subtitle={`${generatedAlerts.length} generated from current data`} color="#EB5757" />
        <StatCard title="Pending Gifts" value={`${pendingGifts.length}`} subtitle="Approved or awaiting final gift" />
        <StatCard title="Negative Profit" value={`${negativeProfitInvoices.length}`} subtitle="Invoices to review" color="#EB5757" />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>System Health</div>
            <div style={{ color: '#67738E', marginTop: 4 }}>Alerts are generated from live Firestore customers, invoices, payments, and settings.</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/settings" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', textDecoration: 'none' }}>Settings</Link>
            <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={handleSyncAlerts}>
              {saving ? 'Syncing...' : 'Sync Alerts'}
            </button>
          </div>
        </div>
      </div>

      <form style={cardStyle} onSubmit={handleCreateStaff}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Manage Staff Users</div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>Name<input style={inputStyle} value={staffName} onChange={(event) => setStaffName(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>Email<input style={inputStyle} type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>Password<input style={inputStyle} type="password" value={staffPassword} onChange={(event) => setStaffPassword(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>
            Role
            <select style={inputStyle} value={staffRole} onChange={(event) => setStaffRole(event.target.value as UserRole)}>
              <option value="Staff">Staff</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
        </div>
        <button type="submit" disabled={saving} style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginTop: 16 }}>Create User</button>
      </form>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Existing Users</div>
        {renderTable(
          ['Name', 'Email', 'Role', 'Active'],
          <>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={cellStyle}>{user.name}</td>
                <td style={cellStyle}>{user.email}</td>
                <td style={cellStyle}>
                  <select style={inputStyle} value={user.role} onChange={(event) => handleUserRoleChange(user, event.target.value as UserRole)}>
                    <option value="Staff">Staff</option>
                    <option value="Admin">Admin</option>
                  </select>
                </td>
                <td style={cellStyle}>{user.active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Alerts</div>
        {renderTable(
          ['Customer', 'Type', 'Severity', 'Message', 'Status', 'Action'],
          <>
            {alerts.length === 0 ? (
              <tr><td style={cellStyle} colSpan={6}>No saved alerts yet. Click Sync Alerts.</td></tr>
            ) : (
              alerts.slice(0, 30).map((alert) => (
                <tr key={alert.id}>
                  <td style={cellStyle}>{alert.customerName}</td>
                  <td style={cellStyle}>{alert.alertType.replace(/_/g, ' ')}</td>
                  <td style={{ ...cellStyle, color: alert.severity === 'High' ? '#B42318' : '#B7791F', fontWeight: 900 }}>{alert.severity}</td>
                  <td style={cellStyle}>{alert.message}<div style={{ color: '#67738E', fontSize: 12 }}>{alert.actionRequired}</div></td>
                  <td style={cellStyle}>{alert.status}</td>
                  <td style={cellStyle}>
                    <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginRight: 8 }} onClick={() => handleAlertStatus(alert, 'Reviewed')}>Reviewed</button>
                    <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={() => handleAlertStatus(alert, 'Resolved')}>Resolved</button>
                  </td>
                </tr>
              ))
            )}
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Gift Approvals</div>
        {renderTable(
          ['Customer', 'Tier', 'Status', 'Period', 'Budget', 'Item', 'Action'],
          <>
            {pendingGifts.length === 0 ? (
              <tr><td style={cellStyle} colSpan={7}>No pending gift approvals.</td></tr>
            ) : (
              pendingGifts.map((gift) => (
                <tr key={gift.id}>
                  <td style={cellStyle}>{gift.customerName}</td>
                  <td style={cellStyle}><TierBadge tier={gift.tierAtGiftTime} /></td>
                  <td style={cellStyle}>{gift.status}</td>
                  <td style={cellStyle}>{gift.periodStart} to {gift.periodEnd}</td>
                  <td style={cellStyle}>{formatMoney(gift.suggestedGiftBudget)}</td>
                  <td style={cellStyle}>{gift.giftItem || '-'}</td>
                  <td style={cellStyle}>
                    <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={() => handleGiftStatus(gift, 'Given')}>Mark Given</button>
                  </td>
                </tr>
              ))
            )}
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Tier Overrides</div>
        {renderTable(
          ['Customer', 'Area', 'Tier', 'Payment Terms', 'Action'],
          <>
            {tierOverrides.length === 0 ? (
              <tr><td style={cellStyle} colSpan={5}>No manual tier overrides active.</td></tr>
            ) : (
              tierOverrides.map((customer) => (
                <tr key={customer.id}>
                  <td style={cellStyle}>{customer.name}</td>
                  <td style={cellStyle}>{customer.area}</td>
                  <td style={cellStyle}><TierBadge tier={customer.tier} /></td>
                  <td style={cellStyle}>{customer.paymentTerms}</td>
                  <td style={cellStyle}><button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={() => clearTierOverride(customer.id)}>Clear Override</button></td>
                </tr>
              ))
            )}
          </>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Activity Logs</div>
        {renderTable(
          ['Date', 'Action', 'User', 'Target'],
          <>
            {activityLogs.length === 0 ? (
              <tr><td style={cellStyle} colSpan={4}>No activity logs yet.</td></tr>
            ) : (
              activityLogs.slice(0, 40).map((log) => (
                <tr key={log.id}>
                  <td style={cellStyle}>{log.createdAt.slice(0, 19).replace('T', ' ')}</td>
                  <td style={cellStyle}>{log.action}</td>
                  <td style={cellStyle}>{log.userEmail}<div style={{ color: '#67738E', fontSize: 12 }}>{log.role}</div></td>
                  <td style={cellStyle}>{log.targetType}: {log.targetId}</td>
                </tr>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Admin;
