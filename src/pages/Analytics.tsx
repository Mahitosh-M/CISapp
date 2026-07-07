import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import DateRangeShortcuts from '../components/DateRangeShortcuts';
import SectionHeader from '../components/SectionHeader';
import { useErpData } from '../hooks/useErpData';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildCustomerContributionRows } from '../utils/contribution';
import { getCurrentMonthRange, isDateInRange } from '../utils/dateUtils';
import type { DateRange } from '../utils/dateUtils';
import { formatDate, formatMoney } from '../utils/formatters';
import { latestFiveScrollStyle } from '../utils/listDisplay';
import { getBusinessInvoices } from '../utils/openingBalance';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';

type ContributionGroup = 'top5' | 'next10' | 'remaining';

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
  const [contributionGroup, setContributionGroup] = useState<ContributionGroup>('top5');
  const { customers, invoices, payments, loading, error } = useErpData({ fromDate: activeFromDate, toDate: activeToDate });
  const isMobile = useIsMobile();

  const filteredInvoices = useMemo(() => {
    return getBusinessInvoices(invoices).filter((invoice) => isDateInRange(invoice.date, activeFromDate, activeToDate));
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

  const contributionRows = useMemo(() => {
    return buildCustomerContributionRows(customers, filteredInvoices).sort((left, right) => right.sales - left.sales);
  }, [customers, filteredInvoices]);

  const contributionGroupRows = useMemo(() => {
    if (contributionGroup === 'top5') return contributionRows.slice(0, 5);
    if (contributionGroup === 'next10') return contributionRows.slice(5, 15);
    return contributionRows.slice(15);
  }, [contributionGroup, contributionRows]);

  const contributionGroupSummary = useMemo(() => {
    return contributionGroupRows.reduce(
      (summary, row) => ({
        sales: summary.sales + row.sales,
        profit: summary.profit + row.profit,
        salesPercent: summary.salesPercent + row.salesPercent,
        profitPercent: summary.profitPercent + row.profitPercent
      }),
      { sales: 0, profit: 0, salesPercent: 0, profitPercent: 0 }
    );
  }, [contributionGroupRows]);

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

  const businessBriefing = useMemo(() => {
    const lines: string[] = [];
    const add = (condition: boolean, message: string) => {
      if (condition) lines.push(message);
    };
    const sortedDays = [...dailyAnalysis].sort((left, right) => left.date.localeCompare(right.date));
    const midpoint = Math.max(1, Math.floor(sortedDays.length / 2));
    const firstHalf = sortedDays.slice(0, midpoint);
    const secondHalf = sortedDays.slice(midpoint);
    const sumRows = (rows: typeof sortedDays, key: 'sales' | 'profit' | 'collected' | 'invoices') => rows.reduce((sum, row) => sum + row[key], 0);
    const firstSales = sumRows(firstHalf, 'sales');
    const secondSales = sumRows(secondHalf, 'sales');
    const firstProfit = sumRows(firstHalf, 'profit');
    const secondProfit = sumRows(secondHalf, 'profit');
    const firstCollected = sumRows(firstHalf, 'collected');
    const secondCollected = sumRows(secondHalf, 'collected');
    const firstMargin = firstSales > 0 ? (firstProfit / firstSales) * 100 : 0;
    const secondMargin = secondSales > 0 ? (secondProfit / secondSales) * 100 : 0;
    const salesChange = firstSales > 0 ? ((secondSales - firstSales) / firstSales) * 100 : secondSales > 0 ? 100 : 0;
    const profitChange = firstProfit > 0 ? ((secondProfit - firstProfit) / firstProfit) * 100 : secondProfit > 0 ? 100 : 0;
    const collectionChange = firstCollected > 0 ? ((secondCollected - firstCollected) / firstCollected) * 100 : secondCollected > 0 ? 100 : 0;
    const topCustomer = contributionRows[0];
    const topFiveSalesPercent = contributionRows.slice(0, 5).reduce((sum, row) => sum + row.salesPercent, 0);
    const topFiveProfitPercent = contributionRows.slice(0, 5).reduce((sum, row) => sum + row.profitPercent, 0);
    const inactiveCustomers = Math.max(0, customers.length - analysis.activeCustomers);
    const avgProfitPerInvoice = analysis.invoiceCount > 0 ? analysis.profit / analysis.invoiceCount : 0;
    const avgSalesPerActiveCustomer = analysis.activeCustomers > 0 ? analysis.sales / analysis.activeCustomers : 0;
    const lossMakingCustomers = contributionRows.filter((row) => row.profit < 0);
    const lowMarginCustomers = contributionRows.filter((row) => row.sales > 0 && (row.profit / row.sales) * 100 < 5);
    const highMarginCustomers = contributionRows.filter((row) => row.sales > 0 && (row.profit / row.sales) * 100 >= 20);
    const tinySalesCustomers = contributionRows.filter((row) => row.sales > 0 && row.salesPercent < 2);
    const strongCustomers = contributionRows.filter((row) => row.salesPercent >= 5 && row.profitPercent >= 5);
    const salesWithoutProfit = contributionRows.filter((row) => row.salesPercent >= 5 && row.profitPercent < 2);
    const profitWithoutSales = contributionRows.filter((row) => row.profitPercent >= 5 && row.salesPercent < 2);
    const zeroCollection = analysis.sales > 0 && analysis.collected <= 0;
    const dailySalesAverage = sortedDays.length > 0 ? analysis.sales / sortedDays.length : 0;
    const bestSalesDay = [...sortedDays].sort((left, right) => right.sales - left.sales)[0];
    const bestProfitDay = [...sortedDays].sort((left, right) => right.profit - left.profit)[0];
    const worstProfitDay = [...sortedDays].sort((left, right) => left.profit - right.profit)[0];
    const highSalesLowProfitDay = sortedDays.find((row) => row.sales > dailySalesAverage && row.sales > 0 && (row.profit / row.sales) * 100 < 5);
    const noPaymentDays = sortedDays.filter((row) => row.sales > 0 && row.collected <= 0);

    add(analysis.sales <= 0, 'No invoice sales were recorded in this period, so the main action is to verify whether the selected date range is correct or sales entry is pending.');
    add(analysis.sales > 0, `The business generated ${formatMoney(analysis.sales)} sales from ${analysis.invoiceCount} invoice(s), with an average invoice value of ${formatMoney(analysis.avgInvoiceValue)}.`);
    add(analysis.profit > 0, `The period is profitable with ${formatMoney(analysis.profit)} gross profit and ${formatPercent(analysis.margin)} margin.`);
    add(analysis.profit < 0, `The period is loss-making by ${formatMoney(Math.abs(analysis.profit))}; pricing, scheme discounting, or purchase-cost entry should be reviewed immediately.`);
    add(analysis.margin >= 20, 'Margin is strong, so the business has room to protect service quality while staying profitable.');
    add(analysis.margin >= 12 && analysis.margin < 20, 'Margin is healthy but should be monitored customer-wise so discounts do not quietly erode profit.');
    add(analysis.margin >= 5 && analysis.margin < 12, 'Margin is thin; avoid blanket discounts and review low-margin customers before pushing more volume.');
    add(analysis.margin > 0 && analysis.margin < 5, 'Margin is critically low; sales growth alone may not improve cash if pricing is not corrected.');
    add(analysis.collectionRate >= 90, 'Collections are very strong against selected sales, which supports faster stock rotation and lower credit risk.');
    add(analysis.collectionRate >= 70 && analysis.collectionRate < 90, 'Collections are acceptable, but follow-up discipline still matters for customers with fresh outstanding.');
    add(analysis.collectionRate >= 40 && analysis.collectionRate < 70, 'Collections are moderate; cash flow may tighten if the same pattern continues into the next period.');
    add(analysis.collectionRate > 0 && analysis.collectionRate < 40, 'Collections are weak compared with sales; prioritize payment follow-up before extending additional credit.');
    add(zeroCollection, 'Sales exist but no matching collection is recorded in this period; this is a cash-flow warning, not just a reporting gap.');
    add(analysis.outstanding > analysis.sales * 0.75 && analysis.sales > 0, 'Outstanding is very high compared with period sales, so collection risk is the biggest operating concern.');
    add(analysis.outstanding > analysis.sales * 0.4 && analysis.outstanding <= analysis.sales * 0.75 && analysis.sales > 0, 'Outstanding is meaningful and should be reviewed customer-wise before approving larger orders.');
    add(analysis.outstanding <= analysis.sales * 0.15 && analysis.sales > 0, 'Outstanding is controlled relative to sales, which indicates healthier collection conversion.');
    add(analysis.activeCustomerRate >= 60, 'Customer activity is broad, reducing dependence on a small buyer base.');
    add(analysis.activeCustomerRate >= 30 && analysis.activeCustomerRate < 60, 'Customer activity is moderate; there is room to reactivate dormant customers.');
    add(analysis.activeCustomerRate > 0 && analysis.activeCustomerRate < 30, 'Only a small part of the customer base purchased in this period, so sales concentration and inactivity need attention.');
    add(inactiveCustomers > 0, `${inactiveCustomers} customer(s) had no invoice activity in this range; reactivation calls can be planned from this list.`);
    add(Boolean(topCustomer && topCustomer.salesPercent >= 40), topCustomer ? `${topCustomer.customerName} alone contributes ${formatPercent(topCustomer.salesPercent)} of sales, creating high dependency on one account.` : '');
    add(Boolean(topCustomer && topCustomer.salesPercent >= 25 && topCustomer.salesPercent < 40), topCustomer ? `${topCustomer.customerName} is a major sales driver at ${formatPercent(topCustomer.salesPercent)} of sales; protect the relationship but monitor credit exposure.` : '');
    add(Boolean(topCustomer && topCustomer.salesPercent < 25), 'No single customer dominates sales, which is healthier from a dependency perspective.');
    add(topFiveSalesPercent >= 75, `Top 5 customers contribute ${formatPercent(topFiveSalesPercent)} of sales, so the business is concentrated and should not ignore smaller buyers.`);
    add(topFiveSalesPercent >= 50 && topFiveSalesPercent < 75, `Top 5 customers contribute ${formatPercent(topFiveSalesPercent)} of sales, which is normal but still worth tracking.`);
    add(topFiveSalesPercent < 50 && analysis.sales > 0, 'Sales are well distributed beyond the top 5 customers.');
    add(topFiveProfitPercent >= 75, `Top 5 customers contribute ${formatPercent(topFiveProfitPercent)} of positive profit, so profit dependence is concentrated.`);
    add(topFiveProfitPercent < topFiveSalesPercent - 15, 'The top sales customers are not contributing profit in the same proportion; check pricing and discount leakage.');
    add(topFiveProfitPercent > topFiveSalesPercent + 15, 'Profit is stronger than sales concentration among top customers, suggesting good-margin strategic accounts.');
    add(lossMakingCustomers.length > 0, `${lossMakingCustomers.length} customer(s) show negative profit contribution; review product mix, cost entries, and discounting for those accounts.`);
    add(lowMarginCustomers.length > 0, `${lowMarginCustomers.length} customer(s) are below 5% margin; these accounts need targeted margin correction rather than more volume.`);
    add(highMarginCustomers.length > 0, `${highMarginCustomers.length} customer(s) are above 20% margin; these are valuable accounts to protect and grow.`);
    add(tinySalesCustomers.length >= 10, 'Many customers are contributing very small sales shares; route planning or order-frequency nudges may lift repeat business.');
    add(strongCustomers.length >= 3, `${strongCustomers.length} customer(s) are strong on both sales and profit contribution; these should be priority relationship accounts.`);
    add(salesWithoutProfit.length > 0, `${salesWithoutProfit.length} customer(s) bring sales volume without matching profit; they may look big but need commercial review.`);
    add(profitWithoutSales.length > 0, `${profitWithoutSales.length} customer(s) produce profit despite low sales share; they are candidates for focused upselling.`);
    add(analysis.negativeProfitCount > 0, `${analysis.negativeProfitCount} negative-profit invoice(s) reduced profit by ${formatMoney(analysis.negativeProfitAmount)}.`);
    add(analysis.negativeProfitCount >= 5, 'Repeated negative-profit invoices suggest a process issue, not a one-off mistake.');
    add(avgProfitPerInvoice > 0, `Average gross profit per invoice is ${formatMoney(avgProfitPerInvoice)}.`);
    add(avgProfitPerInvoice < 0, 'Average invoice profitability is negative, so invoice-level pricing should be audited.');
    add(avgSalesPerActiveCustomer > 0, `Average sales per active customer is ${formatMoney(avgSalesPerActiveCustomer)}.`);
    add(salesChange >= 25, `Sales accelerated in the later part of the period by about ${formatPercent(salesChange)} versus the earlier part.`);
    add(salesChange <= -25, `Sales slowed in the later part of the period by about ${formatPercent(Math.abs(salesChange))}; check whether demand, stock, or billing activity dropped.`);
    add(salesChange > -25 && salesChange < 25 && analysis.sales > 0, 'Sales are relatively steady across the selected period.');
    add(profitChange >= 25 && secondProfit > 0, `Profit improved materially in the later part of the period, up about ${formatPercent(profitChange)}.`);
    add(profitChange <= -25 && firstProfit > 0, `Profit weakened materially in the later part of the period, down about ${formatPercent(Math.abs(profitChange))}.`);
    add(secondMargin > firstMargin + 5 && secondSales > 0, `Margin improved from ${formatPercent(firstMargin)} to ${formatPercent(secondMargin)} in the later part of the period.`);
    add(secondMargin + 5 < firstMargin && firstSales > 0, `Margin dropped from ${formatPercent(firstMargin)} to ${formatPercent(secondMargin)} later in the period; check recent invoices.`);
    add(collectionChange >= 25, `Collections improved in the later part of the period by about ${formatPercent(collectionChange)}.`);
    add(collectionChange <= -25 && firstCollected > 0, `Collections slowed in the later part of the period by about ${formatPercent(Math.abs(collectionChange))}.`);
    add(Boolean(bestSalesDay && bestSalesDay.sales > 0), bestSalesDay ? `Best sales day was ${formatDate(bestSalesDay.date)} with ${formatMoney(bestSalesDay.sales)} sales.` : '');
    add(Boolean(bestProfitDay && bestProfitDay.profit > 0), bestProfitDay ? `Best profit day was ${formatDate(bestProfitDay.date)} with ${formatMoney(bestProfitDay.profit)} profit.` : '');
    add(Boolean(worstProfitDay && worstProfitDay.profit < 0), worstProfitDay ? `Worst profit day was ${formatDate(worstProfitDay.date)} with ${formatMoney(worstProfitDay.profit)} profit; inspect invoices from that day.` : '');
    add(Boolean(highSalesLowProfitDay), `At least one high-sales day had weak margin, so turnover and profitability are not moving together consistently.`);
    add(noPaymentDays.length >= 3, `${noPaymentDays.length} sales day(s) had no same-period collection recorded; collection timing should be checked.`);
    add(analysis.invoiceCount >= 25 && analysis.avgInvoiceValue < 5000, 'There are many smaller invoices; operational effort per rupee may be high unless order batching improves.');
    add(analysis.invoiceCount <= 3 && analysis.sales > 0, 'Sales are coming from very few invoices, so one missed order can materially affect the period.');
    add(analysis.paymentCount > analysis.invoiceCount && analysis.invoiceCount > 0, 'Payment entry count is higher than invoice count, suggesting active collection follow-up or split payments.');
    add(analysis.paymentCount < analysis.invoiceCount / 2 && analysis.invoiceCount > 4, 'Payment records are low compared with invoice count, so receivable follow-up should be tightened.');
    add(analysis.collected > analysis.sales && analysis.sales > 0, 'Collections exceed current-period sales, likely because old dues were collected; this is good for cash flow.');
    add(analysis.profit > 0 && analysis.collectionRate < 50, 'Profit is visible on paper, but weak collection means cash has not fully converted yet.');
    add(analysis.profit < 0 && analysis.collectionRate >= 80, 'Cash collection is strong but profitability is weak; the problem is pricing or cost, not collection.');
    add(analysis.margin >= 15 && analysis.collectionRate >= 80, 'This is a strong period: margin and collection are both healthy.');
    add(analysis.margin < 8 && analysis.collectionRate < 50 && analysis.sales > 0, 'This is a pressure period: low margin and weak collection are happening together.');
    add(contributionRows.length >= 20, 'The customer base has enough activity for segmentation; separate high-profit, high-volume, and dormant customers.');
    add(contributionRows.length > 0 && contributionRows.length < 5, 'Very few customers drove this period; customer acquisition or reactivation should be considered.');
    add(analysis.sales > 0 && analysis.activeCustomers === customers.length && customers.length > 0, 'Every customer bought in this period, which is excellent breadth if the date range is not too wide.');
    add(analysis.sales > 0 && analysis.activeCustomers === 1, 'Only one customer bought in this period, making the business highly exposed to a single account.');

    return lines.length > 0 ? lines : ['No significant business signal was detected for this period. Try widening the date range for a stronger read.'];
  }, [analysis, contributionRows, customerAnalysis, customers.length, dailyAnalysis]);

  const applyDateRange = (range: DateRange) => {
    setFromDate(range.fromDate);
    setToDate(range.toDate);
    setActiveFromDate(range.fromDate);
    setActiveToDate(range.toDate);
  };

  const handleFromDateChange = (value: string) => {
    setFromDate(value);
    setActiveFromDate(value);
  };

  const handleToDateChange = (value: string) => {
    setToDate(value);
    setActiveToDate(value);
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

  const contributionButtonLabels: Record<ContributionGroup, string> = {
    top5: 'Top 5',
    next10: 'Next 10',
    remaining: 'Remaining'
  };

  if (loading) {
    return <SectionHeader title="Analytics" description="Loading Firestore analytics..." />;
  }

  return (
    <div>
      <SectionHeader
        title="Business Analytics"
        description={`Consultant-style business analysis for ${formatDate(activeFromDate)} to ${formatDate(activeToDate)}.`}
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ fontWeight: 800 }}>
            From Date
            <input type="date" style={{ ...inputStyle, display: 'block', marginTop: 6 }} value={fromDate} onChange={(event) => handleFromDateChange(event.target.value)} />
          </label>
          <label style={{ fontWeight: 800 }}>
            To Date
            <input type="date" style={{ ...inputStyle, display: 'block', marginTop: 6 }} value={toDate} onChange={(event) => handleToDateChange(event.target.value)} />
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
        </div>
      </div>

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

          <div style={{ ...cardStyle, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900 }}>Contribution Explorer</div>
                <div style={{ color: '#67738E', marginTop: 4 }}>Sales and profit contribution by customer group.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['top5', 'next10', 'remaining'] as ContributionGroup[]).map((group) => (
                  <button
                    key={group}
                    type="button"
                    style={{ ...buttonStyle, background: contributionGroup === group ? '#0B1F3A' : '#E8EDF4', color: contributionGroup === group ? '#FFFFFF' : '#0B1F3A' }}
                    onClick={() => setContributionGroup(group)}
                  >
                    {contributionButtonLabels[group]}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Group Sales</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatMoney(contributionGroupSummary.sales)}</div>
              </div>
              <div style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Sales %</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatPercent(contributionGroupSummary.salesPercent)}</div>
              </div>
              <div style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Group Profit</div>
                <div style={{ fontWeight: 900, marginTop: 4, color: contributionGroupSummary.profit >= 0 ? '#1B7F3A' : '#B42318' }}>{formatMoney(contributionGroupSummary.profit)}</div>
              </div>
              <div style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Profit %</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatPercent(contributionGroupSummary.profitPercent)}</div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Customer', 'Invoices', 'Sales', 'Sales %', 'Profit', 'Profit %'].map((header) => (
                      <th key={header} style={{ ...cellStyle, background: '#F8F9FB', textAlign: 'left' }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contributionGroupRows.length === 0 ? (
                    <tr><td style={cellStyle} colSpan={6}>No customers in this contribution group.</td></tr>
                  ) : (
                    contributionGroupRows.map((row, index) => (
                      <tr key={row.customerId || `${row.customerName}-${index}`}>
                        <td style={cellStyle}>
                          <strong>{contributionRows.indexOf(row) + 1}. {row.customerName}</strong>
                        </td>
                        <td style={cellStyle}>{row.invoiceCount}</td>
                        <td style={cellStyle}>{formatMoney(row.sales)}</td>
                        <td style={cellStyle}>{formatPercent(row.salesPercent)}</td>
                        <td style={{ ...cellStyle, color: row.profit >= 0 ? '#1B7F3A' : '#B42318', fontWeight: 800 }}>{formatMoney(row.profit)}</td>
                        <td style={cellStyle}>{formatPercent(row.profitPercent)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900 }}>Business Analyst Briefing</div>
                <div style={{ color: '#67738E', marginTop: 4 }}>
                  Dynamic read of sales, profit, collection, customer concentration, and trend movement.
                </div>
              </div>
              <div style={{ color: '#67738E', fontWeight: 900 }}>{businessBriefing.length} signal(s)</div>
            </div>
            <div style={{ ...latestFiveScrollStyle, maxHeight: 520, display: 'grid', gap: 10, paddingRight: 4 }}>
              {businessBriefing.map((item, index) => (
                <div key={`${index}-${item}`} style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 10, padding: 12, fontWeight: 700, lineHeight: 1.45 }}>
                  <span style={{ color: '#D4AF37', fontWeight: 900, marginRight: 8 }}>{index + 1}.</span>
                  {item}
                </div>
              ))}
            </div>
          </div>
    </div>
  );
};

export default Analytics;
