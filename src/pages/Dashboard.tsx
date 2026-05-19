import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useErpData } from '../hooks/useErpData';
import { buildCustomerScores, buildIntelligenceSummary } from '../utils/customerAnalytics';
import { getLastMonthRange, isDateInRange } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { buildOverdueInvoiceAlerts } from '../utils/overdueUtils';

const Dashboard = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const defaultRange = useMemo(() => getLastMonthRange(), []);

  const periodInvoices = useMemo(() => {
    return invoices.filter((invoice) => isDateInRange(invoice.date, defaultRange.fromDate, defaultRange.toDate));
  }, [defaultRange.fromDate, defaultRange.toDate, invoices]);

  const periodInvoiceIds = useMemo(() => new Set(periodInvoices.map((invoice) => invoice.id)), [periodInvoices]);
  const periodPayments = useMemo(() => payments.filter((payment) => periodInvoiceIds.has(payment.invoiceId)), [payments, periodInvoiceIds]);

  const periodTotals = useMemo(() => {
    const sales = periodInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const profit = periodInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const collected = periodPayments.reduce((sum, payment) => sum + payment.amount, 0);

    return {
      sales,
      profit,
      collected,
      outstanding: sales - collected
    };
  }, [periodInvoices, periodPayments]);

  const customerScores = useMemo(() => buildCustomerScores(customers, invoices, payments, new Date(), settings), [customers, invoices, payments, settings]);
  const summary = useMemo(() => buildIntelligenceSummary(customerScores), [customerScores]);
  const overdueAlerts = useMemo(() => buildOverdueInvoiceAlerts(customers, invoices, payments, settings), [customers, invoices, payments, settings]);
  const overdueAmount = overdueAlerts.reduce((sum, alert) => sum + alert.overdueAmount, 0);
  const topCustomers = customerScores.slice(0, 5);
  const riskCustomers = customerScores
    .filter((customer) => customer.riskLevel === 'High' || customer.overdueStatus === 'Overdue' || customer.outstanding > 0)
    .slice(0, 5);

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 18,
    marginBottom: 24
  };

  const panelGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: 18,
    marginBottom: 24
  };

  const panelStyle: CSSProperties = {
    background: '#102645',
    borderRadius: 18,
    padding: 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.16)'
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

  if (loading) {
    return (
      <div>
        <SectionHeader title="ERP Dashboard" description="Loading Firestore data..." />
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="ERP Dashboard"
        description={`Default view: last month (${defaultRange.fromDate} to ${defaultRange.toDate}) plus rolling customer intelligence.`}
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

      <div style={gridStyle}>
        <StatCard title="Sales" value={formatMoney(periodTotals.sales)} subtitle="Last month" />
        <StatCard title="Profit" value={formatMoney(periodTotals.profit)} subtitle="Last month" />
        <StatCard title="Collected" value={formatMoney(periodTotals.collected)} subtitle="Payments against period invoices" />
        <StatCard title="Outstanding" value={formatMoney(periodTotals.outstanding)} subtitle="Sales minus payments" color="#D32F2F" />
        <StatCard title="Customers" value={`${customers.length}`} subtitle="Firestore customer records" />
        <StatCard title="Average Score" value={`${summary.averageScore}`} subtitle="Rolling 2-month intelligence" />
        <StatCard title="Overdue Alerts" value={`${overdueAlerts.length}`} subtitle={formatMoney(overdueAmount)} color="#EB5757" />
      </div>

      <div style={gridStyle}>
        <StatCard title="Tier 1" value={`${summary.tier1Count}`} subtitle="Strategic accounts" />
        <StatCard title="Tier 2" value={`${summary.tier2Count}`} subtitle="Loyal medium accounts" />
        <StatCard title="Tier 3" value={`${summary.tier3Count}`} subtitle="No-credit accounts" color="#EB5757" />
        <StatCard title="Gift Budget" value={formatMoney(summary.giftBudget)} subtitle="Tier-based setting" />
      </div>

      <div style={panelGridStyle}>
        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Overdue Invoice Alerts</div>
          <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Dynamic credit days and buffer settings are applied here.</div>

          {overdueAlerts.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>No overdue invoices right now.</div>
          ) : (
            overdueAlerts.slice(0, 5).map((alert) => (
              <div key={alert.invoiceId} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 800 }}>{alert.invoiceNumber} - {alert.customerName}</div>
                  <div style={mutedTextStyle}>Due {alert.effectiveDueDate} | {alert.overdueDays} day(s) overdue</div>
                </div>
                <div style={{ color: '#EB5757', fontWeight: 900 }}>{formatMoney(alert.overdueAmount)}</div>
              </div>
            ))
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Top Customers</div>
          <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Rolling 2-month ranking from Firestore invoices and payments.</div>

          {topCustomers.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>Add customers and invoices to see rankings.</div>
          ) : (
            topCustomers.map((customer) => (
              <div key={customer.customerId} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 800 }}>{customer.customerName}</div>
                  <div style={mutedTextStyle}>
                    {formatMoney(customer.totalSales)} sales | {formatMoney(customer.totalProfit)} profit
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#D4AF37', fontWeight: 800 }}>#{customer.rank}</div>
                  <TierBadge tier={customer.tier} />
                </div>
              </div>
            ))
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Overdue / Risk Customers</div>
          <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Payment discipline and outstanding alerts.</div>

          {riskCustomers.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>No customer is currently flagged for review.</div>
          ) : (
            riskCustomers.map((customer) => (
              <div key={customer.customerId} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 800 }}>{customer.customerName}</div>
                  <div style={mutedTextStyle}>{customer.recommendedAction}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#F2994A', fontWeight: 800 }}>{formatMoney(customer.outstanding)}</div>
                  <div style={mutedTextStyle}>{customer.overdueStatus}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
