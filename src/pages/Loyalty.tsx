import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import ExternalImage from '../components/ExternalImage';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import {
  createOffer,
  createRewardItem,
  deleteGiftHistoryRecord,
  deleteOfferRecord,
  deleteRewardItemRecord,
  getAppSettings,
  getGiftHistory,
  getOffers,
  getRedemptionRequests,
  getRewardItems,
  markRedemptionRequestGifted,
  removeRedemptionApproval,
  reviewRedemptionRequest,
  updateAppSettings,
  updateOfferRecord,
  updateRewardItemRecord
} from '../services/firestoreService';
import type { AppSettings, GiftHistory, Offer, OfferFormData, PartnerLevel, RedemptionRequest, RewardFormData, RewardItem } from '../types';
import { formatDate, formatMoney } from '../utils/formatters';
import { PARTNER_LEVELS } from '../utils/loyalty';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getOfferDateRangeLabel, isOfferCurrentlyActive, sortOffersByLatest } from '../utils/offers';
import { DEFAULT_SETTINGS, mergeWithDefaultSettings, validateAppSettings } from '../utils/settings';

const emptyRewardForm: RewardFormData = {
  name: '',
  requiredPoints: 0,
  levelRequired: 'Active Partner',
  isActive: true,
  description: '',
  imageUrl: '',
  imagePath: ''
};

const emptyOfferForm: OfferFormData = {
  title: '',
  description: '',
  imageUrl: '',
  imagePath: '',
  levelRequired: 'Active Partner',
  startDate: '',
  endDate: '',
  isActive: true
};

