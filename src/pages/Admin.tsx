import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { KeyRound, Mail, ShieldCheck, Stethoscope, UserMinus, UserPlus, Users } from 'lucide-react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { createCustomerAuthAccount, createMedicalAuthAccount, createStaffAuthAccount, sendUserPasswordResetEmail } from '../services/authService';
import {
  deleteUserProfileRecord,
  getCustomers,
  getUserProfiles,
  updateUserProfileRecord,
} from '../services/firestoreService';
import type { Customer, ShopId, UserProfile, UserRole } from '../types';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getShopName, SHOP_OPTIONS } from '../utils/shops';

type AdminPanel = 'staff' | 'customers' | 'medicals' | null;

const Admin = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [staffRole, setStaffRole] = useState<Extract<UserRole, 'Admin' | 'Staff'>>('Staff');
  const [staffShopId, setStaffShopId] = useState<ShopId | ''>('');
  const [customerLoginId, setCustomerLoginId] = useState('');
  const [customerLoginEmail, setCustomerLoginEmail] = useState('');
  const [customerLoginPassword, setCustomerLoginPassword] = useState('');
  const [showCustomerLoginPassword, setShowCustomerLoginPassword] = useState(false);
  const [medicalLoginId, setMedicalLoginId] = useState('');
  const [medicalLoginEmail, setMedicalLoginEmail] = useState('');
  const [medicalLoginPassword, setMedicalLoginPassword] = useState('');
  const [showMedicalLoginPassword, setShowMedicalLoginPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [adminError, setAdminError] = useState('');
  const [activePanel, setActivePanel] = useState<AdminPanel>(null);

  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadAdminData = async () => {
    try {
      setLoading(true);
      setAdminError('');
      const [userRows, customerRows] = await Promise.all([getUserProfiles(), getCustomers({ limitCount: 5000 })]);
      setUsers(userRows);
      setCustomers(customerRows);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load admin data.';
      setAdminError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const sortedUsers = useMemo(() => sortNewestFirst(users, ['updatedAt', 'createdAt']), [users]);
  const sortedStaffUsers = useMemo(() => sortedUsers.filter((user) => user.role === 'Admin' || user.role === 'Staff'), [sortedUsers]);
  const sortedCustomerUsers = useMemo(() => sortedUsers.filter((user) => user.role === 'customer'), [sortedUsers]);
  const sortedMedicalUsers = useMemo(() => sortedUsers.filter((user) => user.role === 'Medical'), [sortedUsers]);
  const isAdmin = userProfile?.role === 'Admin';
  const adminUserCount = useMemo(() => users.filter((user) => user.role === 'Admin').length, [users]);

  const handleCreateStaff = async (event: FormEvent) => {
    event.preventDefault();

    const cleanName = staffName.trim();
    const cleanEmail = staffEmail.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !staffPassword || (staffRole === 'Staff' && !staffShopId)) {
      setAdminError(staffRole === 'Staff'
        ? 'Name, email, password, and assigned shop are required.'
        : 'Name, email, and password are required.');
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      setMessage('');
      await createStaffAuthAccount(cleanEmail, staffPassword, cleanName, staffRole, staffShopId || undefined);
      setStaffName('');
      setStaffEmail('');
      setStaffPassword('');
      setStaffRole('Staff');
      setStaffShopId('');
      setMessage('Staff account created.');
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to create staff account.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateCustomerLogin = async (event: FormEvent) => {
    event.preventDefault();

    const linkedCustomer = customers.find((customer) => customer.id === customerLoginId);
    const cleanEmail = customerLoginEmail.trim().toLowerCase();

    if (!linkedCustomer || !cleanEmail || !customerLoginPassword) {
      setAdminError('Customer, email, and password are required for customer login.');
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      setMessage('');
      await createCustomerAuthAccount(cleanEmail, customerLoginPassword, linkedCustomer.id, linkedCustomer.name);
      setCustomerLoginId('');
      setCustomerLoginEmail('');
      setCustomerLoginPassword('');
      setMessage('Customer login created and linked.');
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to create customer login.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateMedicalLogin = async (event: FormEvent) => {
    event.preventDefault();

    const linkedCustomer = customers.find((customer) => customer.id === medicalLoginId);
    const cleanEmail = medicalLoginEmail.trim().toLowerCase();

    if (!linkedCustomer || !cleanEmail || !medicalLoginPassword) {
      setAdminError('Customer, email, and password are required for medical login.');
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      setMessage('');
      await createMedicalAuthAccount(cleanEmail, medicalLoginPassword, linkedCustomer.id, linkedCustomer.name);
      setMedicalLoginId('');
      setMedicalLoginEmail('');
      setMedicalLoginPassword('');
      setMessage('Medical login created and linked.');
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to create medical login.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserActive = async (user: UserProfile) => {
    if (user.uid === userProfile?.uid || user.email === userProfile?.email) {
      setAdminError('You cannot disable your own active admin login.');
      return;
    }

    await updateUserProfileRecord(user.id, { active: !user.active }, auditUser);
    await loadAdminData();
  };

  const handleStaffShopChange = async (user: UserProfile, shopId: ShopId) => {
    if (user.role !== 'Staff') return;

    try {
      setSaving(true);
      setAdminError('');
      setMessage('');
      await updateUserProfileRecord(user.id, { shopId }, auditUser);
      setUsers((current) => current.map((row) => row.id === user.id
        ? { ...row, shopId, updatedAt: new Date().toISOString() }
        : row));
      setMessage(`${user.name} can now use ${getShopName(shopId)} in Cash App.`);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to assign this staff shop.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendPasswordReset = async (user: UserProfile) => {
    if (!user.email) {
      setAdminError('This user does not have an email address.');
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      await sendUserPasswordResetEmail(user.email);
      setMessage(`Password reset email sent to ${user.email}. Existing passwords cannot be shown for security.`);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to send password reset email.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUserAccess = async (user: UserProfile) => {
    if (user.uid === userProfile?.uid || user.email === userProfile?.email) {
      setAdminError('You cannot remove your own active admin access.');
      return;
    }
    if (user.role === 'Admin') {
      setAdminError('Admin access cannot be removed from this page.');
      return;
    }

    const confirmed = window.confirm('Remove app access for ' + user.email + '? They will no longer be able to use CISapp or Cash App. Their Firebase Authentication sign-in record will remain until it is removed manually in Firebase Console.');

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      setMessage('');
      await deleteUserProfileRecord(user.id);
      setUsers((current) => current.filter((row) => row.id !== user.id));
      setMessage('App access removed for ' + user.email + '. The Firebase Authentication sign-in record was not deleted.');
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to delete user access.');
    } finally {
      setSaving(false);
    }
  };

  const cardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 16,
    padding: 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const metricGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(150px, 260px)',
    gap: 12,
    marginBottom: 20
  };

  const metricCardStyle: CSSProperties = {
    ...cardStyle,
    marginBottom: 0,
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 12
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
    background: 'var(--role-card-subtle)',
    borderBottom: '1px solid var(--role-card-border)',
    textAlign: 'left',
    fontWeight: 900
  };

  const cellStyle: CSSProperties = {
    padding: 12,
    borderBottom: '1px solid var(--role-card-border)',
    verticalAlign: 'top'
  };

  const renderTable = (headers: string[], body: JSX.Element) => (
    <>
      <div style={{ color: '#D7DEEA', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
      <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
        <thead>
          <tr>{headers.map((header) => <th key={header} style={headerCellStyle}>{header}</th>)}</tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
      </div>
    </>
  );

  if (loading) {
    return <SectionHeader title="Admin" description="Loading admin controls..." />;
  }

  return (
    <div className="admin-page">
      <SectionHeader title="Admin" description="Manage staff and user access." />

      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
      {adminError ? <div className="admin-alert admin-alert-error">{adminError}</div> : null}
      {message ? <div className="admin-alert admin-alert-success">{message}</div> : null}

      <div style={metricGridStyle}>
        <div className="admin-card admin-metric" style={metricCardStyle}>
          <div className="admin-icon-badge"><ShieldCheck size={20} /></div>
          <div><div className="admin-metric-value">{adminUserCount}</div><div className="admin-metric-label">Admins</div></div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          className="admin-button admin-button-primary"
          type="button"
          aria-pressed={activePanel === 'staff'}
          onClick={() => setActivePanel((current) => current === 'staff' ? null : 'staff')}
          style={{ ...buttonStyle, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, background: activePanel === 'staff' ? '#D4AF37' : 'linear-gradient(135deg, #11185A 0%, #1E2961 100%)', color: activePanel === 'staff' ? '#11185A' : '#FFFFFF' }}
        >
          <UserPlus size={18} />Add Staff
        </button>
        <button
          className="admin-button admin-button-primary"
          type="button"
          aria-pressed={activePanel === 'customers'}
          onClick={() => setActivePanel((current) => current === 'customers' ? null : 'customers')}
          style={{ ...buttonStyle, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, background: activePanel === 'customers' ? '#D4AF37' : 'linear-gradient(135deg, #11185A 0%, #1E2961 100%)', color: activePanel === 'customers' ? '#11185A' : '#FFFFFF' }}
        >
          <Users size={18} />Customers
        </button>
        <button
          className="admin-button admin-button-primary"
          type="button"
          aria-pressed={activePanel === 'medicals'}
          onClick={() => setActivePanel((current) => current === 'medicals' ? null : 'medicals')}
          style={{ ...buttonStyle, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 8, background: activePanel === 'medicals' ? '#D4AF37' : 'linear-gradient(135deg, #11185A 0%, #1E2961 100%)', color: activePanel === 'medicals' ? '#11185A' : '#FFFFFF' }}
        >
          <Stethoscope size={18} />Medicals
        </button>
      </div>

      {activePanel === 'staff' ? <form className="admin-card" style={cardStyle} onSubmit={handleCreateStaff}>
        <div className="admin-card-title"><UserPlus size={18} />Manage Staff Users</div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>Name<input style={inputStyle} value={staffName} onChange={(event) => setStaffName(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>Email<input style={inputStyle} type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>
            Password
            <input style={inputStyle} type={showStaffPassword ? 'text' : 'password'} value={staffPassword} onChange={(event) => setStaffPassword(event.target.value)} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#D7DEEA', fontSize: 12, marginTop: 8 }}>
              <input type="checkbox" checked={showStaffPassword} onChange={(event) => setShowStaffPassword(event.target.checked)} />
              Show password while creating
            </span>
          </label>
          <label style={{ fontWeight: 800 }}>
            Role
            <select style={inputStyle} value={staffRole} onChange={(event) => setStaffRole(event.target.value as Extract<UserRole, 'Admin' | 'Staff'>)}>
              <option value="Staff">Staff</option>
              <option value="Admin">Admin</option>
            </select>
          </label>
          {staffRole === 'Staff' ? <label style={{ fontWeight: 800 }}>
            Assigned Shop
            <select style={inputStyle} required value={staffShopId} onChange={(event) => setStaffShopId(event.target.value as ShopId | '')}>
              <option value="">Select shop</option>
              {SHOP_OPTIONS.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
            </select>
          </label> : null}
        </div>
        <button className="admin-button admin-button-primary" type="submit" disabled={saving} style={{ ...buttonStyle, background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', color: '#FFFFFF', marginTop: 16 }}>
          <UserPlus size={16} />Create User
        </button>
      </form> : null}

      {activePanel === 'customers' ? <form className="admin-card" style={cardStyle} onSubmit={handleCreateCustomerLogin}>
        <div className="admin-card-title"><KeyRound size={18} />Create Customer Login</div>
        <div style={{ color: '#D7DEEA', marginBottom: 12 }}>Admin creates customer credentials and links them to an existing customer record. Existing passwords cannot be shown later; use reset email if a user forgets it.</div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>
            Link Customer
            <select style={inputStyle} value={customerLoginId} onChange={(event) => setCustomerLoginId(event.target.value)}>
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)} - {customer.branchId || 'Branch not selected'}</option>
              ))}
            </select>
          </label>
          <label style={{ fontWeight: 800 }}>Login Email<input style={inputStyle} type="email" value={customerLoginEmail} onChange={(event) => setCustomerLoginEmail(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>
            Password
            <input style={inputStyle} type={showCustomerLoginPassword ? 'text' : 'password'} value={customerLoginPassword} onChange={(event) => setCustomerLoginPassword(event.target.value)} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#D7DEEA', fontSize: 12, marginTop: 8 }}>
              <input type="checkbox" checked={showCustomerLoginPassword} onChange={(event) => setShowCustomerLoginPassword(event.target.checked)} />
              Show password while creating
            </span>
          </label>
        </div>
        <button className="admin-button admin-button-gold" type="submit" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A', marginTop: 16 }}>
          <KeyRound size={16} />Create Customer Login
        </button>
      </form> : null}

      {activePanel === 'medicals' ? <form className="admin-card" style={cardStyle} onSubmit={handleCreateMedicalLogin}>
        <div className="admin-card-title"><Stethoscope size={18} />Create Medical Login</div>
        <div style={{ color: '#D7DEEA', marginBottom: 12 }}>A Medical login is another type of customer login. It uses the linked customer's branch, invoices, payments, follow-ups, Salesapp sync, and other customer features. Existing passwords cannot be shown later; use reset email if a user forgets it.</div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>
            Link Customer
            <select style={inputStyle} value={medicalLoginId} onChange={(event) => setMedicalLoginId(event.target.value)}>
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)} - {customer.branchId || 'Branch not selected'}</option>
              ))}
            </select>
          </label>
          <label style={{ fontWeight: 800 }}>Login Email<input style={inputStyle} type="email" value={medicalLoginEmail} onChange={(event) => setMedicalLoginEmail(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>
            Password
            <input style={inputStyle} type={showMedicalLoginPassword ? 'text' : 'password'} value={medicalLoginPassword} onChange={(event) => setMedicalLoginPassword(event.target.value)} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#D7DEEA', fontSize: 12, marginTop: 8 }}>
              <input type="checkbox" checked={showMedicalLoginPassword} onChange={(event) => setShowMedicalLoginPassword(event.target.checked)} />
              Show password while creating
            </span>
          </label>
        </div>
        <button className="admin-button admin-button-gold" type="submit" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A', marginTop: 16 }}>
          <Stethoscope size={16} />Create Medical Login
        </button>
      </form> : null}

      {activePanel ? <div className="admin-card" style={cardStyle}>
        <div className="admin-card-title"><Users size={18} />{activePanel === 'staff' ? 'Existing Staff & Admins' : activePanel === 'customers' ? 'Existing Customers' : 'Existing Medicals'}</div>
        <div style={{ color: '#D7DEEA', marginBottom: 12 }}>For forgotten passwords, send a Firebase reset email. Passwords are not stored in readable form and cannot be shown after creation.</div>
        {renderTable(
          ['Name', 'Email', 'Role', 'Shop', 'Linked Customer', 'Active', 'Actions'],
          <>
            {(activePanel === 'staff' ? sortedStaffUsers : activePanel === 'customers' ? sortedCustomerUsers : sortedMedicalUsers).map((user) => (
              <tr className="admin-table-row" key={user.id}>
                <td style={cellStyle}>{user.name}</td>
                <td style={cellStyle}>{user.email}</td>
                <td style={cellStyle}><strong>{user.role === 'customer' ? 'Customer' : user.role}</strong></td>
                <td style={cellStyle}>
                  {user.role === 'Staff' ? (
                    <select
                      aria-label={`Assigned shop for ${user.name}`}
                      disabled={saving}
                      value={user.shopId ?? ''}
                      onChange={(event) => void handleStaffShopChange(user, event.target.value as ShopId)}
                      style={{ width: 150, boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #D8DEE9', background: '#FFFFFF', color: '#11185A', fontWeight: 800 }}
                    >
                      <option value="" disabled>Assign shop</option>
                      {SHOP_OPTIONS.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
                    </select>
                  ) : '-'}
                </td>
                <td style={cellStyle}>{user.customerName || '-'}</td>
                <td style={cellStyle}><span className={user.active ? 'admin-status active' : 'admin-status inactive'}>{user.active ? 'Yes' : 'No'}</span></td>
                <td style={cellStyle}>
                  <button className="admin-button admin-button-soft" type="button" disabled={saving} style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginRight: 8 }} onClick={() => handleSendPasswordReset(user)}>
                    <Mail size={15} />Reset Password
                  </button>
                  <button className="admin-button admin-button-soft" type="button" disabled={saving || user.uid === userProfile?.uid || user.email === userProfile?.email} style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginRight: 8 }} onClick={() => handleToggleUserActive(user)}>
                    {user.active ? 'Disable' : 'Enable'}
                  </button>
                  {user.role !== 'Admin' ? (
                    <button className="admin-button admin-button-danger" type="button" disabled={saving} style={{ ...buttonStyle, background: '#B42318', color: '#FFFFFF' }} onClick={() => handleDeleteUserAccess(user)}>
                      <UserMinus size={15} />Remove Access
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </>
        )}
      </div> : null}

    </div>
  );
};

export default Admin;
