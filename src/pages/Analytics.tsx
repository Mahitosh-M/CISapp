import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Area,
  AreaChart,
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
import { useErpData } from '../hooks/useErpData';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { getPrevious30DaysRange, isDateInRange } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { buildCustomerOutstandingRows } from '../utils/overdueUtils';

const chartColors = ['#D4AF37', '#56CCF2', '#EB5757', '#27AE60', '#F2994A'];

const Analytics = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const defaultRange = useMemo(() => getPrevious30DaysRange(), []);
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [activeFromDate, setActiveFromDate] = useState(defaultRange.fromDate);
  const [activeToDate, setActiveToDate] = useState(defaultRange.toDate);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => isDateInRange(invoice.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, invoices]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => isDateInRange(payment.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, payments]);

  const customerScores = useMemo(() => buildCustomerScores(customers, invoices, payments, new Date(), settings), [customers, invoices, payments, settings]);
  const outstandingRows = useMemo(() => buildCustomerOutstandingRows(customers, invoices, payments, settings), [customers, invoices, payments, settings]);

  const salesTrend = useMemo(() => {
    const dailySales = new Map<string, number>();
    filteredInvoices.forEach((invoice) => dailySales.set(invoice.date, (dailySales.get(invoice.date) || 0) + invoice.totalSales));
    return [...dailySales.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, sales]) => ({ date, sales }));
  }, [filteredInvoices]);

  const profitTrend = useMemo(() => {
    const monthlyProfit = new Map<string, number>();
    invoices.forEach((invoice) => {
      const month = invoice.date.slice(0, 7);
      monthlyProfit.set(month, (monthlyProfit.get(month) || 0) + invoice.totalProfit);
    });
    return [...monthlyProfit.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, profit]) => ({ month, profit }));
  }, [invoices]);

  const tierDistribution = useMemo(() => {
    return (['Tier 1', 'Tier 2', 'Tier 3'] as const).map((tier) => ({
      name: tier,
      value: customers.filter((customer) => customer.tier === tier).length
    }));
  }, [customers]);

  const outstandingChart = useMemo(() => {
    return outstandingRows
      .filter((row) => row.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 10)
      .map((row) => ({
        customer: customers.find((customer) => customer.id === row.customerId)?.name || row.customerId,
        outstanding: row.outstanding
      }));
  }, [customers, outstandingRows]);

  const paymentCollectionTrend = useMemo(() => {
    const dailyPayments = new Map<string, number>();
    filteredPayments.forEach((payment) => dailyPayments.set(payment.date, (dailyPayments.get(payment.date) || 0) + payment.amount));
    return [...dailyPayments.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, collected]) => ({ date, collected }));
  }, [filteredPayments]);

  const topProfitCustomers = useMemo(() => {
    return [...customerScores]
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .slice(0, 10)
      .map((customer) => ({
        customer: customer.customerName,
        profit: customer.totalProfit
      }));
  }, [customerScores]);

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 18
  };

  const inputStyle: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#0B1F3A'
  };

  const renderChartTitle = (title: string, helper: string) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: '#D4AF37', fontWeight: 900 }}>{title}</div>
      <div style={{ color: '#67738E', fontSize: 13, marginTop: 4 }}>{helper}</div>
    </div>
  );

  if (loading) {
    return <SectionHeader title="Analytics" description="Loading Firestore analytics..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Advanced Analytics"
        description="Responsive Recharts analytics using only live Firestore customers, invoices, and payments."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
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
        <div style={cardStyle}>
          {renderChartTitle('Sales Trend', 'Line chart is used because sales are time-series data.')}
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={salesTrend}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Line type="monotone" dataKey="sales" stroke="#D4AF37" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          {renderChartTitle('Profit Trend', 'Area chart highlights growth across monthly profit.')}
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={profitTrend}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Area type="monotone" dataKey="profit" stroke="#0B1F3A" fill="#D4AF37" fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          {renderChartTitle('Tier Distribution', 'Pie chart is best for customer percentage split.')}
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={tierDistribution} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} label>
                {tierDistribution.map((entry, index) => (
                  <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          {renderChartTitle('Highest Outstanding Customers', 'Bar chart ranks the largest outstanding balances.')}
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={outstandingChart}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="customer" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="outstanding" fill="#EB5757" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          {renderChartTitle('Payment Collection', 'Line chart tracks cash collection over the selected period.')}
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={paymentCollectionTrend}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Line type="monotone" dataKey="collected" stroke="#56CCF2" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={cardStyle}>
          {renderChartTitle('Top Profit Customers', 'Horizontal comparison uses bars for fast ranking.')}
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topProfitCustomers}>
              <CartesianGrid stroke="#E8EDF4" />
              <XAxis dataKey="customer" />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} />
              <Bar dataKey="profit" fill="#D4AF37" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
