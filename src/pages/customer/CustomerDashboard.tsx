import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Coins, Gift, ReceiptText, Sparkles, Trophy, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatDate, formatMoney } from '../../utils/formatters';
import { calculateCustomerTotalOutstanding, calculateInvoiceApcInfo, getInvoiceFullPaymentDate, isCurrentMonth } from '../../utils/customerPortal';
import { formatApc } from '../../utils/loyalty';
import { getBusinessInvoices, getInvoiceDisplayNumber } from '../../utils/openingBalance';

type PcHistoryFilter = 'all' | 'purchase' | 'bonus' | 'overdue';

interface PcHistoryItem {
  id: string;
  type: Exclude<PcHistoryFilter, 'all'>;
  title: string;
  detail: string;
  points: number;
  date: string;
}

const CustomerDashboard = () => {
  const { customer, invoices, payments, settings, invoiceViews, apcSummary, bonusPcRequests, overduePcRequests } = useCustomerPortalContext();
  const navigate = useNavigate();
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showPcHistory, setShowPcHistory] = useState(false);
  const [pcHistoryFilter, setPcHistoryFilter] = useState<PcHistoryFilter>('all');
  const totalOutstanding = customer?.totalOutstandingAmount ?? calculateCustomerTotalOutstanding(customer, invoiceViews);
  const overdueInvoices = invoiceViews.filter((invoice) => invoice.outstandingAmount > 0 && invoice.daysRemaining < 0);
  const overdueAmount = overdueInvoices.reduce((sum, invoice) => sum + invoice.outstandingAmount, 0);
  const currentMonthBonusRequests = bonusPcRequests.filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)));
  const currentMonthBonusPc = currentMonthBonusRequests.reduce((sum, request) => sum + request.approvedCoins, 0);
  const pcProgressPercent = apcSummary?.progressPercent ?? 0;
  const currentMonthPcHistory: PcHistoryItem[] = [
    ...(customer
      ? getBusinessInvoices(invoices)
          .map((invoice): PcHistoryItem | undefined => {
            const pcInfo = calculateInvoiceApcInfo(invoice, payments, customer.tier, settings);
            const fullPaymentDate = getInvoiceFullPaymentDate(invoice, payments);

            if (pcInfo.earnedApc <= 0 || !fullPaymentDate || !isCurrentMonth(fullPaymentDate)) return undefined;

            return {
              id: `purchase-${invoice.id}`,
              type: 'purchase',
              title: `Invoice ${getInvoiceDisplayNumber(invoice)}`,
              detail: `On-time payment credited on ${formatDate(fullPaymentDate)}`,
              points: pcInfo.earnedApc,
              date: fullPaymentDate
            };
          })
          .filter((item): item is PcHistoryItem => Boolean(item))
      : []),
    ...currentMonthBonusRequests.map((request): PcHistoryItem => ({
      id: `bonus-${request.id}`,
      type: 'bonus',
      title: request.bonusLabel,
      detail: request.notes || `Approved on ${formatDate((request.reviewedAt || request.generatedAt).slice(0, 10))}`,
      points: request.approvedCoins,
      date: (request.reviewedAt || request.generatedAt).slice(0, 10)
    })),
    ...overduePcRequests
      .filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)))
      .map((request): PcHistoryItem => ({
        id: `overdue-${request.id}`,
        type: 'overdue',
        title: `Overdue PC: ${request.invoiceNumber}`,
        detail: `Approved on ${formatDate((request.reviewedAt || request.generatedAt).slice(0, 10))}`,
        points: request.approvedCoins,
        date: (request.reviewedAt || request.generatedAt).slice(0, 10)
      }))
  ].filter((item) => item.points > 0).sort((left, right) => right.date.localeCompare(left.date));
  const currentMonthTotalPc = currentMonthPcHistory.reduce((sum, item) => sum + item.points, 0);
  const visiblePcHistory = pcHistoryFilter === 'all' ? currentMonthPcHistory : currentMonthPcHistory.filter((item) => item.type === pcHistoryFilter);
  const pcHistoryFilters: { key: PcHistoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'purchase', label: 'Purchase' },
    { key: 'bonus', label: 'Bonus' },
    { key: 'overdue', label: 'Overdue' }
  ];

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
          <button
            type="button"
            onClick={() => setShowPcHistory((current) => !current)}
            style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer' }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(212,175,55,0.16)', color: '#FDE68A', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900 }}>
              <Sparkles size={14} />
              Available PC
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
              <div style={{ color: '#FDE68A', fontSize: 38, fontWeight: 900, lineHeight: 1 }}>{formatApc(apcSummary?.apcBalance ?? 0)}</div>
              <div style={{ color: '#DDE6F2', fontWeight: 900 }}>PC</div>
            </div>
            <div style={{ color: '#DDE6F2', fontSize: 11, fontWeight: 900, marginTop: 5 }}>{showPcHistory ? 'Hide monthly history' : 'Tap for monthly history'}</div>
            <div style={{ color: '#BFC8D9', fontSize: 12, fontWeight: 800, marginTop: 5 }}>
              {apcSummary?.nextLevel ? `${formatApc(apcSummary.pointsNeededForNextLevel)} PC to ${apcSummary.nextLevel}` : 'Highest partner level reached'}
            </div>
          </button>
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

      {showPcHistory ? (
        <section style={{ background: '#FFFFFF', borderRadius: 20, padding: 15, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ color: '#D4AF37', fontWeight: 900 }}>This Month PC History</div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginTop: 3 }}>All Partner Coins credited this month</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#166534', fontSize: 22, fontWeight: 900 }}>+{formatApc(currentMonthTotalPc)}</div>
              <div style={{ color: '#67738E', fontSize: 11, fontWeight: 900 }}>PC earned</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
            {pcHistoryFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setPcHistoryFilter(filter.key)}
                style={{
                  border: 0,
                  borderRadius: 999,
                  background: pcHistoryFilter === filter.key ? '#0B1F3A' : '#EEF2F7',
                  color: pcHistoryFilter === filter.key ? '#FFFFFF' : '#0B1F3A',
                  padding: '8px 11px',
                  fontSize: 12,
                  fontWeight: 900,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer'
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {visiblePcHistory.length === 0 ? (
            <div style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 14, padding: 12, color: '#67738E', fontSize: 13, fontWeight: 800 }}>
              No PC credits in this category for the current month.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 9, maxHeight: 250, overflowY: 'auto', paddingRight: 3 }}>
              {visiblePcHistory.map((item) => {
                const Icon = item.type === 'purchase' ? ReceiptText : item.type === 'bonus' ? Trophy : AlertTriangle;
                const iconBackground = item.type === 'purchase' ? '#EAF7EE' : item.type === 'bonus' ? '#FFF7D6' : '#FDECEC';
                const iconColor = item.type === 'purchase' ? '#166534' : item.type === 'bonus' ? '#0B1F3A' : '#B42318';

                return (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid #E8EDF4',
                      borderRadius: 16,
                      background: '#FFFFFF',
                      padding: 11,
                      display: 'grid',
                      gridTemplateColumns: '42px 1fr auto',
                      alignItems: 'center',
                      gap: 10
                    }}
                  >
                    <div style={{ width: 42, height: 42, borderRadius: 14, background: iconBackground, color: iconColor, display: 'grid', placeItems: 'center' }}>
                      <Icon size={20} />
                    </div>
                    <div>
                      <div style={{ color: '#0B1F3A', fontSize: 13, fontWeight: 900 }}>{item.title}</div>
                      <div style={{ color: '#67738E', fontSize: 11, fontWeight: 800, marginTop: 3 }}>{item.detail}</div>
                    </div>
                    <div style={{ color: '#166534', fontSize: 16, fontWeight: 900 }}>+{formatApc(item.points)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <div style={{ background: '#0B1F3A', color: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 12 }}>
        <div style={{ color: '#D4AF37', fontWeight: 900 }}>Total Outstanding</div>
        <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{formatMoney(totalOutstanding)}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, color: overdueInvoices.length > 0 ? '#FCA5A5' : '#BFC8D9' }}>
          <AlertTriangle size={17} />
          {overdueInvoices.length} overdue invoice(s), {formatMoney(overdueAmount)}
        </div>
      </div>

      {(customer?.advanceBalance ?? 0) > 0 ? (
        <div style={{ background: '#ECFDF3', color: '#166534', border: '1px solid #BBE7C8', borderRadius: 20, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}>Available Advance</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 5 }}>{formatMoney(customer?.advanceBalance ?? 0)}</div>
          <div style={{ color: '#477A58', fontSize: 12, fontWeight: 800, marginTop: 5 }}>Automatically adjusted on your next invoice.</div>
        </div>
      ) : null}

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
