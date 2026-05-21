import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { createCustomerAuthAccount, createStaffAuthAccount, sendUserPasswordResetEmail } from '../services/authService';
import {
  createOffer,
  deleteUserProfileRecord,
  deleteOfferRecord,
  getAlerts,
  getGiftHistory,
  getOffers,
  getUserProfiles,
  updateAlertStatus,
  updateCustomerRecord,
  updateGiftHistoryRecord,
  updateOfferRecord,
  updateUserProfileRecord,
  upsertAlerts
} from '../services/firestoreService';
import { useErpData } from '../hooks/useErpData';
import { uploadOfferImage, validateOfferImageFile } from '../services/storageService';
import type { Alert, GiftHistory, Offer, OfferFormData, UserProfile, UserRole } from '../types';
import { buildOperationalAlerts } from '../utils/alertUtils';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { getTodayDateString } from '../utils/dateUtils';
import { formatDateRange, formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getOfferDateRangeLabel, isOfferCurrentlyActive, sortOffersByLatest } from '../utils/offers';
import { getPaymentTermsLabel } from '../utils/settings';

const emptyOfferForm: OfferFormData = {
  title: '',
  description: '',
  imageUrl: '',
  imagePath: '',
  startDate: '',
  endDate: '',
  isActive: true
};

