import { NavLink, Outlet, useOutletContext } from 'react-router-dom';
import { Bell, FileText, Home, Tags, User, WalletCards } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerPortalData } from '../hooks/useCustomerPortalData';
import type { CustomerPortalData } from '../hooks/useCustomerPortalData';

const navItems = [
  { to: '/customer', label: 'Dashboard', icon: Home, end: true },
  { to: '/customer/invoices', label: 'Invoices', icon: FileText },
  { to: '/customer/payments', label: 'Payments', icon: WalletCards },
  { to: '/customer/offers', label: 'Offers', icon: Tags },
  { to: '/customer/profile', label: 'Profile', icon: User }
];

const CustomerMobileLayout = () => {
  const portalData = useCustomerPortalData();
  const { logout } = useAuth();
  const [dismissedOfferId, setDismissedOfferId] = useState('');
  const latestOffer = portalData.offers[0];

  const storageKey = useMemo(() => {
    return latestOffer && portalData.userProfile ? `customer-offer-seen:${portalData.userProfile.uid}:${latestOffer.id}` : '';
  }, [latestOffer, portalData.userProfile]);

  useEffect(() => {
    if (!storageKey) return;
    setDismissedOfferId(localStorage.getItem(storageKey) || '');
  }, [storageKey]);

  const shouldShowOffer = latestOffer && storageKey && dismissedOfferId !== latestOffer.id;

  const closeOffer = () => {
    if (!latestOffer || !storageKey) return;
    localStorage.setItem(storageKey, latestOffer.id);
    setDismissedOfferId(latestOffer.id);
  };

  if (portalData.loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B1F3A', color: '#D4AF37', fontWeight: 900 }}>Loading your account...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#EEF2F7', color: '#0B1F3A', maxWidth: 460, margin: '0 auto', position: 'relative' }}>
      <header style={{ background: '#0B1F3A', color: '#FFFFFF', padding: '18px 18px 24px', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 18 }}>Customer Portal</div>
            <div style={{ color: '#DDE6F2', marginTop: 4, fontSize: 13 }}>{portalData.customer?.name || portalData.userProfile?.customerName || portalData.userProfile?.email}</div>
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

      <nav style={{ position: 'fixed', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: '100%', maxWidth: 460, background: '#FFFFFF', borderTop: '1px solid #D8DEE9', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', padding: '8px 6px 10px', boxShadow: '0 -12px 24px rgba(11,31,58,0.12)' }}>
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

      {shouldShowOffer ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,31,58,0.62)', display: 'grid', placeItems: 'center', padding: 18, zIndex: 20 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 22, padding: 18, maxWidth: 360, width: '100%', color: '#0B1F3A' }}>
            <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 8 }}>Latest Offer</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{latestOffer.title}</div>
            {latestOffer.imageUrl ? <img src={latestOffer.imageUrl} alt={latestOffer.title} style={{ width: '100%', borderRadius: 14, marginTop: 12 }} /> : null}
            <button type="button" onClick={closeOffer} style={{ width: '100%', border: 0, borderRadius: 14, background: '#0B1F3A', color: '#FFFFFF', padding: 12, fontWeight: 900, marginTop: 14 }}>
              Continue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const useCustomerPortalContext = () => useOutletContext<CustomerPortalData>();

export default CustomerMobileLayout;
