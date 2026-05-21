import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { Bell, FileText, Home, Tags, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerPortalData } from '../hooks/useCustomerPortalData';
import type { CustomerPortalData } from '../hooks/useCustomerPortalData';
import { getLatestUnreadOffer, getOfferDateRangeLabel, markOfferAsViewed } from '../utils/offers';

const navItems = [
  { to: '/customer', label: 'Dashboard', icon: Home, end: true },
  { to: '/customer/invoices', label: 'Invoices', icon: FileText },
  { to: '/customer/payments', label: 'Payments', icon: WalletCards },
  { to: '/customer/offers', label: 'Offers', icon: Tags }
];

const CustomerMobileLayout = () => {
  const portalData = useCustomerPortalData();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [viewedOfferVersion, setViewedOfferVersion] = useState(0);
  const customerHeading = (portalData.customer?.name || portalData.userProfile?.customerName || portalData.userProfile?.email || 'Customer').toUpperCase();
  const customerTierNumber = portalData.customer?.tier ? portalData.customer.tier.replace(/^Tier\s*/i, '') : '-';

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
              <span>TIER</span>
              <span style={{ display: 'inline-grid', placeItems: 'center', minWidth: 22, height: 22, borderRadius: 999, background: '#0B1F3A', color: '#D4AF37', fontWeight: 900 }}>
                {customerTierNumber}
              </span>
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

      {latestUnreadOffer ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,31,58,0.62)', display: 'grid', placeItems: 'center', padding: 18, zIndex: 20 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 22, padding: 18, maxWidth: 360, width: '100%', color: '#0B1F3A', boxShadow: '0 24px 50px rgba(11,31,58,0.28)' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, background: '#FFF7D6', color: '#0B1F3A', padding: '5px 10px', fontSize: 12, fontWeight: 900, marginBottom: 10 }}>
              Active Offer
            </div>
            {latestUnreadOffer.imageUrl ? (
              <img loading="lazy" src={latestUnreadOffer.imageUrl} alt={latestUnreadOffer.title} style={{ width: '100%', borderRadius: 16, marginBottom: 14, maxHeight: 190, objectFit: 'cover' }} />
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
