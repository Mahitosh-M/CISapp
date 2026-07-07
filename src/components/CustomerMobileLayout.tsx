import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { Award, Bell, Coins, FileText, Home, Tags, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ExternalImage from './ExternalImage';
import { useCustomerPortalData } from '../hooks/useCustomerPortalData';
import type { CustomerPortalData } from '../hooks/useCustomerPortalData';
import { markBonusPcRequestSeen } from '../services/firestoreService';
import { getLatestUnreadOffer, getOfferDateRangeLabel, markOfferAsViewed } from '../utils/offers';
import { getTierDisplayName } from '../utils/tiers';

const navItems = [
  { to: '/customer', label: 'Dashboard', icon: Home, end: true },
  { to: '/customer/invoices', label: 'Invoices', icon: FileText },
  { to: '/customer/partner-points', label: 'Points', icon: Award },
  { to: '/customer/offers', label: 'Offers', icon: Tags }
];

const CustomerMobileLayout = () => {
  const portalData = useCustomerPortalData();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [viewedOfferVersion, setViewedOfferVersion] = useState(0);
  const [viewedBonusVersion, setViewedBonusVersion] = useState(0);
  const customerHeading = (portalData.customer?.name || portalData.userProfile?.customerName || portalData.userProfile?.email || 'Customer').toUpperCase();
  const customerPartnerLevel = getTierDisplayName(portalData.customer?.tier);

  const latestUnreadBonus = useMemo(() => {
    return [...portalData.bonusPcRequests]
      .filter((request) => request.status === 'Approved' && !request.customerSeenAt)
      .sort((left, right) => (right.reviewedAt || right.generatedAt).localeCompare(left.reviewedAt || left.generatedAt))[0];
  }, [portalData.bonusPcRequests, viewedBonusVersion]);

  const latestUnreadOffer = useMemo(() => {
    return getLatestUnreadOffer(portalData.offers, portalData.userProfile?.uid);
  }, [portalData.offers, portalData.userProfile?.uid, viewedOfferVersion]);

  useEffect(() => {
    setViewedOfferVersion((current) => current + 1);
  }, [portalData.userProfile?.uid]);

  const closeOffer = () => {
    if (!latestUnreadOffer) return;

    markOfferAsViewed(latestUnreadOffer.id, portalData.userProfile?.uid);
    setViewedOfferVersion((current) => current + 1);
  };

  const viewOffers = () => {
    if (!latestUnreadOffer) return;

    markOfferAsViewed(latestUnreadOffer.id, portalData.userProfile?.uid);
    setViewedOfferVersion((current) => current + 1);
    navigate('/customer/offers');
  };

  const closeBonus = async () => {
    if (!latestUnreadBonus) return;

    await markBonusPcRequestSeen(latestUnreadBonus.id);
    setViewedBonusVersion((current) => current + 1);
    await portalData.refreshData();
  };

  if (portalData.loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B1F3A', color: '#D4AF37', fontWeight: 900 }}>Loading your account...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#EEF2F7', color: '#0B1F3A', maxWidth: 460, margin: '0 auto', position: 'relative' }}>
      <header style={{ background: '#0B1F3A', color: '#FFFFFF', padding: '18px 18px 24px', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 18 }}>{customerHeading}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, background: '#D4AF37', color: '#0B1F3A', borderRadius: 999, padding: '6px 11px', fontSize: 12, fontWeight: 900, boxShadow: '0 8px 18px rgba(212,175,55,0.24)', letterSpacing: 0 }}>
              <span>{customerPartnerLevel}</span>
            </div>
          </div>
          <button type="button" onClick={logout} style={{ border: 0, borderRadius: 12, background: '#D4AF37', color: '#0B1F3A', padding: '9px 12px', fontWeight: 900 }}>
            Logout
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, color: '#DDE6F2', fontSize: 13 }}>
          <Bell size={16} color="#D4AF37" />
          Your purchases, payments, and due invoices only.
        </div>
      </header>

      <main style={{ padding: '16px 14px 96px' }}>
        {portalData.error ? <div style={{ background: '#FDECEC', color: '#7F1D1D', borderRadius: 14, padding: 12, marginBottom: 12 }}>{portalData.error}</div> : null}
        <Outlet context={portalData} />
      </main>

      <nav style={{ position: 'fixed', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: '100%', maxWidth: 460, background: '#FFFFFF', borderTop: '1px solid #D8DEE9', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', padding: '8px 6px 10px', boxShadow: '0 -12px 24px rgba(11,31,58,0.12)' }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                textDecoration: 'none',
                color: isActive ? '#0B1F3A' : '#67738E',
                background: isActive ? '#FFF7D6' : 'transparent',
                borderRadius: 14,
                padding: '8px 4px',
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 900
              })}
            >
              <Icon size={20} style={{ display: 'block', margin: '0 auto 3px' }} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {latestUnreadBonus ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,31,58,0.68)', display: 'grid', placeItems: 'center', padding: 18, zIndex: 30 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 24, padding: 20, maxWidth: 360, width: '100%', color: '#0B1F3A', boxShadow: '0 24px 50px rgba(11,31,58,0.30)', textAlign: 'center' }}>
            <div style={{ display: 'grid', placeItems: 'center', marginBottom: 12 }}>
              <div style={{ width: 92, height: 92, borderRadius: '50%', background: '#FFF7D6', display: 'grid', placeItems: 'center', boxShadow: '0 16px 30px rgba(212,175,55,0.32)', position: 'relative' }}>
                <Wallet size={42} color="#0B1F3A" />
                <div style={{ position: 'absolute', right: -2, top: -4, width: 36, height: 36, borderRadius: '50%', background: '#D4AF37', display: 'grid', placeItems: 'center', border: '3px solid #FFFFFF' }}>
                  <Coins size={21} color="#0B1F3A" />
                </div>
              </div>
            </div>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 14, marginBottom: 6 }}>Congratulations</div>
            <div style={{ fontWeight: 900, fontSize: 24, marginBottom: 8 }}>Partner Coins credited</div>
            <div style={{ color: '#166534', fontSize: 34, fontWeight: 900, marginBottom: 8 }}>+{latestUnreadBonus.approvedCoins} PC</div>
            <div style={{ color: '#4B5871', lineHeight: 1.5, fontSize: 14 }}>
              You received this bonus for: <strong>{latestUnreadBonus.bonusLabel}</strong>.
            </div>
            {latestUnreadBonus.notes ? (
              <div style={{ color: '#67738E', fontSize: 12, marginTop: 8 }}>{latestUnreadBonus.notes}</div>
            ) : null}
            <button type="button" onClick={closeBonus} style={{ marginTop: 18, width: '100%', border: 0, borderRadius: 14, background: '#D4AF37', color: '#0B1F3A', padding: 13, fontWeight: 900 }}>
              View My Dashboard
            </button>
          </div>
        </div>
      ) : latestUnreadOffer ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,31,58,0.62)', display: 'grid', placeItems: 'center', padding: 18, zIndex: 20 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 22, padding: 18, maxWidth: 360, width: '100%', color: '#0B1F3A', boxShadow: '0 24px 50px rgba(11,31,58,0.28)' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: '#FFF7D6', color: '#0B1F3A', padding: '5px 10px', fontSize: 12, fontWeight: 900, marginBottom: 10 }}>
              Active Offer
            </div>
            {latestUnreadOffer.imageUrl ? (
              <ExternalImage src={latestUnreadOffer.imageUrl} alt={latestUnreadOffer.title} style={{ width: '100%', borderRadius: 16, marginBottom: 14, maxHeight: 190, objectFit: 'cover' }} />
            ) : null}
            <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 8 }}>Latest Offer</div>
            <div style={{ fontWeight: 900, fontSize: 22 }}>{latestUnreadOffer.title}</div>
            {latestUnreadOffer.description ? <div style={{ color: '#4B5871', marginTop: 8, lineHeight: 1.5 }}>{latestUnreadOffer.description}</div> : null}
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 10 }}>Valid: {getOfferDateRangeLabel(latestUnreadOffer)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
              <button type="button" onClick={closeOffer} style={{ border: 0, borderRadius: 14, background: '#E8EDF4', color: '#0B1F3A', padding: 12, fontWeight: 900 }}>
                Close
              </button>
              <button type="button" onClick={viewOffers} style={{ border: 0, borderRadius: 14, background: '#D4AF37', color: '#0B1F3A', padding: 12, fontWeight: 900 }}>
                View Offers
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const useCustomerPortalContext = () => useOutletContext<CustomerPortalData>();

export default CustomerMobileLayout;
