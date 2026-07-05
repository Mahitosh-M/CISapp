import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { createCustomerAuthAccount, createStaffAuthAccount, sendUserPasswordResetEmail } from '../services/authService';
import {
  deleteUserProfileRecord,
  getUserProfiles,
  updateUserProfileRecord,
} from '../services/firestoreService';
import { useErpData } from '../hooks/useErpData';
import type { UserProfile, UserRole } from '../types';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';

const Admin = () => {
  const { customers, loading, error } = useErpData();
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [staffRole, setStaffRole] = useState<UserRole>('Staff');
  const [customerLoginId, setCustomerLoginId] = useState('');
  const [customerLoginEmail, setCustomerLoginEmail] = useState('');
  const [customerLoginPassword, setCustomerLoginPassword] = useState('');
  const [showCustomerLoginPassword, setShowCustomerLoginPassword] = useState(false);
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
      const userRows = await getUserProfiles();
      setUsers(userRows);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to load admin data.');
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const sortedUsers = useMemo(() => sortNewestFirst(users, ['updatedAt', 'createdAt']), [users]);
  const isAdmin = userProfile?.role === 'Admin';

  const handleCreateStaff = async (event: FormEvent) => {
    event.preventDefault();

    const cleanName = staffName.trim();
    const cleanEmail = staffEmail.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !staffPassword) {
      setAdminError('Name, email, and password are required.');
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      setMessage('');
      await createStaffAuthAccount(cleanEmail, staffPassword, cleanName, staffRole);
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

  const handleUserRoleChange = async (user: UserProfile, role: UserRole) => {
    await updateUserProfileRecord(user.id, { role }, auditUser);
    await loadAdminData();
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
      setAdminError('You cannot delete your own active admin login.');
      return;
    }

    const confirmed = window.confirm(`Delete ERP access for ${user.email}? This removes the app user profile. You can recreate access with the same email by using that email's current password, or send a password reset first.`);

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      await deleteUserProfileRecord(user.id, auditUser);
      setMessage(`ERP access deleted for ${user.email}. To reuse this email, create access again with the current password or send a password reset first.`);
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to delete user access.');
    } finally {
      setSaving(false);
    }
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
    <>
      <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
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
    <div>
      <SectionHeader title="Admin" description="Manage staff and user access." />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {adminError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{adminError}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <form style={cardStyle} onSubmit={handleCreateStaff}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Manage Staff Users</div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>Name<input style={inputStyle} value={staffName} onChange={(event) => setStaffName(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>Email<input style={inputStyle} type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>
            Password
            <input style={inputStyle} type={showStaffPassword ? 'text' : 'password'} value={staffPassword} onChange={(event) => setStaffPassword(event.target.value)} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#67738E', fontSize: 12, marginTop: 8 }}>
              <input type="checkbox" checked={showStaffPassword} onChange={(event) => setShowStaffPassword(event.target.checked)} />
              Show password while creating
            </span>
          </label>
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

      <form style={cardStyle} onSubmit={handleCreateCustomerLogin}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Create Customer Login</div>
        <div style={{ color: '#67738E', marginBottom: 12 }}>Admin creates customer credentials and links them to an existing customer record. Existing passwords cannot be shown later; use reset email if a user forgets it.</div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>
            Link Customer
            <select style={inputStyle} value={customerLoginId} onChange={(event) => setCustomerLoginId(event.target.value)}>
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name} - {customer.mobile}</option>
              ))}
            </select>
          </label>
          <label style={{ fontWeight: 800 }}>Login Email<input style={inputStyle} type="email" value={customerLoginEmail} onChange={(event) => setCustomerLoginEmail(event.target.value)} /></label>
          <label style={{ fontWeight: 800 }}>
            Password
            <input style={inputStyle} type={showCustomerLoginPassword ? 'text' : 'password'} value={customerLoginPassword} onChange={(event) => setCustomerLoginPassword(event.target.value)} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#67738E', fontSize: 12, marginTop: 8 }}>
              <input type="checkbox" checked={showCustomerLoginPassword} onChange={(event) => setShowCustomerLoginPassword(event.target.checked)} />
              Show password while creating
            </span>
          </label>
        </div>
        <button type="submit" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A', marginTop: 16 }}>Create Customer Login</button>
      </form>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Existing Users</div>
        <div style={{ color: '#67738E', marginBottom: 12 }}>For forgotten passwords, send a Firebase reset email. Passwords are not stored in readable form and cannot be shown after creation.</div>
        {renderTable(
          ['Name', 'Email', 'Role', 'Linked Customer', 'Active', 'Actions'],
          <>
            {sortedUsers.map((user) => (
              <tr key={user.id}>
                <td style={cellStyle}>{user.name}</td>
                <td style={cellStyle}>{user.email}</td>
                <td style={cellStyle}>
                  <select style={inputStyle} value={user.role} onChange={(event) => handleUserRoleChange(user, event.target.value as UserRole)}>
                    <option value="Staff">Staff</option>
                    <option value="Admin">Admin</option>
                    <option value="customer">Customer</option>
                  </select>
                </td>
                <td style={cellStyle}>{user.customerName || '-'}</td>
                <td style={cellStyle}>{user.active ? 'Yes' : 'No'}</td>
                <td style={cellStyle}>
                  <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginRight: 8 }} onClick={() => handleSendPasswordReset(user)}>
                    Reset Password
                  </button>
                  <button type="button" disabled={saving || user.uid === userProfile?.uid || user.email === userProfile?.email} style={{ ...buttonStyle, background: '#B42318', color: '#FFFFFF' }} onClick={() => handleDeleteUserAccess(user)}>
                    Delete User
                  </button>
                </td>
              </tr>
            ))}
          </>
        )}
      </div>

    </div>
  );
};

export default Admin;
