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
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle } from '../utils/listDisplay';
import { normalizeScoreWeights } from '../utils/settings';
import type { CustomerScore } from '../types';

type StaffListKey = 'top' | 'risk';

const Intelligence = () => {
  const { userProfile } = useAuth();
  const { customers, invoices, payments, settings, customerScores, loading, error } = useErpData();
  const isMobile = useIsMobile();
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [activeStaffList, setActiveStaffList] = useState<StaffListKey>('top');
  const summary = useMemo(() => buildIntelligenceSummary(customerScores), [customerScores]);
  const monthlyRankings = useMemo(() => buildMonthlyRankings(customers, invoices, payments, new Date(), settings), [customers, invoices, payments, settings]);
  const scoreWeights = normalizeScoreWeights(settings);
  const formatWholeOrders = (value: number) => String(Math.round(value));
  const isStaff = userProfile?.role === 'Staff';
  const selectedCustomerScore = customerScores.find((customer) => customer.customerId === selectedCustomerId);

  const topCustomers = customerScores;
  const riskCustomers = customerScores
    .filter((customer) => customer.riskLevel === 'High' || customer.overdueStatus === 'Overdue' || customer.paymentDisciplineScore < 65);
  const profitableCustomers = [...customerScores].sort((a, b) => b.totalProfit - a.totalProfit);
  const disciplinedCustomers = [...customerScores]
    .filter((customer) => customer.invoiceCount > 0)
    .sort((a, b) => b.paymentDisciplineScore - a.paymentDisciplineScore);

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
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    color: '#0B1F3A',
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
    color: '#0B1F3A'
  };

  const staffListButtonStyle: CSSProperties = {
    border: '1px solid #D8DEE9',
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 900,
    cursor: 'pointer',
    transition: 'background 180ms ease, color 180ms ease, border-color 180ms ease'
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

  const staffListConfigs: Record<StaffListKey, { title: string; panel: JSX.Element }> = {
    top: {
      title: 'Top Customers',
      panel: renderCustomerListPanel(
        'Top Customers',
        topCustomers,
        'Add Firestore invoices to generate customer rankings.',
        (customer) =>
          renderCustomerRow(
            customer,
            `#${customer.rank}`,
            `Score ${customer.intelligenceScore} | Sales ${formatMoney(customer.customerMonthlySales)} / ${formatMoney(customer.monthlySalesTarget)} | Orders ${formatWholeOrders(customer.customerMonthlyOrders)} / ${formatWholeOrders(customer.monthlyOrderTarget)}`
          )
      )
    },
    risk: {
      title: 'Risk Customers',
      panel: renderCustomerListPanel(
        'Risk Customers',
        riskCustomers,
        'No risk customers in the current rolling window.',
        (customer) =>
          renderCustomerRow(
            customer,
            formatMoney(customer.outstanding),
            `${customer.riskLevel} risk | ${customer.overdueStatus} | Pay score ${customer.paymentDisciplineScore}`,
            '#F2994A'
          )
      )
    }
  };

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

      {!isStaff ? (
        <div style={metricGridStyle}>
          <StatCard title="Rolling Sales" value={formatMoney(summary.totalSales)} subtitle="Current 2-month window" />
          <StatCard title="Rolling Profit" value={formatMoney(summary.totalProfit)} subtitle="Profit contribution" />
          <StatCard title="Total Payments" value={formatMoney(summary.totalPayments)} subtitle="Collected against scored invoices" />
          <StatCard title="Outstanding" value={formatMoney(summary.outstanding)} subtitle="Previous + invoice outstanding" color="#EB5757" />
          <StatCard title="Average Score" value={`${summary.averageScore}`} subtitle="Weighted score" />
          <StatCard title="Gift Budget" value={formatMoney(summary.giftBudget)} subtitle="3% of sales" />
        </div>
      ) : null}

      {!isStaff ? (
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
      ) : null}

      {isStaff ? (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {(Object.keys(staffListConfigs) as StaffListKey[]).map((key) => {
              const isActive = activeStaffList === key;
              return (
                <button
                  key={key}
                  type="button"
                  style={{
                    ...staffListButtonStyle,
                    background: isActive ? '#0B1F3A' : '#FFFFFF',
                    borderColor: isActive ? '#0B1F3A' : '#D8DEE9',
                    color: isActive ? '#FFFFFF' : '#0B1F3A'
                  }}
                  onClick={() => setActiveStaffList(key)}
                >
                  {staffListConfigs[key].title}
                </button>
              );
            })}
          </div>
          {staffListConfigs[activeStaffList].panel}
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

          {renderCustomerListPanel(
            'Risk Customers',
            riskCustomers,
            'No risk customers in the current rolling window.',
            (customer) =>
              renderCustomerRow(
                customer,
                formatMoney(customer.outstanding),
                `${customer.riskLevel} risk | ${customer.overdueStatus} | Pay score ${customer.paymentDisciplineScore}`,
                '#F2994A'
              )
          )}

          {renderCustomerListPanel(
            'Most Profitable',
            profitableCustomers,
            'No profit activity in the current rolling window.',
            (customer) => renderCustomerRow(customer, formatMoney(customer.totalProfit), `Profit from ${customer.invoiceCount} invoice(s)`)
          )}

          {renderCustomerListPanel(
            'Best Payment Discipline',
            disciplinedCustomers,
            'No paid invoice activity in the current rolling window.',
            (customer) => renderCustomerRow(customer, `${customer.paymentDisciplineScore}`, `${formatMoney(customer.totalPayments)} collected`, '#56CCF2')
          )}
        </div>
      )}

      {isStaff ? (
        <div style={{ ...whiteCardStyle, marginBottom: 24 }}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Select Customer</div>
          <select style={inputStyle} value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
            <option value="">Select customer</option>
            {customerScores.map((customer) => (
              <option key={customer.customerId} value={customer.customerId}>{customer.customerName}</option>
            ))}
          </select>
          {selectedCustomerScore ? (
            <div style={{ marginTop: 18 }}>
              <CustomerScoreCard customer={selectedCustomerScore} />
            </div>
          ) : (
            <div style={{ color: '#67738E', marginTop: 12 }}>Select a customer to view score breakdown.</div>
          )}
        </div>
      ) : (
        <>
          <SectionHeader
            title="Score Breakdown"
            description="Each card shows the weighted score used for ranking, tiering, and gift budget decisions."
          />
          <div style={{ color: '#BFC8D9', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
          <div style={{ ...latestFiveScrollStyle, maxHeight: 520 }}>
            <div style={scoreCardGridStyle}>
              {customerScores.map((customer) => (
                <CustomerScoreCard key={customer.customerId} customer={customer} />
              ))}
            </div>
          </div>
        </>
      )}

      {!isStaff ? (
        <>
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
                  <div style={latestFiveScrollStyle}>
                    {month.rankings.map((ranking) => (
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
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default Intelligence;
