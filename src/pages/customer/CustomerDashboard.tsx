import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Coins, Gift, Sparkles, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatMoney } from '../../utils/formatters';
import { calculateCustomerTotalOutstanding, isCurrentMonth } from '../../utils/customerPortal';
import { formatApc } from '../../utils/loyalty';

const CustomerDashboard = () => {
  const { customer, invoiceViews, apcSummary, bonusPcRequests } = useCustomerPortalContext();
  const navigate = useNavigate();
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const totalOutstanding = customer?.totalOutstandingAmount ?? calculateCustomerTotalOutstanding(customer, invoiceViews);
  const overdueInvoices = invoiceViews.filter((invoice) => invoice.outstandingAmount > 0 && invoice.daysRemaining < 0);
  const overdueAmount = overdueInvoices.reduce((sum, invoice) => sum + invoice.outstandingAmount, 0);
  const currentMonthBonusRequests = bonusPcRequests.filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)));
  const currentMonthBonusPc = currentMonthBonusRequests.reduce((sum, request) => sum + request.approvedCoins, 0);
  const pcProgressPercent = apcSummary?.progressPercent ?? 0;

  useEffect(() => {
    const markScrolled = () => {
      if (window.scrollY > 24) {
        hasScrolledRef.current = true;
      }
    };

    window.addEventListener('scroll', markScrolled, { passive: true });
    return () => window.removeEventListener('scroll', markScrolled);
  }, []);

  useEffect(() => {
    const sentinel = bottomSentinelRef.current;
    if (!sentinel) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || !hasScrolledRef.current || isTransitioning) return;

        setIsTransitioning(true);
        window.setTimeout(() => {
          navigate('/customer/invoices');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 220);
      },
      { threshold: 0.9 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isTransitioning, navigate]);

  return (
    <div style={{ opacity: isTransitioning ? 0 : 1, transform: isTransitioning ? 'translateY(-10px)' : 'translateY(0)', transition: 'opacity 220ms ease, transform 220ms ease' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#67738E', fontSize: 13, fontWeight: 800 }}>Welcome back</div>
      </div>

      <div
        style={{
          background: 'linear-gradient(135deg, #0B1F3A 0%, #173B66 58%, #0B1F3A 100%)',
          color: '#FFFFFF',
          borderRadius: 24,
          padding: 16,
          boxShadow: '0 18px 36px rgba(11,31,58,0.22)',
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ position: 'absolute', right: -22, top: -24, width: 110, height: 110, borderRadius: '50%', border: '18px solid rgba(212,175,55,0.16)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', position: 'relative' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(212,175,55,0.16)', color: '#FDE68A', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900 }}>
              <Sparkles size={14} />
              Partner Coin Wallet
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
              <div style={{ color: '#FDE68A', fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{formatApc(apcSummary?.apcBalance ?? 0)}</div>
              <div style={{ color: '#DDE6F2', fontWeight: 900 }}>PC</div>
            </div>
            <div style={{ color: '#BFC8D9', fontSize: 12, fontWeight: 800, marginTop: 5 }}>
              {apcSummary?.nextLevel ? `${formatApc(apcSummary.pointsNeededForNextLevel)} PC to ${apcSummary.nextLevel}` : 'Highest partner level reached'}
            </div>
          </div>
          <div style={{ width: 76, height: 76, borderRadius: 24, background: '#FFF7D6', color: '#0B1F3A', display: 'grid', placeItems: 'center', boxShadow: '0 16px 28px rgba(0,0,0,0.20)', position: 'relative', flex: '0 0 auto' }}>
            <Wallet size={34} />
            <div style={{ position: 'absolute', right: -6, top: -7, width: 34, height: 34, borderRadius: '50%', background: '#D4AF37', border: '3px solid #0B1F3A', display: 'grid', placeItems: 'center' }}>
              <Coins size={18} />
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#DDE6F2', fontSize: 12, fontWeight: 900, marginBottom: 7 }}>
            <span>Next level progress</span>
            <span>{pcProgressPercent}%</span>
          </div>
          <div style={{ height: 12, borderRadius: 999, background: 'rgba(255,255,255,0.16)', overflow: 'hidden' }}>
            <div
              style={{
                width: `${pcProgressPercent}%`,
                height: '100%',
                borderRadius: 999,
                background: 'linear-gradient(90deg, #D4AF37 0%, #FDE68A 100%)',
                transition: 'width 420ms ease'
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/customer/partner-points')}
          style={{
            position: 'relative',
            marginTop: 14,
            width: '100%',
            border: 0,
            borderRadius: 16,
            background: '#D4AF37',
            color: '#0B1F3A',
            padding: '12px 14px',
            fontWeight: 900,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer'
          }}
        >
          <Gift size={18} />
          Explore Rewards
          <ArrowRight size={18} />
        </button>
      </div>

      <div style={{ background: '#0B1F3A', color: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 12 }}>
        <div style={{ color: '#D4AF37', fontWeight: 900 }}>Total Outstanding</div>
        <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{formatMoney(totalOutstanding)}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, color: overdueInvoices.length > 0 ? '#FCA5A5' : '#BFC8D9' }}>
          <AlertTriangle size={17} />
          {overdueInvoices.length} overdue invoice(s), {formatMoney(overdueAmount)}
        </div>
      </div>

      {currentMonthBonusPc > 0 ? (
        <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 15, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 12, border: '1px solid #F4DE91' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 46, height: 46, borderRadius: 16, background: '#FFF7D6', display: 'grid', placeItems: 'center', color: '#0B1F3A' }}>
              <Coins size={24} />
            </div>
            <div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>This Month Bonus Credit</div>
              <div style={{ color: '#166534', fontSize: 22, fontWeight: 900 }}>+{formatApc(currentMonthBonusPc)} PC</div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>
                {currentMonthBonusRequests.map((request) => request.bonusLabel).join(', ')}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={bottomSentinelRef}
        style={{
          minHeight: 80,
          display: 'grid',
          placeItems: 'center',
          color: '#67738E',
          fontSize: 12,
          fontWeight: 900
        }}
      >
        Scroll for all invoices
      </div>
    </div>
  );
};

export default CustomerDashboard;
