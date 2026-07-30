import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import CustomerScoreCard from '../components/CustomerScoreCard';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildIntelligenceSummary, buildMonthlyRankings } from '../utils/customerAnalytics';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle } from '../utils/listDisplay';
import type { CustomerScore } from '../types';

const Intelligence = () => {
  const { userProfile } = useAuth();
  const { customers, invoices, payments, settings, customerScores, loading, error } = useErpData();
  const isMobile = useIsMobile();
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedRankingMonth, setSelectedRankingMonth] = useState('');
  const summary = useMemo(() => buildIntelligenceSummary(customerScores), [customerScores]);
  const formatWholeOrders = (value: number) => String(Math.round(value));
  const isStaff = userProfile?.role === 'Staff';
  const selectedCustomerScore = customerScores.find((customer) => customer.customerId === selectedCustomerId);
  const rankingMonthOptions = useMemo(() => {
    const referenceDate = new Date();
    return [0, 1].map((monthsAgo) => {
      const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - monthsAgo, 1);
      const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = monthStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

      return { monthKey, monthLabel };
    });
  }, []);
  const selectedMonthlyRanking = useMemo(() => {
    if (!selectedRankingMonth) return undefined;
    return buildMonthlyRankings(customers, invoices, payments, new Date(), settings)
      .find((month) => month.monthKey === selectedRankingMonth);
  }, [customers, invoices, payments, selectedRankingMonth, settings]);

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
        <div style={{ fontWeight: 800 }}>{customer.customerName}</div>
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
      {!isStaff ? (
        <div style={{ color: '#BFC8D9', fontSize: 13, marginBottom: 14 }}>
          Score uses the last 60 days; PC is calculated separately. Overdue or new customers may be capped even if their score is high.
        </div>
      ) : null}

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

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

      {!isStaff ? (
        <>
          <SectionHeader
            title="Monthly Rankings"
            description="Each ranking uses rolling 2-month data, so one quiet month does not unfairly punish a customer."
          />
          <div style={{ ...whiteCardStyle, marginBottom: 18 }}>
            <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Select Month</div>
            <select style={inputStyle} value={selectedRankingMonth} onChange={(event) => setSelectedRankingMonth(event.target.value)}>
              <option value="">Select month</option>
              {rankingMonthOptions.map((month) => (
                <option key={month.monthKey} value={month.monthKey}>{month.monthLabel}</option>
              ))}
            </select>
            {!selectedRankingMonth ? (
              <div style={{ color: '#D7DEEA', marginTop: 12 }}>Select a month to load rankings.</div>
            ) : null}
          </div>
          {selectedMonthlyRanking ? (
            <div style={panelGridStyle}>
              <div style={panelStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div>
                      <div style={{ color: '#D4AF37', fontWeight: 800 }}>{selectedMonthlyRanking.monthLabel}</div>
                      <div style={mutedTextStyle}>{selectedMonthlyRanking.periodLabel}</div>
                    </div>
                    <div style={{ color: '#BFC8D9', fontWeight: 700 }}>{selectedMonthlyRanking.rankings.length} ranked</div>
                  </div>

                  {selectedMonthlyRanking.rankings.length === 0 ? (
                    <div style={{ color: '#BFC8D9' }}>No invoice activity for this ranking period.</div>
                  ) : (
                    <div style={latestFiveScrollStyle}>
                      {selectedMonthlyRanking.rankings.map((ranking) => (
                        <div key={`${selectedMonthlyRanking.monthKey}-${ranking.customerId}`} style={rowStyle}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{ranking.customerName}</div>
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
            ) : null}
        </>
      ) : null}
    </div>
  );
};

export default Intelligence;
