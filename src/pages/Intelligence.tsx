import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Gauge, RefreshCw, Trophy, Users } from 'lucide-react';
import CustomerScoreCard from '../components/CustomerScoreCard';
import SectionHeader from '../components/SectionHeader';
import SectionTileNav from '../components/SectionTileNav';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { getIntelligenceSummariesPage, type IntelligencePageCursor } from '../services/derivedDataService';
import { buildIntelligenceSummary } from '../utils/customerAnalytics';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle } from '../utils/listDisplay';
import type { CustomerScore } from '../types';

type IntelligenceSection = 'overview' | 'score' | 'rankings';

const intelligenceSections = [
  { id: 'overview', label: 'Top Customers', icon: Users },
  { id: 'score', label: 'Score Breakdown', icon: Gauge },
  { id: 'rankings', label: 'Stored Rankings', icon: Trophy }
] satisfies { id: IntelligenceSection; label: string; icon: typeof Users }[];

const Intelligence = () => {
  const { userProfile } = useAuth();
  const [customerScores, setCustomerScores] = useState<CustomerScore[]>([]);
  const [pageCursor, setPageCursor] = useState<IntelligencePageCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isMobile = useIsMobile();
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [activeSection, setActiveSection] = useState<IntelligenceSection | null>(null);
  const summary = useMemo(() => buildIntelligenceSummary(customerScores), [customerScores]);
  const formatWholeOrders = (value: number) => String(Math.round(value));
  const isStaff = userProfile?.role === 'Staff';
  const selectedCustomerScore = customerScores.find((customer) => customer.customerId === selectedCustomerId);
  const storedRanking = useMemo(() => customerScores.map((score) => ({
    customerId: score.customerId,
    customerName: score.customerName,
    customerArea: score.customerArea,
    rank: score.rank,
    tier: score.tier,
    intelligenceScore: score.intelligenceScore,
    totalSales: score.totalSales,
    totalProfit: score.totalProfit,
    giftBudget: score.giftBudget
  })), [customerScores]);

  const loadSummaries = async (append = false) => {
    try {
      setLoading(true);
      setError('');
      const page = await getIntelligenceSummariesPage(append ? pageCursor : undefined);
      setCustomerScores((current) => append ? [...current, ...page.rows] : page.rows);
      setPageCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load stored intelligence summaries.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummaries(false);
  }, []);

  const topCustomers = customerScores;

  const metricGridStyle: CSSProperties = {
    display: 'grid',
    gap: 18,
    gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(210px, 1fr))',
    marginBottom: 24
  };

  const panelGridStyle: CSSProperties = {
    display: 'grid',
    gap: 18,
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
    marginBottom: 24
  };

  const scoreCardGridStyle: CSSProperties = {
    display: 'grid',
    gap: 18,
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
    marginBottom: 24
  };

  const panelStyle: CSSProperties = {
    background: '#102645',
    borderRadius: 18,
    padding: 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.16)'
  };

  const whiteCardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 16,
    padding: 18,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
    gap: isMobile ? 6 : 14,
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '12px 0'
  };

  const mutedTextStyle: CSSProperties = {
    color: '#BFC8D9',
    fontSize: 13,
    marginTop: 4
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#11185A'
  };

  const renderCustomerRow = (
    customer: CustomerScore,
    value: string,
    helper: string,
    valueColor = '#D4AF37'
  ) => (
    <div key={customer.customerId} style={rowStyle}>
      <div>
        <div style={{ fontWeight: 800 }}>{formatCustomerSelectLabel(customer)}</div>
        <div style={mutedTextStyle}>{helper}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ color: valueColor, fontWeight: 800 }}>{value}</div>
        <TierBadge tier={customer.tier} />
      </div>
    </div>
  );

  const renderCustomerListPanel = (
    title: string,
    rows: CustomerScore[],
    emptyMessage: string,
    renderRow: (customer: CustomerScore) => JSX.Element
  ) => (
    <div style={panelStyle}>
      <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ color: '#BFC8D9', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
      {rows.length === 0 ? (
        <div style={{ color: '#BFC8D9' }}>{emptyMessage}</div>
      ) : (
        <div style={latestFiveScrollStyle}>
          {rows.map(renderRow)}
        </div>
      )}
    </div>
  );

  if (loading) {
    return <SectionHeader title="Customer Intelligence" description="Loading Firestore intelligence data..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Customer Intelligence"
        description="Rolling 2-month customer ranking, partner level assignment, overdue status, and PC points from Firestore."
      />
      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

      <SectionTileNav
        items={intelligenceSections.filter((section) => !isStaff || section.id !== 'rankings')}
        activeId={activeSection}
        onSelect={setActiveSection}
      />

      {hasMore ? (
        <button
          type="button"
          onClick={() => loadSummaries(true)}
          disabled={loading}
          style={{ border: 0, borderRadius: 6, padding: '9px 12px', display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, fontWeight: 800, cursor: 'pointer' }}
        >
          <RefreshCw size={16} /> Load more customers
        </button>
      ) : null}

      {activeSection === 'overview' ? <>
      {!isStaff ? (
        <div style={{ color: '#BFC8D9', fontSize: 13, marginBottom: 14 }}>
          Score uses the last 60 days; PC is calculated separately. Overdue or new customers may be capped even if their score is high.
        </div>
      ) : null}

      {!isStaff ? (
        <div style={metricGridStyle}>
          <StatCard title="Average Score" value={`${summary.averageScore}`} subtitle="Weighted score" />
          <StatCard title="Partner Coin" value={`${formatMoney(summary.giftBudget)} PC`} subtitle="Mapped from available PC rules" />
        </div>
      ) : null}

      {isStaff ? (
        <div style={{ marginBottom: 24 }}>
          {renderCustomerListPanel(
            'Top Customers',
            topCustomers,
            'Add Firestore invoices to generate customer rankings.',
            (customer) =>
              renderCustomerRow(
                customer,
                `#${customer.rank}`,
                `Score ${customer.intelligenceScore} | Sales ${formatMoney(customer.customerMonthlySales)} / ${formatMoney(customer.monthlySalesTarget)} | Orders ${formatWholeOrders(customer.customerMonthlyOrders)} / ${formatWholeOrders(customer.monthlyOrderTarget)}`
              )
          )}
        </div>
      ) : (
        <div style={panelGridStyle}>
          {renderCustomerListPanel(
            'Top Customers',
            topCustomers,
            'Add Firestore invoices to generate customer rankings.',
            (customer) =>
              renderCustomerRow(
                customer,
                `#${customer.rank}`,
                `Score ${customer.intelligenceScore} | Sales ${formatMoney(customer.customerMonthlySales)} / ${formatMoney(customer.monthlySalesTarget)} | Orders ${formatWholeOrders(customer.customerMonthlyOrders)} / ${formatWholeOrders(customer.monthlyOrderTarget)}`
              )
          )}
        </div>
      )}
      </> : null}

      {activeSection === 'score' ? <>
      <SectionHeader
        title="Score Breakdown"
        description="Select a customer to load only that customer's score details on screen."
      />
      <div style={{ ...whiteCardStyle, marginBottom: 24 }}>
        <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Select Customer</div>
        <select style={inputStyle} value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
          <option value="">Select customer</option>
          {customerScores.map((customer) => (
            <option key={customer.customerId} value={customer.customerId}>{formatCustomerSelectLabel(customer)}</option>
          ))}
        </select>
        {selectedCustomerScore ? (
          <div style={{ ...scoreCardGridStyle, marginTop: 18, marginBottom: 0 }}>
            <CustomerScoreCard customer={selectedCustomerScore} />
          </div>
        ) : (
          <div style={{ color: '#D7DEEA', marginTop: 12 }}>Select a customer to view score breakdown.</div>
        )}
      </div>
      </> : null}

      {!isStaff && activeSection === 'rankings' ? (
        <>
          <SectionHeader
            title="Stored Rankings"
            description="Latest rolling 2-month scores stored after customer transaction changes."
          />
            <div style={panelGridStyle}>
              <div style={panelStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ color: '#D4AF37', fontWeight: 800 }}>Latest stored ranking</div>
                      <div style={mutedTextStyle}>Updated only for affected customers</div>
                    </div>
                    <div style={{ color: '#BFC8D9', fontWeight: 700 }}>{storedRanking.length} ranked</div>
                  </div>

                  {storedRanking.length === 0 ? (
                    <div style={{ color: '#BFC8D9' }}>No invoice activity for this ranking period.</div>
                  ) : (
                    <div style={latestFiveScrollStyle}>
                      {storedRanking.map((ranking) => (
                        <div key={ranking.customerId} style={rowStyle}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{formatCustomerSelectLabel(ranking)}</div>
                            <div style={mutedTextStyle}>
                              {formatMoney(ranking.totalSales)} sales | {formatMoney(ranking.giftBudget)} PC
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ color: '#D4AF37', fontWeight: 800 }}>#{ranking.rank}</div>
                            <div style={{ color: '#BFC8D9', fontSize: 13 }}>Score {ranking.intelligenceScore}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
        </>
      ) : null}
    </div>
  );
};

export default Intelligence;