const Admin = () => {
  const { customers, invoices, payments, settings, loading, error, refreshData } = useErpData();
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerForm, setOfferForm] = useState<OfferFormData>(emptyOfferForm);
  const [editingOfferId, setEditingOfferId] = useState('');
  const [selectedOfferImageFile, setSelectedOfferImageFile] = useState<File | null>(null);
  const [offerImagePreviewUrl, setOfferImagePreviewUrl] = useState('');
  const [offerImageError, setOfferImageError] = useState('');
  const [offerUploadProgress, setOfferUploadProgress] = useState(0);
  const [offerImageInputKey, setOfferImageInputKey] = useState(0);
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
      const [userRows, alertRows, giftRows, offerRows] = await Promise.all([
        getUserProfiles(),
        getAlerts(),
        getGiftHistory(),
        getOffers()
      ]);
      setUsers(userRows);
      setAlerts(alertRows);
      setGiftHistory(giftRows);
      setOffers(offerRows);
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to load admin data.');
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  useEffect(() => {
    if (!selectedOfferImageFile) {
      setOfferImagePreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedOfferImageFile);
    setOfferImagePreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedOfferImageFile]);

  const generatedAlerts = useMemo(() => buildOperationalAlerts(customers, invoices, payments, settings), [customers, invoices, payments, settings]);
  const openAlerts = alerts.filter((alert) => alert.status === 'Open');
  const pendingGifts = giftHistory.filter((gift) => gift.status !== 'Given');
  const tierOverrides = customers.filter((customer) => customer.tierOverride);
  const negativeProfitInvoices = invoices.filter((invoice) => invoice.totalProfit < 0);
  const sortedUsers = useMemo(() => sortNewestFirst(users, ['updatedAt', 'createdAt']), [users]);
  const sortedAlerts = useMemo(
    () => sortNewestFirst(
      // Resolved alerts remain in Firestore for history, but the active Admin list
      // should only show alerts that still need attention.
      alerts.filter((alert) => alert.status !== 'Resolved'),
      ['updatedAt', 'createdAt', 'date']
    ),
    [alerts]
  );
  const sortedPendingGifts = useMemo(() => sortNewestFirst(pendingGifts, ['giftGivenDate', 'giftedDate', 'updatedAt', 'createdAt']), [pendingGifts]);
  const sortedTierOverrides = useMemo(() => sortNewestFirst(tierOverrides, ['updatedAt', 'createdAt']), [tierOverrides]);
  const sortedOffers = useMemo(() => sortOffersByLatest(offers), [offers]);
  const isAdmin = userProfile?.role === 'Admin';

  const handleSyncAlerts = async () => {
    try {
      setSaving(true);

      // Auto-tier sync respects Admin overrides while activity log writes remain disabled.
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
          message: `${gift.customerName} has a pending gift for ${formatDateRange(gift.periodStart, gift.periodEnd)}.`
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
      await createStaffAuthAccount(staffEmail, staffPassword, staffName, staffRole);
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

    if (!linkedCustomer || !customerLoginEmail || !customerLoginPassword) {
      setAdminError('Customer, email, and password are required for customer login.');
      return;
    }

    try {
      setSaving(true);
      await createCustomerAuthAccount(customerLoginEmail, customerLoginPassword, linkedCustomer.id, linkedCustomer.name);
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

  const handleOfferFieldChange = (field: keyof OfferFormData, value: string | boolean) => {
    setOfferForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const clearSelectedImage = () => {
    setSelectedOfferImageFile(null);
    setOfferImageError('');
    setOfferUploadProgress(0);
    setOfferImageInputKey((current) => current + 1);
  };

  const handleImagePreview = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const validationError = validateOfferImageFile(selectedFile);
    if (validationError) {
      setOfferImageError(validationError);
      setSelectedOfferImageFile(null);
      setOfferUploadProgress(0);
      event.target.value = '';
      return;
    }

    setOfferImageError('');
    setOfferUploadProgress(0);
    setSelectedOfferImageFile(selectedFile);
  };

  const resetOfferForm = () => {
    setOfferForm({ ...emptyOfferForm });
    setEditingOfferId('');
    clearSelectedImage();
  };

  const handleSaveOffer = async (event: FormEvent) => {
    event.preventDefault();

    if (!isAdmin) {
      setAdminError('Only Admin users can manage offers.');
      return;
    }

    if (!offerForm.title.trim()) {
      setAdminError('Offer title is required.');
      return;
    }

    if (offerForm.startDate && offerForm.endDate && offerForm.startDate > offerForm.endDate) {
      setAdminError('Offer start date cannot be after end date.');
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      setOfferUploadProgress(0);
      let offerPayload = offerForm;

      if (selectedOfferImageFile) {
        // Upload selected offer image to Firebase Storage before saving Firestore offer metadata.
        const uploadedImage = await uploadOfferImage(selectedOfferImageFile, editingOfferId || undefined, setOfferUploadProgress);
        offerPayload = {
          ...offerForm,
          // Existing customer popup/carousel read this imageUrl field, so uploaded images appear automatically.
          imageUrl: uploadedImage.imageUrl,
          imagePath: uploadedImage.imagePath
        };
      }

      if (editingOfferId) {
        await updateOfferRecord(editingOfferId, offerPayload, auditUser);
        setMessage('Offer updated successfully.');
      } else {
        await createOffer(offerPayload, auditUser);
        setMessage('Offer created successfully.');
      }

      resetOfferForm();
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to save offer.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditOffer = (offer: Offer) => {
    setEditingOfferId(offer.id);
    setOfferForm({
      title: offer.title,
      description: offer.description || '',
      imageUrl: offer.imageUrl || '',
      imagePath: offer.imagePath || '',
      startDate: offer.startDate || '',
      endDate: offer.endDate || '',
      isActive: offer.isActive
    });
    clearSelectedImage();
    setAdminError('');
    setMessage('');
  };

  const handleToggleOffer = async (offer: Offer) => {
    if (!isAdmin) {
      setAdminError('Only Admin users can manage offers.');
      return;
    }

    await updateOfferRecord(
      offer.id,
      {
        title: offer.title,
        description: offer.description || '',
        imageUrl: offer.imageUrl || '',
        imagePath: offer.imagePath || '',
        startDate: offer.startDate || '',
        endDate: offer.endDate || '',
        isActive: !offer.isActive
      },
      auditUser
    );
    setMessage(offer.isActive ? 'Offer deactivated.' : 'Offer activated.');
    await loadAdminData();
  };

  const handleDeleteOffer = async (offer: Offer) => {
    if (!isAdmin) {
      setAdminError('Only Admin users can manage offers.');
      return;
    }

    const confirmed = window.confirm(`Delete offer "${offer.title}"?`);
    if (!confirmed) return;

    await deleteOfferRecord(offer.id, auditUser);
    setMessage('Offer deleted successfully.');
    if (editingOfferId === offer.id) {
      resetOfferForm();
    }
    await loadAdminData();
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

    const confirmed = window.confirm(`Delete ERP access for ${user.email}? This removes the app user profile. The Firebase Auth account itself must be removed from Firebase Console or a future Admin SDK function.`);

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      setAdminError('');
      await deleteUserProfileRecord(user.id, auditUser);
      setMessage(`ERP access deleted for ${user.email}. Firebase Auth password records are not exposed by the client app.`);
      await loadAdminData();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Unable to delete user access.');
    } finally {
      setSaving(false);
    }
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

  const offerImagePreviewSource = offerImagePreviewUrl || offerForm.imageUrl;

  if (loading) {
    return <SectionHeader title="Admin" description="Loading system health..." />;
  }

  return (
    <div>
      <SectionHeader title="Admin" description="Manage staff, alerts, gift approvals, tier overrides, and system health." />

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

      <form style={cardStyle} onSubmit={handleSaveOffer}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>{editingOfferId ? 'Edit Offer' : 'Create Offer'}</div>
        <div style={{ color: '#67738E', marginBottom: 12 }}>
          Admin-created active offers appear in the customer popup and Offers carousel. Inactive offers stay saved but are hidden from customers.
        </div>
        <div style={gridStyle}>
          <label style={{ fontWeight: 800 }}>
            Title
            <input style={inputStyle} value={offerForm.title} onChange={(event) => handleOfferFieldChange('title', event.target.value)} />
          </label>
          <label style={{ fontWeight: 800 }}>
            Image URL fallback
            <input style={inputStyle} value={offerForm.imageUrl} onChange={(event) => handleOfferFieldChange('imageUrl', event.target.value)} />
            <span style={{ display: 'block', color: '#67738E', fontSize: 12, marginTop: 6 }}>
              Optional manual URL. If you upload an image, the Firebase Storage download URL is saved here.
            </span>
          </label>
          <label style={{ fontWeight: 800 }}>
            Upload Image
            <input
              key={offerImageInputKey}
              style={inputStyle}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImagePreview}
            />
            <span style={{ display: 'block', color: '#67738E', fontSize: 12, marginTop: 6 }}>
              JPG, PNG, or WebP below 2 MB.
            </span>
          </label>
          <label style={{ fontWeight: 800 }}>
            Start Date
            <input style={inputStyle} type="date" value={offerForm.startDate} onChange={(event) => handleOfferFieldChange('startDate', event.target.value)} />
          </label>
          <label style={{ fontWeight: 800 }}>
            End Date
            <input style={inputStyle} type="date" value={offerForm.endDate} onChange={(event) => handleOfferFieldChange('endDate', event.target.value)} />
          </label>
          <label style={{ fontWeight: 800 }}>
            Status
            <select style={inputStyle} value={offerForm.isActive ? 'active' : 'inactive'} onChange={(event) => handleOfferFieldChange('isActive', event.target.value === 'active')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        {offerImageError ? <div style={{ color: '#B42318', marginTop: 12, fontWeight: 800 }}>{offerImageError}</div> : null}
        {offerImagePreviewSource ? (
          <div style={{ marginTop: 14, border: '1px solid #E8EDF4', borderRadius: 14, padding: 12 }}>
            <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
              {selectedOfferImageFile ? 'Selected image preview' : 'Current image preview'}
            </div>
            <img
              src={offerImagePreviewSource}
              alt="Offer preview"
              style={{ width: '100%', maxWidth: 360, height: 180, objectFit: 'cover', borderRadius: 12, display: 'block' }}
            />
            {selectedOfferImageFile ? (
              <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginTop: 10 }} onClick={clearSelectedImage}>
                Remove Selected Image
              </button>
            ) : null}
            {offerForm.imagePath ? (
              <div style={{ color: '#67738E', fontSize: 12, marginTop: 8 }}>
                Storage image is linked. Future improvement: add safe old-image deletion or compression when replacing images.
              </div>
            ) : null}
          </div>
        ) : null}
        {saving && selectedOfferImageFile ? (
          <div style={{ marginTop: 12, color: '#67738E', fontWeight: 800 }}>
            Uploading image: {offerUploadProgress}%
          </div>
        ) : null}
        <label style={{ display: 'block', fontWeight: 800, marginTop: 14 }}>
          Description
          <textarea
            style={{ ...inputStyle, minHeight: 76, resize: 'vertical' }}
            value={offerForm.description}
            onChange={(event) => handleOfferFieldChange('description', event.target.value)}
          />
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button type="submit" disabled={saving || !isAdmin} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
            {saving ? 'Saving...' : editingOfferId ? 'Update Offer' : 'Add Offer'}
          </button>
          {editingOfferId ? (
            <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetOfferForm}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Offers</div>
        {renderTable(
          ['Title', 'Description', 'Validity', 'Status', 'Customer Visible', 'Image', 'Actions'],
          <>
            {sortedOffers.length === 0 ? (
              <tr><td style={cellStyle} colSpan={7}>No offers created yet.</td></tr>
            ) : (
              sortedOffers.map((offer) => {
                const visibleToCustomers = isOfferCurrentlyActive(offer);

                return (
                  <tr key={offer.id}>
                    <td style={cellStyle}><strong>{offer.title}</strong></td>
                    <td style={cellStyle}>{offer.description || '-'}</td>
                    <td style={cellStyle}>{getOfferDateRangeLabel(offer)}</td>
                    <td style={{ ...cellStyle, color: offer.isActive ? '#1B7F3A' : '#B42318', fontWeight: 900 }}>{offer.isActive ? 'Active' : 'Inactive'}</td>
                    <td style={{ ...cellStyle, color: visibleToCustomers ? '#1B7F3A' : '#67738E', fontWeight: 900 }}>
                      {visibleToCustomers ? 'Visible' : 'Hidden'}
                    </td>
                    <td style={cellStyle}>{offer.imagePath ? 'Uploaded' : offer.imageUrl ? 'Manual URL' : 'No'}</td>
                    <td style={cellStyle}>
                      <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF', marginRight: 8, marginBottom: 8 }} onClick={() => handleEditOffer(offer)}>
                        Edit
                      </button>
                      <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginRight: 8, marginBottom: 8 }} onClick={() => handleToggleOffer(offer)}>
                        {offer.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleDeleteOffer(offer)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </>
        )}
      </div>

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

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Alerts</div>
        {renderTable(
          ['Customer', 'Type', 'Severity', 'Message', 'Status', 'Action'],
          <>
            {sortedAlerts.length === 0 ? (
              <tr><td style={cellStyle} colSpan={6}>No active alerts to review.</td></tr>
            ) : (
              sortedAlerts.map((alert) => (
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
            {sortedPendingGifts.length === 0 ? (
              <tr><td style={cellStyle} colSpan={7}>No pending gift approvals.</td></tr>
            ) : (
              sortedPendingGifts.map((gift) => (
                <tr key={gift.id}>
                  <td style={cellStyle}>{gift.customerName}</td>
                  <td style={cellStyle}><TierBadge tier={gift.tierAtGiftTime} /></td>
                  <td style={cellStyle}>{gift.status}</td>
                  <td style={cellStyle}>{formatDateRange(gift.periodStart, gift.periodEnd)}</td>
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
            {sortedTierOverrides.length === 0 ? (
              <tr><td style={cellStyle} colSpan={5}>No manual tier overrides active.</td></tr>
            ) : (
              sortedTierOverrides.map((customer) => (
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

    </div>
  );
};

export default Admin;
