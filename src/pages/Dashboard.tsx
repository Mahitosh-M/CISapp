import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import SectionHeader from '../components/SectionHeader';
import StatCard from '../components/StatCard';
import TierBadge from '../components/TierBadge';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { buildCustomerScores, buildIntelligenceSummary } from '../utils/customerAnalytics';
import { getCurrentMonthRange, isDateInRange } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { buildOverdueInvoiceAlerts } from '../utils/overdueUtils';
import { getInvoicePaymentEffect } from '../utils/paymentUtils';

const chartColors = ['#D4AF37', '#56CCF2', '#EB5757'];

const Dashboard = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const { userProfile } = useAuth();
  const defaultRange = useMemo(() => getCurrentMonthRange(), []);
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [activeFromDate, setActiveFromDate] = useState(defaultRange.fromDate);
  const [activeToDate, setActiveToDate] = useState(defaultRange.toDate);

  const periodInvoices = useMemo(() => {
    return invoices.filter((invoice) => isDateInRange(invoice.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, invoices]);

  const periodInvoiceIds = useMemo(() => new Set(periodInvoices.map((invoice) => invoice.id)), [periodInvoices]);
  const periodPayments = useMemo(() => payments.filter((payment) => isDateInRange(payment.date, activeFromDate, activeToDate)), [activeFromDate, activeToDate, payments]);

  const periodTotals = useMemo(() => {
    const sales = periodInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const profit = periodInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const collected = periodPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const invoicePayments = payments.filter((payment) => periodInvoiceIds.has(payment.invoiceId));
    const invoicePaymentEffect = invoicePayments.reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
    // Opening balances from old records are included in dashboard outstanding without changing payment entry flow.
    const previousOutstanding = customers.reduce((sum, customer) => sum + (customer.previousOutstandingAmount ?? 0), 0);

    return {
      sales,
      profit,
      collected,
      outstanding: previousOutstanding + sales - invoicePaymentEffect
    };
  }, [customers, payments, periodInvoiceIds, periodInvoices, periodPayments]);

  const customerScores = useMemo(() => buildCustomerScores(customers, invoices, payments, new Date(), settings), [customers, invoices, payments, settings]);
  const summary = useMemo(() => buildIntelligenceSummary(customerScores), [customerScores]);
  const overdueAlerts = useMemo(
    () => sortNewestFirst(buildOverdueInvoiceAlerts(customers, invoices, payments, settings), ['effectiveDueDate', 'dueDate', 'invoiceDate']),
    [customers, invoices, payments, settings]
  );
  const overdueAmount = overdueAlerts.reduce((sum, alert) => sum + alert.overdueAmount, 0);
  const topCustomers = customerScores;
  const topCustomersForCharts = customerScores.slice(0, 5);
  const outstandingRows = useMemo(() => {
    return [...customerScores]
      .filter((customer) => customer.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 8);
  }, [customerScores]);
  const salesTrend = useMemo(() => {
    const dailySales = new Map<string, { date: string; sales: number; profit: number }>();
    periodInvoices.forEach((invoice) => {
      const current = dailySales.get(invoice.date) || { date: invoice.date, sales: 0, profit: 0 };
      dailySales.set(invoice.date, {
        date: invoice.date,
        sales: current.sales + invoice.totalSales,
        profit: current.profit + invoice.totalProfit
      });
    });
    return [...dailySales.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [periodInvoices]);
  const paymentTrend = useMemo(() => {
    const dailyPayments = new Map<string, number>();
    periodPayments.forEach((payment) => dailyPayments.set(payment.date, (dailyPayments.get(payment.date) || 0) + payment.amount));
    return [...dailyPayments.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, collected]) => ({ date, collected }));
  }, [periodPayments]);
  const tierDistribution = useMemo(() => {
    return (['Tier 1', 'Tier 2', 'Tier 3'] as const).map((tier) => ({
      name: tier,
      value: customerScores.filter((customer) => customer.tier === tier).length
    }));
  }, [customerScores]);
  const giftBudgetChart = useMemo(() => {
    return topCustomersForCharts.map((customer) => ({ customer: customer.customerName, giftBudget: customer.giftBudget }));
  }, [topCustomersForCharts]);
  const riskCustomers = customerScores
    .filter((customer) => customer.riskLevel === 'High' || customer.overdueStatus === 'Overdue' || customer.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);

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

  const inputStyle: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#0B1F3A'
  };

  const chartCardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  if (loading) {
    return (
      <div>
        <SectionHeader title="ERP Dashboard" description="Loading Firestore data..." />
      </div>
    );
  }

  if (userProfile?.role === 'Staff' && !settings.staffPermissions.canViewDashboard) {
    return <SectionHeader title="ERP Dashboard" description="Dashboard access is currently limited by Admin settings." />;
  }

  return (
    <div>
      <SectionHeader
        title="ERP Dashboard"
        description={`Default view: current month (${activeFromDate} to ${activeToDate}) plus rolling customer intelligence.`}
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

      <div style={{ ...chartCardStyle, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ fontWeight: 800 }}>
            From Date
            <input type="date" style={{ ...inputStyle, display: 'block', marginTop: 6 }} value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label style={{ fontWeight: 800 }}>
            To Date
            <input type="date" style={{ ...inputStyle, display: 'block', marginTop: 6 }} value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              setActiveFromDate(fromDate);
              setActiveToDate(toDate);
            }}
            style={{ border: 0, borderRadius: 10, padding: '11px 14px', background: '#D4AF37', color: '#0B1F3A', fontWeight: 900, cursor: 'pointer' }}
          >
            Apply Filter
          </button>
        </div>
      </div>

      <div style={gridStyle}>
        <StatCard title="Sales" value={formatMoney(periodTotals.sales)} subtitle="Last month" />
        <StatCard title="Profit" value={formatMoney(periodTotals.profit)} subtitle="Last month" />
        <StatCard title="Collected" value={formatMoney(periodTotals.collected)} subtitle="Payments against period invoices" />
        <StatCard title="Outstanding" value={formatMoney(periodTotals.outstanding)} subtitle="Previous + period unpaid invoices" color="#D32F2F" />
        <StatCard title="Customers" value={`${customers.length}`} subtitle="Firestore customer records" />
        <StatCard title="Average Score" value={`${summary.averageScore}`} subtitle="Rolling 2-month intelligence" />
        <StatCard title="Overdue Alerts" value={`${overdueAlerts.length}`} subtitle={formatMoney(overdueAmount)} color="#EB5757" />
      </div>

      <div style={panelGridStyle}>
        <div style={chartCardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Sales & Profit Trend</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={salesTrend}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Legend />
              <Line type="monotone" dataKey="sales" stroke="#D4AF37" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="profit" stroke="#0B1F3A" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={chartCardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Payment Collection</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={paymentTrend}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Line type="monotone" dataKey="collected" stroke="#56CCF2" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={chartCardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Tier Distribution</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={tierDistribution} dataKey="value" nameKey="name" innerRadius={55} outerRadius={92} label>
                {tierDistribution.map((entry, index) => (
                  <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={chartCardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Top Outstanding Customers</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={outstandingRows.map((customer) => ({ customer: customer.customerName, outstanding: customer.outstanding }))}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="customer" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="outstanding" fill="#EB5757" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={chartCardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Top Customers</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={topCustomers.map((customer) => ({ customer: customer.customerName, sales: customer.totalSales }))}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="customer" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="sales" fill="#D4AF37" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={chartCardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Gift Budget</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={giftBudgetChart}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="customer" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="giftBudget" fill="#0B1F3A" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
          <div style={{ color: '#BFC8D9', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>

          {overdueAlerts.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>No overdue invoices right now.</div>
          ) : (
            <div style={latestFiveScrollStyle}>
              {overdueAlerts.map((alert) => (
                <div key={alert.invoiceId} style={rowStyle}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{alert.invoiceNumber} - {alert.customerName}</div>
                    <div style={mutedTextStyle}>Due {alert.effectiveDueDate} | {alert.overdueDays} day(s) overdue</div>
                  </div>
                  <div style={{ color: '#EB5757', fontWeight: 900 }}>{formatMoney(alert.overdueAmount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Top Customers</div>
          <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Rolling 2-month ranking from Firestore invoices and payments.</div>
          <div style={{ color: '#BFC8D9', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>

          {topCustomers.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>Add customers and invoices to see rankings.</div>
          ) : (
            <div style={latestFiveScrollStyle}>
              {topCustomers.map((customer) => (
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
              ))}
            </div>
          )}
        </div>

        <div style={panelStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Overdue / Risk Customers</div>
          <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Payment discipline and outstanding alerts.</div>
          <div style={{ color: '#BFC8D9', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>

          {riskCustomers.length === 0 ? (
            <div style={{ color: '#BFC8D9' }}>No customer is currently flagged for review.</div>
          ) : (
            <div style={latestFiveScrollStyle}>
              {riskCustomers.map((customer) => (
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
