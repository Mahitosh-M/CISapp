import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import CustomerScoreCard from '../components/CustomerScoreCard';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useErpData } from '../hooks/useErpData';
import {
  buildCustomerScores,
  buildIntelligenceSummary,
  buildMonthlyRankings
} from '../utils/customerAnalytics';
import { formatMoney } from '../utils/formatters';
import { normalizeScoreWeights } from '../utils/settings';
import type { CustomerScore } from '../types';

const Intelligence = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const customerScores = useMemo(() => buildCustomerScores(customers, invoices, payments, new Date(), settings), [customers, invoices, payments, settings]);
  const summary = useMemo(() => buildIntelligenceSummary(customerScores), [customerScores]);
  const monthlyRankings = useMemo(() => buildMonthlyRankings(customers, invoices, payments, new Date(), settings), [customers, invoices, payments, settings]);
  const scoreWeights = normalizeScoreWeights(settings);

  const topCustomers = customerScores.slice(0, 5);
  const riskCustomers = customerScores
    .filter((customer) => customer.riskLevel === 'High' || customer.overdueStatus === 'Overdue' || customer.paymentDisciplineScore < 65)
    .slice(0, 5);
  const profitableCustomers = [...customerScores].sort((a, b) => b.totalProfit - a.totalProfit).slice(0, 5);
  const disciplinedCustomers = [...customerScores]
    .filter((customer) => customer.invoiceCount > 0)
    .sort((a, b) => b.paymentDisciplineScore - a.paymentDisciplineScore)
    .slice(0, 5);

  const metricGridStyle: CSSProperties = {
    display: 'grid',
    gap: 18,
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    marginBottom: 24
  };

  const panelGridStyle: CSSProperties = {
    display: 'grid',
    gap: 18,
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    marginBottom: 24
  };

  const scoreCardGridStyle: CSSProperties = {
    display: 'grid',
    gap: 18,
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
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
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const rowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 14,
    alignItems: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '12px 0'
  };

  const mutedTextStyle: CSSProperties = {
    color: '#BFC8D9',
    fontSize: 13,
    marginTop: 4
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

  if (loading) {
    return <SectionHeader title="Customer Intelligence" description="Loading Firestore intelligence data..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Customer Intelligence"
        description="Rolling 2-month customer ranking, tier assignment, overdue status, and gift budget from Firestore."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

      <div style={metricGridStyle}>
        <StatCard title="Rolling Sales" value={formatMoney(summary.totalSales)} subtitle="Current 2-month window" />
        <StatCard title="Rolling Profit" value={formatMoney(summary.totalProfit)} subtitle="Profit contribution" />
        <StatCard title="Total Payments" value={formatMoney(summary.totalPayments)} subtitle="Collected against scored invoices" />
        <StatCard title="Outstanding" value={formatMoney(summary.outstanding)} subtitle="Sales minus payments" color="#EB5757" />
        <StatCard title="Average Score" value={`${summary.averageScore}`} subtitle="Weighted score" />
        <StatCard title="Gift Budget" value={formatMoney(summary.giftBudget)} subtitle="3% of sales" />
      </div>

      <div style={panelGridStyle}>
        <div style={whiteCardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Profit Contribution</div>
          <div style={{ color: '#D4AF37', fontSize: 28, fontWeight: 800 }}>{Math.round(scoreWeights.profit * 100)}%</div>
          <div style={{ color: '#5C6A84', marginTop: 8 }}>Primary driver because pharma customer quality depends on profit, not only sales.</div>
        </div>
        <div style={whiteCardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Payment Discipline</div>
          <div style={{ color: '#D4AF37', fontSize: 28, fontWeight: 800 }}>{Math.round(scoreWeights.paymentDiscipline * 100)}%</div>
          <div style={{ color: '#5C6A84', marginTop: 8 }}>Rewards timely settlement and protects working capital.</div>
        </div>
        <div style={whiteCardStyle}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Frequency + Sales + Loyalty</div>
          <div style={{ color: '#D4AF37', fontSize: 28, fontWeight: 800 }}>{Math.round((scoreWeights.frequency + scoreWeights.sales + scoreWeights.loyalty) * 100)}%</div>
          <div style={{ color: '#5C6A84', marginTop: 8 }}>Balances weekly ordering with rare but large-volume customers.</div>
        </div>
      </div>

      <div style={panelGridStyle}>
        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 8 }}>Top Customers</div>
          {topCustomers.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>Add Firestore invoices to generate customer rankings.</div>
          ) : (
            topCustomers.map((customer) =>
              renderCustomerRow(customer, `#${customer.rank}`, `Score ${customer.intelligenceScore} | ${formatMoney(customer.totalSales)} sales`)
            )
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 8 }}>Risk Customers</div>
          {riskCustomers.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>No risk customers in the current rolling window.</div>
          ) : (
            riskCustomers.map((customer) =>
              renderCustomerRow(
                customer,
                formatMoney(customer.outstanding),
                `${customer.riskLevel} risk | ${customer.overdueStatus} | Pay score ${customer.paymentDisciplineScore}`,
                '#F2994A'
              )
            )
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 8 }}>Most Profitable</div>
          {profitableCustomers.map((customer) =>
            renderCustomerRow(customer, formatMoney(customer.totalProfit), `Profit from ${customer.invoiceCount} invoice(s)`)
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 8 }}>Best Payment Discipline</div>
          {disciplinedCustomers.map((customer) =>
            renderCustomerRow(customer, `${customer.paymentDisciplineScore}`, `${formatMoney(customer.totalPayments)} collected`, '#56CCF2')
          )}
        </div>
      </div>

      <SectionHeader
        title="Score Breakdown"
        description="Each card shows the weighted score used for ranking, tiering, and gift budget decisions."
      />
      <div style={scoreCardGridStyle}>
        {customerScores.map((customer) => (
          <CustomerScoreCard key={customer.customerId} customer={customer} />
        ))}
      </div>

      <SectionHeader
        title="Monthly Rankings"
        description="Each ranking uses rolling 2-month data, so one quiet month does not unfairly punish a customer."
      />
      <div style={panelGridStyle}>
        {monthlyRankings.map((month) => (
          <div key={month.monthKey} style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 800 }}>{month.monthLabel}</div>
                <div style={mutedTextStyle}>{month.periodLabel}</div>
              </div>
              <div style={{ color: '#BFC8D9', fontWeight: 700 }}>{month.rankings.length} ranked</div>
            </div>

            {month.rankings.length === 0 ? (
              <div style={{ color: '#BFC8D9' }}>No invoice activity for this ranking period.</div>
            ) : (
              month.rankings.map((ranking) => (
                <div key={`${month.monthKey}-${ranking.customerId}`} style={rowStyle}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{ranking.customerName}</div>
                    <div style={mutedTextStyle}>
                      {formatMoney(ranking.totalSales)} sales | Gift {formatMoney(ranking.giftBudget)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#D4AF37', fontWeight: 800 }}>#{ranking.rank}</div>
                    <div style={{ color: '#BFC8D9', fontSize: 13 }}>Score {ranking.intelligenceScore}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Intelligence;
