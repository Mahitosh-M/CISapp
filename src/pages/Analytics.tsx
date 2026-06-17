import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import DateRangeShortcuts from '../components/DateRangeShortcuts';
import SectionHeader from '../components/SectionHeader';
import { useErpData } from '../hooks/useErpData';
import { useIsMobile } from '../hooks/useIsMobile';
import { getCurrentMonthRange, isDateInRange } from '../utils/dateUtils';
import type { DateRange } from '../utils/dateUtils';
import { formatDate, formatMoney } from '../utils/formatters';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';

type AnalysisView = 'business' | 'data';
type FocusMetric = 'profit' | 'collection' | 'customers' | 'risk';

const formatPercent = (value: number) => `${Math.round(Number.isFinite(value) ? value : 0)}%`;

const getSignalColor = (tone: 'good' | 'watch' | 'risk') => {
  if (tone === 'good') return '#1B7F3A';
  if (tone === 'watch') return '#B7791F';
  return '#B42318';
};

const Analytics = () => {
  const defaultRange = useMemo(() => getCurrentMonthRange(), []);
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [activeFromDate, setActiveFromDate] = useState(defaultRange.fromDate);
  const [activeToDate, setActiveToDate] = useState(defaultRange.toDate);
  const [activeView, setActiveView] = useState<AnalysisView>('business');
  const [focusMetric, setFocusMetric] = useState<FocusMetric>('profit');
  const { customers, invoices, payments, loading, error } = useErpData({ fromDate: activeFromDate, toDate: activeToDate });
  const isMobile = useIsMobile();

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => isDateInRange(invoice.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, invoices]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => isDateInRange(payment.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, payments]);

  const invoiceIds = useMemo(() => new Set(filteredInvoices.map((invoice) => invoice.id)), [filteredInvoices]);

  const analysis = useMemo(() => {
    const sales = filteredInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const profit = filteredInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0);
    const collected = filteredPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const invoicePaymentEffect = filteredPayments
      .filter((payment) => invoiceIds.has(payment.invoiceId))
      .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
    const outstanding = getPendingAmount(sales, invoicePaymentEffect);
    const activeCustomerIds = new Set(filteredInvoices.map((invoice) => invoice.customerId));
    const negativeProfitInvoices = filteredInvoices.filter((invoice) => invoice.totalProfit < 0);
    const avgInvoiceValue = filteredInvoices.length > 0 ? Math.round(sales / filteredInvoices.length) : 0;
    const margin = sales > 0 ? (profit / sales) * 100 : 0;
    const collectionRate = sales > 0 ? (collected / sales) * 100 : 0;
    const activeCustomerRate = customers.length > 0 ? (activeCustomerIds.size / customers.length) * 100 : 0;

    return {
      sales,
      profit,
      collected,
      outstanding,
      invoiceCount: filteredInvoices.length,
      paymentCount: filteredPayments.length,
      activeCustomers: activeCustomerIds.size,
      avgInvoiceValue,
      margin,
      collectionRate,
      activeCustomerRate,
      negativeProfitCount: negativeProfitInvoices.length,
      negativeProfitAmount: negativeProfitInvoices.reduce((sum, invoice) => sum + Math.abs(invoice.totalProfit), 0)
    };
  }, [customers.length, filteredInvoices, filteredPayments, invoiceIds]);

  const customerAnalysis = useMemo(() => {
    const rows = new Map<string, { customer: string; sales: number; profit: number; invoices: number }>();

    filteredInvoices.forEach((invoice) => {
      const customerName = customers.find((customer) => customer.id === invoice.customerId)?.name || invoice.customerName;
      const current = rows.get(invoice.customerId) || { customer: customerName, sales: 0, profit: 0, invoices: 0 };
      rows.set(invoice.customerId, {
        customer: current.customer,
        sales: current.sales + invoice.totalSales,
        profit: current.profit + invoice.totalProfit,
        invoices: current.invoices + 1
      });
    });

    return [...rows.values()].sort((a, b) => b.sales - a.sales);
  }, [customers, filteredInvoices]);

  const dailyAnalysis = useMemo(() => {
    const rows = new Map<string, { date: string; sales: number; profit: number; collected: number; invoices: number }>();

    filteredInvoices.forEach((invoice) => {
      const current = rows.get(invoice.date) || { date: invoice.date, sales: 0, profit: 0, collected: 0, invoices: 0 };
      rows.set(invoice.date, {
        ...current,
        sales: current.sales + invoice.totalSales,
        profit: current.profit + invoice.totalProfit,
        invoices: current.invoices + 1
      });
    });

    filteredPayments.forEach((payment) => {
      const current = rows.get(payment.date) || { date: payment.date, sales: 0, profit: 0, collected: 0, invoices: 0 };
      rows.set(payment.date, {
        ...current,
        collected: current.collected + payment.amount
      });
    });

    return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [filteredInvoices, filteredPayments]);

  const insightCards = useMemo(() => {
    const concentration = analysis.sales > 0 && customerAnalysis.length > 0 ? (customerAnalysis[0].sales / analysis.sales) * 100 : 0;

    return [
      {
        title: 'Profit Health',
        value: formatPercent(analysis.margin),
        detail: analysis.profit >= 0 ? `${formatMoney(analysis.profit)} profit from selected sales.` : `${formatMoney(Math.abs(analysis.profit))} loss in this range.`,
        tone: analysis.margin >= 15 ? 'good' : analysis.margin >= 5 ? 'watch' : 'risk'
      },
      {
        title: 'Collection Strength',
        value: formatPercent(analysis.collectionRate),
        detail: `${formatMoney(analysis.collected)} collected against ${formatMoney(analysis.sales)} sales.`,
        tone: analysis.collectionRate >= 80 ? 'good' : analysis.collectionRate >= 50 ? 'watch' : 'risk'
      },
      {
        title: 'Customer Activity',
        value: formatPercent(analysis.activeCustomerRate),
        detail: `${analysis.activeCustomers} of ${customers.length} customers bought in this period.`,
        tone: analysis.activeCustomerRate >= 45 ? 'good' : analysis.activeCustomerRate >= 20 ? 'watch' : 'risk'
      },
      {
        title: 'Sales Concentration',
        value: formatPercent(concentration),
        detail: customerAnalysis[0] ? `${customerAnalysis[0].customer} is the largest contributor.` : 'No customer sales in this period.',
        tone: concentration <= 25 ? 'good' : concentration <= 45 ? 'watch' : 'risk'
      }
    ] as { title: string; value: string; detail: string; tone: 'good' | 'watch' | 'risk' }[];
  }, [analysis, customerAnalysis, customers.length]);

  const focusItems = useMemo(() => {
    if (focusMetric === 'profit') {
      return [
        `Gross margin is ${formatPercent(analysis.margin)} on ${formatMoney(analysis.sales)} sales.`,
        analysis.negativeProfitCount > 0
          ? `${analysis.negativeProfitCount} invoice(s) reduced profit by ${formatMoney(analysis.negativeProfitAmount)}.`
          : 'No negative-profit invoices found in this range.',
        `Average invoice value is ${formatMoney(analysis.avgInvoiceValue)}.`
      ];
    }

    if (focusMetric === 'collection') {
      return [
        `Collection rate is ${formatPercent(analysis.collectionRate)} for the selected period.`,
        `${formatMoney(analysis.outstanding)} remains unpaid against selected invoices and payments.`,
        `${analysis.paymentCount} payment record(s) were captured in this range.`
      ];
    }

    if (focusMetric === 'customers') {
      return [
        `${analysis.activeCustomers} customer(s) placed orders in this period.`,
        `${Math.max(0, customers.length - analysis.activeCustomers)} customer(s) had no invoice activity.`,
        customerAnalysis[0] ? `${customerAnalysis[0].customer} contributed ${formatMoney(customerAnalysis[0].sales)} sales.` : 'No customer contribution to rank yet.'
      ];
    }

    return [
      analysis.margin < 5 ? 'Profit margin needs review before increasing discounts or credit.' : 'Profit margin is not currently the main risk signal.',
      analysis.collectionRate < 50 ? 'Collections are weak for the selected period.' : 'Collections are within a manageable range.',
      analysis.negativeProfitCount > 0 ? 'Negative-profit invoices need product or pricing review.' : 'No negative-profit invoice risk found.'
    ];
  }, [analysis, customerAnalysis, customers.length, focusMetric]);

  const applyDateRange = (range: DateRange) => {
    setFromDate(range.fromDate);
    setToDate(range.toDate);
    setActiveFromDate(range.fromDate);
    setActiveToDate(range.toDate);
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: isMobile ? 10 : 16,
    marginBottom: 18
  };

  const inputStyle: CSSProperties = {
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#0B1F3A'
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 900,
    cursor: 'pointer'
  };

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: isMobile ? 620 : 760,
    borderCollapse: 'collapse'
  };

  const cellStyle: CSSProperties = {
    padding: isMobile ? '9px 10px' : '12px 14px',
    borderBottom: '1px solid #E8EDF4'
  };

  if (loading) {
    return <SectionHeader title="Analytics" description="Loading Firestore analytics..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Business Analytics"
        description={`Business and data analysis for ${formatDate(activeFromDate)} to ${formatDate(activeToDate)}.`}
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
            style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}
          >
            Apply Filter
          </button>
          <DateRangeShortcuts selectedRange={{ fromDate: activeFromDate, toDate: activeToDate }} onSelect={applyDateRange} />
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {(['business', 'data'] as AnalysisView[]).map((view) => (
              <button
                key={view}
                type="button"
                style={{ ...buttonStyle, background: activeView === view ? '#0B1F3A' : '#E8EDF4', color: activeView === view ? '#FFFFFF' : '#0B1F3A' }}
                onClick={() => setActiveView(view)}
              >
                {view === 'business' ? 'Business Analysis' : 'Data Analysis'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeView === 'business' ? (
        <>
          <div style={gridStyle}>
            <div style={cardStyle}>
              <div style={{ color: '#67738E', fontWeight: 800 }}>Sales</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{formatMoney(analysis.sales)}</div>
              <div style={{ color: '#67738E', marginTop: 6 }}>{analysis.invoiceCount} invoice(s)</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#67738E', fontWeight: 800 }}>Profit</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6, color: analysis.profit >= 0 ? '#1B7F3A' : '#B42318' }}>{formatMoney(analysis.profit)}</div>
              <div style={{ color: '#67738E', marginTop: 6 }}>{formatPercent(analysis.margin)} margin</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#67738E', fontWeight: 800 }}>Collected</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{formatMoney(analysis.collected)}</div>
              <div style={{ color: '#67738E', marginTop: 6 }}>{formatPercent(analysis.collectionRate)} of sales</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#67738E', fontWeight: 800 }}>Outstanding</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6, color: analysis.outstanding > 0 ? '#B42318' : '#1B7F3A' }}>{formatMoney(analysis.outstanding)}</div>
              <div style={{ color: '#67738E', marginTop: 6 }}>Selected range balance</div>
            </div>
          </div>

          <div style={gridStyle}>
            {insightCards.map((insight) => (
              <div key={insight.title} style={{ ...cardStyle, borderTop: `4px solid ${getSignalColor(insight.tone)}` }}>
                <div style={{ color: '#67738E', fontWeight: 800 }}>{insight.title}</div>
                <div style={{ color: getSignalColor(insight.tone), fontSize: 28, fontWeight: 900, marginTop: 8 }}>{insight.value}</div>
                <div style={{ color: '#0B1F3A', marginTop: 8, lineHeight: 1.45 }}>{insight.detail}</div>
              </div>
            ))}
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900 }}>Insight Focus</div>
                <div style={{ color: '#67738E', marginTop: 4 }}>Selected range signals for the business.</div>
              </div>
              <select style={inputStyle} value={focusMetric} onChange={(event) => setFocusMetric(event.target.value as FocusMetric)}>
                <option value="profit">Profit</option>
                <option value="collection">Collection</option>
                <option value="customers">Customers</option>
                <option value="risk">Risk</option>
              </select>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {focusItems.map((item) => (
                <div key={item} style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12, fontWeight: 700 }}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={cardStyle}>
          <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 12 }}>Date Range Data Breakdown</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Date', 'Invoices', 'Sales', 'Profit', 'Collected', 'Margin'].map((header) => (
                    <th key={header} style={{ ...cellStyle, background: '#F8F9FB', textAlign: 'left' }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyAnalysis.length === 0 ? (
                  <tr><td style={cellStyle} colSpan={6}>No business data found for this date range.</td></tr>
                ) : (
                  dailyAnalysis.map((row) => (
                    <tr key={row.date}>
                      <td style={cellStyle}>{formatDate(row.date)}</td>
                      <td style={cellStyle}>{row.invoices}</td>
                      <td style={cellStyle}>{formatMoney(row.sales)}</td>
                      <td style={{ ...cellStyle, color: row.profit >= 0 ? '#1B7F3A' : '#B42318', fontWeight: 800 }}>{formatMoney(row.profit)}</td>
                      <td style={cellStyle}>{formatMoney(row.collected)}</td>
                      <td style={cellStyle}>{row.sales > 0 ? formatPercent((row.profit / row.sales) * 100) : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
