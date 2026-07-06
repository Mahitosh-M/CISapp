import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  CartesianGrid,
  Cell,
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
import DateRangeShortcuts from '../components/DateRangeShortcuts';
import { useAuth } from '../contexts/AuthContext';
import { useErpData } from '../hooks/useErpData';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildCustomerContributionRows, buildTopFivePieRows } from '../utils/contribution';
import { addDaysToDateString, getThisYearRange, getTodayDateString, isDateInRange } from '../utils/dateUtils';
import type { DateRange } from '../utils/dateUtils';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { formatDate, formatDateRange, formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { buildOverdueInvoiceRisks } from '../utils/overdueUtils';

const chartColors = ['#D4AF37', '#56CCF2', '#EB5757', '#27AE60', '#7C3AED', '#9AA6B2'];
const formatPercent = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

const Dashboard = () => {
  const defaultRange = useMemo(() => getThisYearRange(), []);
  const [fromDate, setFromDate] = useState(defaultRange.fromDate);
  const [toDate, setToDate] = useState(defaultRange.toDate);
  const [activeFromDate, setActiveFromDate] = useState(defaultRange.fromDate);
  const [activeToDate, setActiveToDate] = useState(defaultRange.toDate);
  const [showOverdueInvoices, setShowOverdueInvoices] = useState(false);
  const { userProfile } = useAuth();
  const isStaff = userProfile?.role === 'Staff';
  const shouldLoadOverdueInvoices = isStaff && showOverdueInvoices;
  const { customers, invoices, payments, settings, loading, error } = useErpData({
    fromDate: activeFromDate,
    toDate: activeToDate,
    includePayments: shouldLoadOverdueInvoices,
    includeScores: false
  });
  const isMobile = useIsMobile();

  const periodInvoices = useMemo(() => {
    return invoices.filter((invoice) => isDateInRange(invoice.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, invoices]);

  const overdueRisks = useMemo(
    () => shouldLoadOverdueInvoices ? sortNewestFirst(buildOverdueInvoiceRisks(customers, invoices, payments, settings), ['effectiveDueDate', 'dueDate', 'invoiceDate']) : [],
    [customers, invoices, payments, settings, shouldLoadOverdueInvoices]
  );
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
  const contributionRows = useMemo(() => buildCustomerContributionRows(customers, periodInvoices), [customers, periodInvoices]);
  const salesPieRows = useMemo(() => buildTopFivePieRows(contributionRows, 'sales'), [contributionRows]);
  const profitPieRows = useMemo(() => buildTopFivePieRows(contributionRows, 'profit'), [contributionRows]);
  const inactiveCustomers = useMemo(() => {
    const cutoffDate = addDaysToDateString(getTodayDateString(), -15);
    const lastOrderByCustomerId = new Map<string, string>();

    invoices.forEach((invoice) => {
      const current = lastOrderByCustomerId.get(invoice.customerId) || '';
      if (invoice.date > current) {
        lastOrderByCustomerId.set(invoice.customerId, invoice.date);
      }
    });

    return customers
      .map((customer) => ({
        customer,
        lastOrderDate: lastOrderByCustomerId.get(customer.id) || ''
      }))
      .filter((row) => !row.lastOrderDate || row.lastOrderDate < cutoffDate)
      .sort((left, right) => (left.lastOrderDate || '').localeCompare(right.lastOrderDate || '') || left.customer.name.localeCompare(right.customer.name));
  }, [customers, invoices]);

  const applyDateRange = (range: DateRange) => {
    setFromDate(range.fromDate);
    setToDate(range.toDate);
    setActiveFromDate(range.fromDate);
    setActiveToDate(range.toDate);
  };

  const panelGridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: isMobile ? 12 : 18,
    marginBottom: isMobile ? 16 : 24
  };

  const panelStyle: CSSProperties = {
    background: '#102645',
    borderRadius: 12,
    padding: isMobile ? 14 : 20,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.16)'
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
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    color: '#0B1F3A'
  };

  const chartCardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 10,
    padding: isMobile ? 12 : 18,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)'
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '11px 14px',
    background: '#D4AF37',
    color: '#0B1F3A',
    fontWeight: 900,
    cursor: 'pointer'
  };

  const trendCardStyle: CSSProperties = {
    ...chartCardStyle,
    padding: isMobile ? 14 : 22
  };

  const trendLegendStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    color: '#67738E',
    fontSize: 12,
    fontWeight: 900,
    flexWrap: 'wrap'
  };

  const renderContributionPie = (title: string, rows: { name: string; value: number; percent: number }[]) => (
    <div style={chartCardStyle}>
      <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 6 }}>{title}</div>
      <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginBottom: 10 }}>Top 5 customers + Others</div>
      {rows.length === 0 ? (
        <div style={{ height: isMobile ? 220 : 260, display: 'grid', placeItems: 'center', color: '#67738E', fontWeight: 800 }}>No contribution data</div>
      ) : (
        <ResponsiveContainer width="100%" height={isMobile ? 240 : 280}>
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} label={({ payload }) => formatPercent((payload as { percent?: number }).percent ?? 0)}>
              {rows.map((entry, index) => (
                <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name, item) => [formatMoney(Number(value)), `${name} (${formatPercent((item.payload as { percent?: number }).percent ?? 0)})`]} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );

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
        description={`Default view: this year (${formatDateRange(activeFromDate, activeToDate)}) plus rolling customer intelligence.`}
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
            style={buttonStyle}
          >
            Apply Filter
          </button>
          <DateRangeShortcuts selectedRange={{ fromDate: activeFromDate, toDate: activeToDate }} onSelect={applyDateRange} />
        </div>
      </div>

      <div style={{ marginBottom: isMobile ? 16 : 24 }}>
        <div style={trendCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div style={{ color: '#D4AF37', fontWeight: 900 }}>Sales & Profit Trend</div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginTop: 4 }}>{formatDateRange(activeFromDate, activeToDate)}</div>
            </div>
            <div style={trendLegendStyle}>
              <span><span style={{ color: '#D4AF37', fontSize: 18, lineHeight: 0 }}>●</span> Sales</span>
              <span><span style={{ color: '#0B1F3A', fontSize: 18, lineHeight: 0 }}>●</span> Profit</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={isMobile ? 240 : 320}>
            <LineChart data={salesTrend}>
              <CartesianGrid stroke="#EEF2F7" vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDate} axisLine={false} tickLine={false} tick={{ fill: '#67738E', fontSize: 11 }} />
              <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} axisLine={false} tickLine={false} tick={{ fill: '#67738E', fontSize: 11 }} />
              <Tooltip formatter={(value) => formatMoney(Number(value))} labelFormatter={(label) => formatDate(String(label))} />
              <Line type="monotone" dataKey="sales" stroke="#D4AF37" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="profit" stroke="#0B1F3A" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={panelGridStyle}>
        {renderContributionPie('Sales Contribution', salesPieRows)}
        {renderContributionPie('Profit Contribution', profitPieRows)}
      </div>

      {isStaff ? (
        <div style={panelGridStyle}>
          <div style={panelStyle}>
            <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Inactive Customers</div>
            <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Customers with no order in the last 15 days.</div>
            {inactiveCustomers.length === 0 ? (
              <div style={{ color: '#BFC8D9' }}>All loaded customers ordered within the last 15 days.</div>
            ) : (
              <div style={latestFiveScrollStyle}>
                {inactiveCustomers.map(({ customer, lastOrderDate }) => (
                  <div key={customer.id} style={rowStyle}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{formatCustomerSelectLabel(customer)}</div>
                      <div style={mutedTextStyle}>
                        Last order: {lastOrderDate ? formatDate(lastOrderDate) : 'No order found'}
                      </div>
                    </div>
                    <div style={{ color: '#D4AF37', fontWeight: 900 }}>{customer.mobile || '-'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isStaff ? (
        <div style={panelGridStyle}>
          {!showOverdueInvoices ? (
            <div style={panelStyle}>
              <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Overdue Invoices</div>
              <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Load overdue invoice data only when needed.</div>
              <button type="button" style={buttonStyle} onClick={() => setShowOverdueInvoices(true)}>
                Show Overdue Invoices
              </button>
            </div>
          ) : (
            <div style={panelStyle}>
              <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 6 }}>Overdue Invoices</div>
              <div style={{ color: '#BFC8D9', marginBottom: 12 }}>Dynamic credit days and buffer settings are applied here.</div>
              <div style={{ color: '#BFC8D9', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>

              {overdueRisks.length === 0 ? (
                <div style={{ color: '#BFC8D9' }}>No overdue invoices right now.</div>
              ) : (
                <div style={latestFiveScrollStyle}>
                  {overdueRisks.map((row) => (
                    <div key={row.invoiceId} style={rowStyle}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{row.invoiceNumber} - {row.customerName}</div>
                        <div style={mutedTextStyle}>Due {formatDate(row.effectiveDueDate)} | {row.overdueDays} day(s) overdue</div>
                      </div>
                      <div style={{ color: '#EB5757', fontWeight: 900 }}>{formatMoney(row.overdueAmount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default Dashboard;