const Loyalty = () => {
  const { userProfile } = useAuth();
  const isAdmin = userProfile?.role === 'Admin';
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [requests, setRequests] = useState<RedemptionRequest[]>([]);
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [rewardForm, setRewardForm] = useState<RewardFormData>(emptyRewardForm);
  const [offerForm, setOfferForm] = useState<OfferFormData>(emptyOfferForm);
  const [editingRewardId, setEditingRewardId] = useState('');
  const [editingOfferId, setEditingOfferId] = useState('');
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
      const [appSettings, rewardRows, offerRows, requestRows, historyRows] = await Promise.all([
        getAppSettings(),
        getRewardItems(),
        getOffers(),
        getRedemptionRequests(),
        getGiftHistory()
      ]);
      setSettings(mergeWithDefaultSettings(appSettings));
      setRewards(rewardRows);
      setOffers(offerRows);
      setRequests(requestRows);
      setGiftHistory(historyRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load loyalty data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sortedRewards = useMemo(() => sortNewestFirst(rewards, ['updatedAt', 'createdAt']), [rewards]);
  const sortedOffers = useMemo(() => sortOffersByLatest(offers), [offers]);
  const sortedRequests = useMemo(() => sortNewestFirst(requests.filter((request) => request.status !== 'Gifted'), ['requestedAt']), [requests]);
  const sortedGiftHistory = useMemo(() => sortNewestFirst(giftHistory, ['giftGivenDate', 'giftedDate', 'updatedAt', 'createdAt']), [giftHistory]);

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
      resetRewardForm();
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
      description: reward.description || '',
      imageUrl: reward.imageUrl || '',
      imagePath: reward.imagePath || ''
    });
  };

  const resetRewardForm = () => {
    setRewardForm({ ...emptyRewardForm });
    setEditingRewardId('');
  };

  const deleteReward = async (reward: RewardItem) => {
    if (!isAdmin) return;
    const confirmed = window.confirm(`Delete reward ${reward.name}?`);
    if (!confirmed) return;

    try {
      setSaving(true);
      setError('');
      await deleteRewardItemRecord(reward.id, auditUser);
      if (editingRewardId === reward.id) {
        resetRewardForm();
      }
      setMessage('Reward deleted.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete reward.');
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

  const resetOfferForm = () => {
    setOfferForm({ ...emptyOfferForm });
    setEditingOfferId('');
  };

  const saveOffer = async (event: FormEvent) => {
    event.preventDefault();
    if (!isAdmin) return;

    if (!offerForm.title.trim()) {
      setError('Offer title is required.');
      return;
    }

    if (offerForm.startDate && offerForm.endDate && offerForm.startDate > offerForm.endDate) {
      setError('Offer start date cannot be after end date.');
      return;
    }

    try {
      setSaving(true);
      setError('');

      if (editingOfferId) {
        await updateOfferRecord(editingOfferId, offerForm, auditUser);
        setMessage('Offer updated.');
      } else {
        await createOffer(offerForm, auditUser);
        setMessage('Offer added.');
      }

      resetOfferForm();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save offer.');
    } finally {
      setSaving(false);
    }
  };

  const editOffer = (offer: Offer) => {
    setEditingOfferId(offer.id);
    setOfferForm({
      title: offer.title,
      description: offer.description || '',
      imageUrl: offer.imageUrl || '',
      imagePath: offer.imagePath || '',
      levelRequired: offer.levelRequired || 'Active Partner',
      startDate: offer.startDate || '',
      endDate: offer.endDate || '',
      isActive: offer.isActive
    });
    setError('');
    setMessage('');
  };

  const toggleOffer = async (offer: Offer) => {
    if (!isAdmin) return;

    try {
      setSaving(true);
      setError('');
      await updateOfferRecord(
        offer.id,
        {
          title: offer.title,
          description: offer.description || '',
          imageUrl: offer.imageUrl || '',
          imagePath: offer.imagePath || '',
          levelRequired: offer.levelRequired || 'Active Partner',
          startDate: offer.startDate || '',
          endDate: offer.endDate || '',
          isActive: !offer.isActive
        },
        auditUser
      );
      setMessage(offer.isActive ? 'Offer deactivated.' : 'Offer activated.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update offer.');
    } finally {
      setSaving(false);
    }
  };

  const deleteOffer = async (offer: Offer) => {
    if (!isAdmin) return;

    const confirmed = window.confirm(`Delete offer "${offer.title}"?`);
    if (!confirmed) return;

    try {
      setSaving(true);
      setError('');
      await deleteOfferRecord(offer.id, auditUser);
      if (editingOfferId === offer.id) {
        resetOfferForm();
      }
      setMessage('Offer deleted.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete offer.');
    } finally {
      setSaving(false);
    }
  };

  const deleteGiftHistory = async (gift: GiftHistory) => {
    if (!isAdmin) return;
      const confirmed = window.confirm(`Delete reward record for ${gift.customerName}?`);
    if (!confirmed) return;

    try {
      setSaving(true);
      setError('');
      await deleteGiftHistoryRecord(gift.id, auditUser);
      setMessage('Reward history record deleted.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete reward history.');
    } finally {
      setSaving(false);
    }
  };

  const reviewRequest = async (request: RedemptionRequest, status: 'Approved' | 'Rejected') => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setError('');
      await reviewRedemptionRequest(request.id, status, auditUser);
      setMessage(status === 'Rejected' ? 'Redemption rejected and removed.' : 'Redemption approved.');
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

  const removeApproval = async (request: RedemptionRequest) => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setError('');
      await removeRedemptionApproval(request.id, auditUser);
      setMessage('Redemption approval removed.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove approval.');
    } finally {
      setSaving(false);
    }
  };

  const markRequestGifted = async (request: RedemptionRequest) => {
    if (!isAdmin) return;
    try {
      setSaving(true);
      setError('');
      await markRedemptionRequestGifted(request.id, auditUser);
      setMessage('Reward marked gifted and moved to reward history.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to mark reward gifted.');
    } finally {
      setSaving(false);
    }
  };

  const offerImagePreviewSource = offerForm.imageUrl;
  const rewardImagePreviewSource = rewardForm.imageUrl;

  if (loading) {
    return <SectionHeader title="Partner Program" description="Loading loyalty module..." />;
  }

  return (
    <div>
      <SectionHeader title="Partner Program" description="Manage PC points, partner levels, rewards, and redemption approvals." />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      {isAdmin ? (
        <form style={cardStyle} onSubmit={saveSettings}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Loyalty Settings</div>
          <div style={gridStyle}>
            <label style={{ fontWeight: 800 }}>New customer bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.newCustomerBonus} onChange={(event) => updateLoyaltyNumber('newCustomerBonus', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>Payment bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.paymentBonus} onChange={(event) => updateLoyaltyNumber('paymentBonus', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>Purchase target bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.purchaseTargetBonus} onChange={(event) => updateLoyaltyNumber('purchaseTargetBonus', event.target.value)} /></label>
            <label style={{ fontWeight: 800 }}>Referral bonus<input style={inputStyle} type="number" min="0" value={settings.loyaltySettings.referralBonus} onChange={(event) => updateLoyaltyNumber('referralBonus', event.target.value)} /></label>
          </div>
          <button type="submit" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A', marginTop: 16 }}>
            {saving ? 'Saving...' : 'Save Loyalty Settings'}
          </button>
        </form>
      ) : null}

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>{editingOfferId ? 'Edit Offer' : 'Create Offer'}</div>
        <div style={{ color: '#67738E', marginBottom: 12 }}>
          Active offers appear in the customer popup and Offers carousel. Inactive offers stay saved but are hidden from customers.
        </div>
        {isAdmin ? (
          <form onSubmit={saveOffer}>
            <div style={gridStyle}>
              <label style={{ fontWeight: 800 }}>
                Title
                <input style={inputStyle} value={offerForm.title} onChange={(event) => handleOfferFieldChange('title', event.target.value)} />
              </label>
              <label style={{ fontWeight: 800 }}>
                Image URL fallback
                <input style={inputStyle} value={offerForm.imageUrl} onChange={(event) => handleOfferFieldChange('imageUrl', event.target.value)} />
                <span style={{ display: 'block', color: '#67738E', fontSize: 12, marginTop: 6 }}>
                  Optional poster image URL shown in the customer offer popup and carousel.
                </span>
              </label>
              <label style={{ fontWeight: 800 }}>
                Level Required
                <select style={inputStyle} value={offerForm.levelRequired} onChange={(event) => handleOfferFieldChange('levelRequired', event.target.value)}>
                  {PARTNER_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
                <span style={{ display: 'block', color: '#67738E', fontSize: 12, marginTop: 6 }}>
                  This level and higher can see it.
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
            {offerImagePreviewSource ? (
              <div style={{ marginTop: 14, border: '1px solid #E8EDF4', borderRadius: 14, padding: 12 }}>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
                  Image preview
                </div>
                <ExternalImage
                  src={offerImagePreviewSource}
                  alt="Offer preview"
                  style={{ width: '100%', maxWidth: 300, height: 170, objectFit: 'cover', borderRadius: 12, display: 'block' }}
                />
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
              <button type="submit" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
                {saving ? 'Saving...' : editingOfferId ? 'Update Offer' : 'Add Offer'}
              </button>
              {editingOfferId ? (
                <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetOfferForm}>
                  Cancel
                </button>
              ) : null}
              {editingOfferId ? (
                <button
                  type="button"
                  disabled={saving}
                  style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }}
                  onClick={() => {
                    const offer = offers.find((item) => item.id === editingOfferId);
                    if (offer) void deleteOffer(offer);
                  }}
                >
                  Delete Offer
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        <div style={{ color: '#D4AF37', fontWeight: 900, margin: '18px 0 12px' }}>Offers</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={{ ...tableStyle, minWidth: 940 }}>
            <thead><tr>{['Title', 'Description', 'Level', 'Validity', 'Status', 'Customer Visible', 'Image', 'Actions'].map((header) => <th key={header} style={thStyle}>{header}</th>)}</tr></thead>
            <tbody>
              {sortedOffers.length === 0 ? (
                <tr><td style={tdStyle} colSpan={8}>No offers created yet.</td></tr>
              ) : sortedOffers.map((offer) => {
                const visibleToCustomers = isOfferCurrentlyActive(offer);

                return (
                  <tr key={offer.id}>
                    <td style={tdStyle}><strong>{offer.title}</strong></td>
                    <td style={tdStyle}>{offer.description || '-'}</td>
                    <td style={tdStyle}>{offer.levelRequired || 'Active Partner'}</td>
                    <td style={tdStyle}>{getOfferDateRangeLabel(offer)}</td>
                    <td style={{ ...tdStyle, color: offer.isActive ? '#1B7F3A' : '#B42318', fontWeight: 900 }}>{offer.isActive ? 'Active' : 'Inactive'}</td>
                    <td style={{ ...tdStyle, color: visibleToCustomers ? '#1B7F3A' : '#67738E', fontWeight: 900 }}>
                      {visibleToCustomers ? 'Visible' : 'Hidden'}
                    </td>
                    <td style={tdStyle}>{offer.imageUrl ? 'URL' : 'No'}</td>
                    <td style={tdStyle}>
                      {isAdmin ? (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF' }} onClick={() => editOffer(offer)}>
                            Edit
                          </button>
                          <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={() => toggleOffer(offer)}>
                            {offer.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => deleteOffer(offer)}>
                            Delete
                          </button>
                        </div>
                      ) : 'View only'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Reward Catalogue</div>
        {isAdmin ? (
          <>
            <div style={gridStyle}>
              <label style={{ fontWeight: 800 }}>Reward Name<input style={inputStyle} value={rewardForm.name} onChange={(event) => setRewardForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label style={{ fontWeight: 800 }}>Required Points<input style={inputStyle} type="number" min="0" value={rewardForm.requiredPoints} onChange={(event) => setRewardForm((current) => ({ ...current, requiredPoints: Number(event.target.value) || 0 }))} /></label>
              <label style={{ fontWeight: 800 }}>
                Level Required
                <select style={inputStyle} value={rewardForm.levelRequired} onChange={(event) => setRewardForm((current) => ({ ...current, levelRequired: event.target.value as PartnerLevel }))}>{PARTNER_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}</select>
                <span style={{ display: 'block', color: '#67738E', fontSize: 12, marginTop: 6 }}>This level and higher can see it.</span>
              </label>
              <label style={{ fontWeight: 800 }}>Status<select style={inputStyle} value={rewardForm.isActive ? 'active' : 'inactive'} onChange={(event) => setRewardForm((current) => ({ ...current, isActive: event.target.value === 'active' }))}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
              <label style={{ fontWeight: 800 }}>
                Image URL fallback
                <input style={inputStyle} value={rewardForm.imageUrl} onChange={(event) => setRewardForm((current) => ({ ...current, imageUrl: event.target.value }))} />
              </label>
              <label style={{ fontWeight: 800 }}>Description<input style={inputStyle} value={rewardForm.description} onChange={(event) => setRewardForm((current) => ({ ...current, description: event.target.value }))} /></label>
            </div>
            {rewardImagePreviewSource ? (
              <div style={{ marginTop: 14, border: '1px solid #E8EDF4', borderRadius: 14, padding: 12 }}>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>
                  Image preview
                </div>
                <ExternalImage
                  src={rewardImagePreviewSource}
                  alt="Reward preview"
                  style={{ width: '100%', maxWidth: 300, height: 170, objectFit: 'cover', borderRadius: 12, display: 'block' }}
                />
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, marginBottom: 16 }}>
              <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={saveReward}>{editingRewardId ? 'Update Reward' : 'Add Reward'}</button>
              {editingRewardId ? <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={resetRewardForm}>Cancel</button> : null}
              {editingRewardId ? (
                <button
                  type="button"
                  disabled={saving}
                  style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }}
                  onClick={() => {
                    const reward = rewards.find((item) => item.id === editingRewardId);
                    if (reward) void deleteReward(reward);
                  }}
                >
                  Delete Reward
                </button>
              ) : null}
            </div>
          </>
        ) : null}
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead><tr>{['Actions', 'Image', 'Reward', 'Points', 'Level', 'Status', 'Description'].map((header) => <th key={header} style={thStyle}>{header}</th>)}</tr></thead>
            <tbody>
              {sortedRewards.length === 0 ? (
                <tr><td style={tdStyle} colSpan={7}>No rewards created yet.</td></tr>
              ) : sortedRewards.map((reward) => (
                <tr key={reward.id}>
                  <td style={tdStyle}>
                    {isAdmin ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF' }} onClick={() => editReward(reward)}>Edit</button>
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => deleteReward(reward)}>Delete</button>
                      </div>
                    ) : 'View only'}
                  </td>
                  <td style={tdStyle}>
                    {reward.imageUrl ? (
                      <ExternalImage src={reward.imageUrl} alt={reward.name} style={{ width: 72, height: 52, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                    ) : 'No image'}
                  </td>
                  <td style={tdStyle}>{reward.name}</td>
                  <td style={tdStyle}>{reward.requiredPoints}</td>
                  <td style={tdStyle}>{reward.levelRequired}</td>
                  <td style={tdStyle}>{reward.isActive ? 'Active' : 'Inactive'}</td>
                  <td style={tdStyle}>{reward.description || '-'}</td>
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
                    ) : isAdmin && request.status === 'Approved' ? (
                      <>
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginRight: 8, marginBottom: 8 }} onClick={() => removeApproval(request)}>Remove Approval</button>
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }} onClick={() => markRequestGifted(request)}>Gifted</button>
                      </>
                    ) : 'No action'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Reward History</div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={{ ...tableStyle, minWidth: 980 }}>
            <thead>
              <tr>
                {['Customer', 'Partner Level', 'Status', 'Available PC Points', 'Reward', 'Redeemed Date', 'Approved By', 'Notes', 'Action'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedGiftHistory.length === 0 ? (
                <tr><td style={tdStyle} colSpan={9}>No reward history yet.</td></tr>
              ) : (
                sortedGiftHistory.map((gift) => (
                  <tr key={gift.id}>
                    <td style={tdStyle}>{gift.customerName}</td>
                    <td style={tdStyle}><TierBadge tier={gift.tierAtGiftTime} /></td>
                    <td style={tdStyle}>{gift.status === 'Given' ? 'Redeemed' : gift.status}</td>
                    <td style={tdStyle}>{formatMoney(gift.suggestedGiftBudget)}</td>
                    <td style={tdStyle}>{gift.selectedGiftItemName || gift.giftItem || '-'}</td>
                    <td style={tdStyle}>{gift.giftGivenDate ? formatDate(gift.giftGivenDate) : '-'}</td>
                    <td style={tdStyle}>{gift.approvedBy || '-'}</td>
                    <td style={tdStyle}>{gift.notes || '-'}</td>
                    <td style={tdStyle}>
                      {isAdmin ? (
                        <button type="button" disabled={saving} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => deleteGiftHistory(gift)}>
                          Delete
                        </button>
                      ) : 'View only'}
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

export default Loyalty;
