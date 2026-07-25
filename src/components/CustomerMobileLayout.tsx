import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { CalendarDays, Coins, FileText, Gift, Home, ShoppingCart, Sparkles, Tags, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ExternalImage from './ExternalImage';
import InstallAppPrompt from './InstallAppPrompt';
import { useCustomerPortalData } from '../hooks/useCustomerPortalData';
import type { CustomerPortalData } from '../hooks/useCustomerPortalData';
import { markBonusPcRequestSeen } from '../services/firestoreService';
import { getLatestUnreadOffer, getOfferDateRangeLabel, markOfferAsViewed } from '../utils/offers';
import { formatApc } from '../utils/loyalty';
import { getTierDisplayName } from '../utils/tiers';

const navItems = [
  { to: '/customer', label: 'Dashboard', icon: Home, end: true },
  { to: '/customer/invoices', label: 'Invoices', icon: FileText },
  { to: '/customer/partner-points', label: 'Rewards', icon: Gift },
  { to: '/customer/offers', label: 'Offers', icon: Tags }
];

const getPcBalanceStorageKey = (userId?: string, customerId?: string) =>
  `customerPcBalanceSeen_${userId || customerId || 'customerPortal'}`;

const ORDER_APP_URL = 'https://orderapp-35200.web.app';

const CustomerMobileLayout = () => {
  const portalData = useCustomerPortalData();
  const { logout, role } = useAuth();
  const navigate = useNavigate();
  const [viewedOfferVersion, setViewedOfferVersion] = useState(0);
  const [viewedBonusVersion, setViewedBonusVersion] = useState(0);
  const [pcBalancePopup, setPcBalancePopup] = useState<{ change: number; balance: number } | null>(null);
  const customerHeading = (portalData.customer?.name || portalData.userProfile?.customerName || portalData.userProfile?.email || 'Customer').toUpperCase();
  const customerPartnerLevel = getTierDisplayName(portalData.customer?.tier);
  const pcBalance = portalData.apcSummary?.apcBalance ?? 0;
  const pcBalanceStorageKey = getPcBalanceStorageKey(portalData.userProfile?.uid, portalData.customer?.id);

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
    setPcBalancePopup(null);
  }, [portalData.userProfile?.uid]);

  useEffect(() => {
    if (portalData.loading || !portalData.apcSummary) return;

    try {
      const storedBalance = window.localStorage.getItem(pcBalanceStorageKey);

      if (storedBalance === null) {
        window.localStorage.setItem(pcBalanceStorageKey, String(pcBalance));
        return;
      }

      const previousBalance = Number(storedBalance);
      if (!Number.isFinite(previousBalance) || previousBalance === pcBalance || pcBalancePopup) return;

      setPcBalancePopup({ change: pcBalance - previousBalance, balance: pcBalance });
    } catch {
      // If localStorage is unavailable, the customer portal still works without the once-only popup.
    }
  }, [pcBalance, pcBalancePopup, pcBalanceStorageKey, portalData.apcSummary, portalData.loading]);

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

  const openOrderApp = () => {
    const orderUrl = new URL(ORDER_APP_URL);
    orderUrl.searchParams.set('name', customerHeading);
    orderUrl.searchParams.set('role', 'customer');
    orderUrl.searchParams.set('area', portalData.customer?.area || '');
    orderUrl.searchParams.set('returnUrl', window.location.href);
    window.open(orderUrl.toString(), '_blank', 'noopener,noreferrer');
  };

  const closeBonus = async () => {
    if (!latestUnreadBonus) return;

    await markBonusPcRequestSeen(latestUnreadBonus.id);
    setViewedBonusVersion((current) => current + 1);
    await portalData.refreshData();
  };

  const closePcBalancePopup = () => {
    try {
      window.localStorage.setItem(pcBalanceStorageKey, String(pcBalance));
    } catch {
      // Ignore storage failures; the popup can still close for this session.
    }

    setPcBalancePopup(null);
  };

  if (portalData.loading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0B1F3A', color: '#D4AF37', fontWeight: 900 }}>Loading your account...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#EEF2F7', color: '#0B1F3A', maxWidth: 460, margin: '0 auto', position: 'relative' }}>
      <header style={{ background: '#0B1F3A', color: '#FFFFFF', padding: '18px 18px 24px', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={openOrderApp} style={{ border: 0, borderRadius: 12, background: '#D4AF37', color: '#0B1F3A', padding: '9px 12px', fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <ShoppingCart size={16} />
              Order
            </button>
          <div style={{ textAlign: 'center', minWidth: 0 }}>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 18, overflowWrap: 'anywhere' }}>{customerHeading}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, background: '#D4AF37', color: '#0B1F3A', borderRadius: 999, padding: '6px 11px', fontSize: 12, fontWeight: 900, boxShadow: '0 8px 18px rgba(212,175,55,0.24)', letterSpacing: 0 }}>
              <span>{customerPartnerLevel}</span>
            </div>
          </div>
            <button type="button" onClick={logout} style={{ border: 0, borderRadius: 12, background: '#FFFFFF', color: '#0B1F3A', padding: '9px 12px', fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              Logout
            </button>
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

      <InstallAppPrompt disabled={role !== 'customer' || Boolean(pcBalancePopup || latestUnreadBonus || latestUnreadOffer)} />

      {pcBalancePopup ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,31,58,0.72)', display: 'grid', placeItems: 'center', padding: 18, zIndex: 40 }}>
          <style>
            {`
              @keyframes customerPcPopupIn {
                0% { opacity: 0; transform: translateY(18px) scale(0.94); }
                100% { opacity: 1; transform: translateY(0) scale(1); }
              }
              @keyframes customerPcCoinPulse {
                0% { transform: scale(0.9) rotate(-4deg); filter: brightness(1); }
                40% { transform: scale(1.08) rotate(2deg); filter: brightness(1.18); }
                100% { transform: scale(1) rotate(0deg); filter: brightness(1); }
              }
              @keyframes customerPcFloat {
                0% { opacity: 0; transform: translate(-50%, 12px) scale(0.9); }
                18% { opacity: 1; transform: translate(-50%, 0) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -46px) scale(1.08); }
              }
              @keyframes customerPcSpark {
                0%, 100% { opacity: 0.2; transform: scale(0.8) rotate(0deg); }
                45% { opacity: 1; transform: scale(1.22) rotate(16deg); }
              }
            `}
          </style>
          <div style={{ background: 'linear-gradient(145deg, #0B1F3A 0%, #12345A 100%)', border: '1px solid rgba(212,175,55,0.32)', borderRadius: 24, padding: 20, maxWidth: 360, width: '100%', color: '#FFFFFF', boxShadow: '0 24px 50px rgba(11,31,58,0.34)', textAlign: 'center', animation: 'customerPcPopupIn 260ms ease-out' }}>
            <div style={{ width: 132, height: 132, margin: '0 auto 14px', position: 'relative', display: 'grid', placeItems: 'center' }}>
              <div style={{ width: 122, height: 122, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 34% 27%, #FFFBE8 0 10%, #FDE68A 28%, #D4AF37 62%, #8A5A00 100%)', border: '6px solid #F8E7A3', boxShadow: 'inset 0 0 0 4px rgba(138,90,0,0.42), 0 16px 30px rgba(212,175,55,0.36)', animation: 'customerPcCoinPulse 900ms ease-out' }}>
                <div style={{ width: 88, height: 88, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', color: '#4A3000', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 31, lineHeight: 1, fontWeight: 900 }}>{formatApc(pcBalancePopup.balance)}</div>
                    <div style={{ fontSize: 11, fontWeight: 900, marginTop: 5 }}>PC</div>
                  </div>
                </div>
              </div>
              <div style={{ position: 'absolute', left: '50%', top: -4, color: pcBalancePopup.change > 0 ? '#00E676' : '#FCA5A5', background: '#0B1F3A', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 900, boxShadow: '0 10px 18px rgba(0,0,0,0.25)', animation: 'customerPcFloat 1500ms ease-out forwards' }}>
                {pcBalancePopup.change > 0 ? '+' : '-'}{formatApc(Math.abs(pcBalancePopup.change))}
              </div>
              <Sparkles size={16} style={{ position: 'absolute', right: 4, top: 14, color: '#FFF7D6', animation: 'customerPcSpark 900ms ease-in-out infinite' }} />
              <Sparkles size={13} style={{ position: 'absolute', left: 6, bottom: 24, color: '#FDE68A', animation: 'customerPcSpark 900ms ease-in-out 140ms infinite' }} />
            </div>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 14, marginBottom: 6 }}>
              {pcBalancePopup.change > 0 ? 'Partner Coins Added' : 'Partner Coins Redeemed'}
            </div>
            <div style={{ fontWeight: 900, fontSize: 24, marginBottom: 8 }}>Your PC balance changed</div>
            <div style={{ color: '#D7DEEA', lineHeight: 1.5, fontSize: 14 }}>
              {pcBalancePopup.change > 0 ? 'Gold coins were added to your Available PC balance.' : 'A reward redemption changed your Available PC balance.'}
            </div>
            <button type="button" onClick={closePcBalancePopup} style={{ marginTop: 18, width: '100%', border: 0, borderRadius: 14, background: '#D4AF37', color: '#0B1F3A', padding: 13, fontWeight: 900 }}>
              View Dashboard
            </button>
          </div>
        </div>
      ) : latestUnreadBonus ? (
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
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#0B1F3A', color: '#FDE68A', borderRadius: 999, padding: '7px 11px', fontSize: 12, fontWeight: 900, marginTop: 12 }}>
              <CalendarDays size={14} color="#FDE68A" />
              Valid: {getOfferDateRangeLabel(latestUnreadOffer)}
            </div>
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
