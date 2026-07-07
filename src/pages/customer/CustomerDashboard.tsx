import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Coins, ShoppingCart, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatMoney } from '../../utils/formatters';
import { calculateCustomerTotalOutstanding, isCurrentMonth } from '../../utils/customerPortal';
import { formatApc } from '../../utils/loyalty';
import { getBusinessInvoices } from '../../utils/openingBalance';

const StatTile = ({ title, value, icon, color = '#0B1F3A' }: { title: string; value: string; icon: JSX.Element; color?: string }) => (
  <div style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <div>
        <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>{title}</div>
        <div style={{ color, fontWeight: 900, fontSize: 18, marginTop: 5 }}>{value}</div>
      </div>
      <div style={{ width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', background: '#FFF7D6', color: '#0B1F3A' }}>{icon}</div>
    </div>
  </div>
);

const CustomerDashboard = () => {
  const { customer, invoices, invoiceViews, apcSummary, bonusPcRequests } = useCustomerPortalContext();
  const navigate = useNavigate();
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const currentMonthInvoices = getBusinessInvoices(invoices).filter((invoice) => isCurrentMonth(invoice.date));
  const currentMonthPurchases = currentMonthInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
  const totalOutstanding = customer?.totalOutstandingAmount ?? calculateCustomerTotalOutstanding(customer, invoiceViews);
  const overdueInvoices = invoiceViews.filter((invoice) => invoice.outstandingAmount > 0 && invoice.daysRemaining < 0);
  const overdueAmount = overdueInvoices.reduce((sum, invoice) => sum + invoice.outstandingAmount, 0);
  const currentMonthBonusRequests = bonusPcRequests.filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)));
  const currentMonthBonusPc = currentMonthBonusRequests.reduce((sum, request) => sum + request.approvedCoins, 0);

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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <StatTile title="Month Purchases" value={formatMoney(currentMonthPurchases)} icon={<ShoppingCart size={20} />} />
        <StatTile title="PC Balance" value={formatApc(apcSummary?.apcBalance ?? 0)} icon={<Wallet size={20} />} color="#166534" />
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

      <div style={{ background: '#0B1F3A', color: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 12 }}>
        <div style={{ color: '#D4AF37', fontWeight: 900 }}>Total</div>
        <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{formatMoney(totalOutstanding)}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, color: overdueInvoices.length > 0 ? '#FCA5A5' : '#BFC8D9' }}>
          <AlertTriangle size={17} />
          {overdueInvoices.length} overdue invoice(s), {formatMoney(overdueAmount)}
        </div>
      </div>

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
