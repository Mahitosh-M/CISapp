import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { BarChart3, CircleDollarSign, Lightbulb, PieChart as PieChartIcon, Scale } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DateRangeShortcuts from '../components/DateRangeShortcuts';
import SectionHeader from '../components/SectionHeader';
import SectionTileNav from '../components/SectionTileNav';
import { useIsMobile } from '../hooks/useIsMobile';
import { getAppSettings, getBusinessMonthlySnapshots, getCustomerCount, getInvoices, getPayments } from '../services/firestoreService';
import { buildCustomerContributionRows, buildTopFivePieRows } from '../utils/contribution';
import { getCurrentMonthRange, getTodayDateString, isDateInRange } from '../utils/dateUtils';
import type { DateRange } from '../utils/dateUtils';
import type { AppSettings, BusinessMonthlySnapshot, Invoice, Payment } from '../types';
import { formatDate, formatMoney } from '../utils/formatters';
import { latestFiveScrollStyle } from '../utils/listDisplay';
import { getBusinessInvoices } from '../utils/openingBalance';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';
import { DEFAULT_SETTINGS } from '../utils/settings';

type ContributionGroup = 'top5' | 'next10' | 'remaining';
type AnalyticsSection = 'overview' | 'breakeven' | 'contribution' | 'insights' | 'briefing';

const analyticsSections = [
  { id: 'overview', label: 'Performance Overview', icon: BarChart3 },
  { id: 'breakeven', label: 'Breakeven Analysis', icon: Scale },
  { id: 'contribution', label: 'Customer Contribution', icon: PieChartIcon },
  { id: 'insights', label: 'Business Insights', icon: Lightbulb },
  { id: 'briefing', label: 'Analyst Briefing', icon: CircleDollarSign }
] satisfies { id: AnalyticsSection; label: string; icon: typeof BarChart3 }[];

const formatPercent = (value: number) => `${Math.round(Number.isFinite(value) ? value : 0)}%`;
const chartColors = ['#D4AF37', '#56CCF2', '#EB5757', '#27AE60', '#7C3AED', '#9AA6B2'];

const parseDateKey = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? new Date(year, month - 1, day) : undefined;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateKeysInRange = (fromDate: string, toDate: string) => {
  const start = parseDateKey(fromDate);
  const end = parseDateKey(toDate);
  if (!start || !end || start > end) return [];

  const rows: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    rows.push(formatDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
};

const getDailyFixedCost = (monthlyFixedCost: number, dateString: string) => {
  const date = parseDateKey(dateString);
  if (!date || monthlyFixedCost <= 0) return 0;
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return monthlyFixedCost / daysInMonth;
};

const getMonthKeysInRange = (fromDate: string, toDate: string) => {
  const start = parseDateKey(fromDate);
  const end = parseDateKey(toDate);
  if (!start || !end || start > end) return [];

  const rows: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= endMonth) {
    rows.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return rows;
};

const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

const isCompleteMonthRange = (fromDate: string, toDate: string) => {
  const end = parseDateKey(toDate);
  if (!end || !fromDate.endsWith('-01')) return false;
  const monthEnd = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  return end.getDate() === monthEnd;
};

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
  const [activeSection, setActiveSection] = useState<AnalyticsSection | null>(null);
  const [customerCount, setCustomerCount] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [monthlySnapshots, setMonthlySnapshots] = useState<BusinessMonthlySnapshot[]>([]);
  const [snapshotRangeLoaded, setSnapshotRangeLoaded] = useState('');
  const [loadedDetailRange, setLoadedDetailRange] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isMobile = useIsMobile();

  const selectedDateKeys = useMemo(() => getDateKeysInRange(activeFromDate, activeToDate), [activeFromDate, activeToDate]);
  const selectedMonthKeys = useMemo(() => getMonthKeysInRange(activeFromDate, activeToDate), [activeFromDate, activeToDate]);
  const activeRangeKey = `${activeFromDate}:${activeToDate}`;
  const detailedDataLoaded = loadedDetailRange === activeRangeKey;
  const completeMonthRange = isCompleteMonthRange(activeFromDate, activeToDate)
    || (activeFromDate.endsWith('-01') && activeToDate === getTodayDateString());
  const monthlySnapshotsReady = snapshotRangeLoaded === activeRangeKey
    && selectedMonthKeys.every((month) => monthlySnapshots.some((snapshot) => snapshot.month === month && !snapshot.needsBackfill));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setInvoices([]);
    setPayments([]);
    setCustomerCount(0);
    setSnapshotRangeLoaded('');
    setLoadedDetailRange('');
    const fromMonth = activeFromDate.slice(0, 7);
    const toMonth = activeToDate.slice(0, 7);
    Promise.all([getBusinessMonthlySnapshots(fromMonth, toMonth), getAppSettings()])
      .then(([snapshots, appSettings]) => {
        if (!active) return;
        setMonthlySnapshots(snapshots);
        setSettings(appSettings);
        setSnapshotRangeLoaded(activeRangeKey);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Unable to load monthly analytics.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [activeFromDate, activeRangeKey, activeToDate]);

  useEffect(() => {
    if (snapshotRangeLoaded !== activeRangeKey) return;
    const needsDetailedData = !completeMonthRange
      || !monthlySnapshotsReady
      || Boolean(activeSection && ['contribution', 'insights', 'briefing'].includes(activeSection));
    if (!needsDetailedData || detailedDataLoaded) return;
    let active = true;
    setLoading(true);
    Promise.all([
      getCustomerCount(),
      getInvoices({ fromDate: activeFromDate, toDate: activeToDate }),
      getPayments({ fromDate: activeFromDate, toDate: activeToDate })
    ])
      .then(([totalCustomers, invoiceRows, paymentRows]) => {
        if (!active) return;
        setCustomerCount(totalCustomers);
        setInvoices(invoiceRows);
        setPayments(paymentRows);
        setLoadedDetailRange(activeRangeKey);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Unable to load detailed analytics.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [activeFromDate, activeRangeKey, activeSection, activeToDate, completeMonthRange, detailedDataLoaded, monthlySnapshotsReady, snapshotRangeLoaded]);
  const allocatedFixedCost = useMemo(
    () => selectedDateKeys.reduce((sum, date) => sum + getDailyFixedCost(settings.fixedMonthlyCosts, date), 0),
    [selectedDateKeys, settings.fixedMonthlyCosts]
  );

  const filteredInvoices = useMemo(() => {
    return getBusinessInvoices(invoices).filter((invoice) => isDateInRange(invoice.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, invoices]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => isDateInRange(payment.date, activeFromDate, activeToDate));
  }, [activeFromDate, activeToDate, payments]);

  const invoiceIds = useMemo(() => new Set(filteredInvoices.map((invoice) => invoice.id)), [filteredInvoices]);

  const analysis = useMemo(() => {
    if (!detailedDataLoaded && completeMonthRange) {
      const sales = monthlySnapshots.reduce((sum, row) => sum + row.totalSales, 0);
      const profit = monthlySnapshots.reduce((sum, row) => sum + row.totalProfit, 0);
      const collected = monthlySnapshots.reduce((sum, row) => sum + row.paymentsReceived, 0);
      const invoiceCount = monthlySnapshots.reduce((sum, row) => sum + row.invoiceCount, 0);
      const margin = sales > 0 ? (profit / sales) * 100 : 0;
      const netProfit = profit - allocatedFixedCost;
      const breakEvenProgress = allocatedFixedCost > 0 ? Math.min(100, Math.max(0, (profit / allocatedFixedCost) * 100)) : profit > 0 ? 100 : 0;
      const breakEvenSales = margin > 0 && allocatedFixedCost > 0 ? allocatedFixedCost / (margin / 100) : 0;
      return {
        sales,
        profit,
        collected,
        outstanding: Math.max(0, sales - collected),
        invoiceCount,
        paymentCount: 0,
        activeCustomers: 0,
        avgInvoiceValue: invoiceCount > 0 ? Math.round(sales / invoiceCount) : 0,
        margin,
        fixedCost: allocatedFixedCost,
        netProfit,
        breakEvenProgress,
        breakEvenSales,
        breakEvenSalesGap: breakEvenSales > 0 ? Math.max(0, breakEvenSales - sales) : 0,
        collectionRate: sales > 0 ? (collected / sales) * 100 : 0,
        activeCustomerRate: 0,
        negativeProfitCount: 0,
        negativeProfitAmount: 0
      };
    }

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
    const netProfit = profit - allocatedFixedCost;
    const breakEvenProgress = allocatedFixedCost > 0 ? Math.min(100, Math.max(0, (profit / allocatedFixedCost) * 100)) : profit > 0 ? 100 : 0;
    const breakEvenSales = margin > 0 && allocatedFixedCost > 0 ? allocatedFixedCost / (margin / 100) : 0;
    const breakEvenSalesGap = breakEvenSales > 0 ? Math.max(0, breakEvenSales - sales) : 0;
    const collectionRate = sales > 0 ? (collected / sales) * 100 : 0;
    const activeCustomerRate = customerCount > 0 ? (activeCustomerIds.size / customerCount) * 100 : 0;

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
      fixedCost: allocatedFixedCost,
      netProfit,
      breakEvenProgress,
      breakEvenSales,
      breakEvenSalesGap,
      collectionRate,
      activeCustomerRate,
      negativeProfitCount: negativeProfitInvoices.length,
      negativeProfitAmount: negativeProfitInvoices.reduce((sum, invoice) => sum + Math.abs(invoice.totalProfit), 0)
    };
  }, [allocatedFixedCost, completeMonthRange, customerCount, detailedDataLoaded, filteredInvoices, filteredPayments, invoiceIds, monthlySnapshots]);

  const customerAnalysis = useMemo(() => {
    const rows = new Map<string, { customer: string; sales: number; profit: number; invoices: number }>();

    filteredInvoices.forEach((invoice) => {
      const customerName = invoice.customerName;
      const current = rows.get(invoice.customerId) || { customer: customerName, sales: 0, profit: 0, invoices: 0 };
      rows.set(invoice.customerId, {
        customer: current.customer,
        sales: current.sales + invoice.totalSales,
        profit: current.profit + invoice.totalProfit,
        invoices: current.invoices + 1
      });
    });

    return [...rows.values()].sort((a, b) => b.sales - a.sales);
  }, [filteredInvoices]);

  const contributionRows = useMemo(() => {
    return buildCustomerContributionRows([], filteredInvoices).sort((left, right) => right.sales - left.sales);
  }, [filteredInvoices]);
  const salesPieRows = useMemo(() => buildTopFivePieRows(contributionRows, 'sales'), [contributionRows]);
  const profitPieRows = useMemo(() => buildTopFivePieRows(contributionRows, 'profit'), [contributionRows]);

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

  const monthlyBreakevenRows = useMemo(() => {
    return selectedMonthKeys.map((month) => {
      const monthSnapshot = monthlySnapshots.find((snapshot) => snapshot.month === month);
      const monthInvoices = filteredInvoices.filter((invoice) => invoice.date.startsWith(`${month}-`));
      const sales = detailedDataLoaded
        ? monthInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0)
        : monthSnapshot?.totalSales ?? 0;
      const grossProfit = detailedDataLoaded
        ? monthInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0)
        : monthSnapshot?.totalProfit ?? 0;
      const fixedCost = Math.max(0, settings.fixedMonthlyCosts);
      const netProfit = grossProfit - fixedCost;
      const margin = sales > 0 ? (grossProfit / sales) * 100 : 0;
      const breakEvenSales = margin > 0 && fixedCost > 0 ? fixedCost / (margin / 100) : 0;
      return {
        month,
        monthLabel: formatMonthLabel(month),
        sales,
        grossProfit,
        fixedCost,
        netProfit,
        breakEvenSalesGap: breakEvenSales > 0 ? Math.max(0, breakEvenSales - sales) : fixedCost > 0 ? fixedCost : 0,
        status: fixedCost <= 0 ? 'Fixed cost not set' : netProfit >= 0 ? 'Profitable' : 'Below breakeven'
      };
    });
  }, [detailedDataLoaded, filteredInvoices, monthlySnapshots, selectedMonthKeys, settings.fixedMonthlyCosts]);

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
        detail: `${analysis.activeCustomers} of ${customerCount} customers bought in this period.`,
        tone: analysis.activeCustomerRate >= 45 ? 'good' : analysis.activeCustomerRate >= 20 ? 'watch' : 'risk'
      },
      {
        title: 'Sales Concentration',
        value: formatPercent(concentration),
        detail: customerAnalysis[0] ? `${customerAnalysis[0].customer} is the largest contributor.` : 'No customer sales in this period.',
        tone: concentration <= 25 ? 'good' : concentration <= 45 ? 'watch' : 'risk'
      }
    ] as { title: string; value: string; detail: string; tone: 'good' | 'watch' | 'risk' }[];
  }, [analysis, customerAnalysis, customerCount]);

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
    const topFiveSalesPercent = contributionRows.slice(0, 5).reduce((sum, row) => sum + row.salesPercent, 0);
    const topFiveProfitPercent = contributionRows.slice(0, 5).reduce((sum, row) => sum + row.profitPercent, 0);
    const inactiveCustomers = Math.max(0, customerCount - analysis.activeCustomers);
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

    add(analysis.margin >= 20, 'Margin is strong, so the business has room to protect service quality while staying profitable.');
    add(analysis.margin >= 12 && analysis.margin < 20, 'Margin is healthy but should be monitored customer-wise so discounts do not quietly erode profit.');
    add(analysis.margin >= 5 && analysis.margin < 12, 'Margin is thin; avoid blanket discounts and review low-margin customers before pushing more volume.');
    add(analysis.margin > 0 && analysis.margin < 5, 'Margin is critically low; sales growth alone may not improve cash if pricing is not corrected.');
    add(analysis.fixedCost > 0 && analysis.netProfit >= 0, `After fixed costs, the selected period is profitable by ${formatMoney(analysis.netProfit)}.`);
    add(analysis.fixedCost > 0 && analysis.netProfit < 0, `The selected period is ${formatMoney(Math.abs(analysis.netProfit))} short of breakeven after fixed costs.`);
    add(analysis.fixedCost > 0 && analysis.breakEvenSalesGap > 0, `At the current gross margin, about ${formatMoney(analysis.breakEvenSalesGap)} more sales are needed to reach breakeven.`);
    add(zeroCollection, 'Sales exist but no matching collection is recorded in this period; this is a cash-flow warning, not just a reporting gap.');
    add(analysis.outstanding > analysis.sales * 0.75 && analysis.sales > 0, 'Receipts trail selected-period sales substantially, so collection follow-up should be prioritised.');
    add(analysis.outstanding > analysis.sales * 0.4 && analysis.outstanding <= analysis.sales * 0.75 && analysis.sales > 0, 'The selected-period collection gap is meaningful and should be reviewed customer-wise.');
    add(analysis.outstanding <= analysis.sales * 0.15 && analysis.sales > 0, 'Selected-period receipts are close to sales, indicating healthier cash conversion.');
    add(inactiveCustomers > 0, `${inactiveCustomers} customer(s) had no invoice activity in this range; reactivation calls can be planned from this list.`);
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
    add(analysis.sales > 0 && analysis.activeCustomers === customerCount && customerCount > 0, 'Every customer bought in this period, which is excellent breadth if the date range is not too wide.');
    add(analysis.sales > 0 && analysis.activeCustomers === 1, 'Only one customer bought in this period, making the business highly exposed to a single account.');

    return lines.length > 0 ? lines : ['No significant business signal was detected for this period. Try widening the date range for a stronger read.'];
  }, [analysis, contributionRows, customerAnalysis, customerCount, dailyAnalysis]);

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
    background: 'var(--role-card-background)',
    borderRadius: 12,
    padding: 18,
    color: '#FFFFFF',
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
    color: '#11185A'
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
    borderBottom: '1px solid var(--role-card-border)',
    color: '#FFFFFF'
  };

  const contributionButtonLabels: Record<ContributionGroup, string> = {
    top5: 'Top 5',
    next10: 'Next 10',
    remaining: 'Remaining'
  };

  const renderContributionPie = (title: string, rows: { name: string; value: number; percent: number }[]) => (
    <div style={cardStyle}>
      <div style={{ color: '#D4AF37', fontWeight: 900, marginBottom: 6 }}>{title}</div>
      <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800, marginBottom: 10 }}>Top 5 customers + Others for the selected period.</div>
      {rows.length === 0 ? (
        <div style={{ height: isMobile ? 220 : 260, display: 'grid', placeItems: 'center', color: '#D7DEEA', fontWeight: 800 }}>No contribution data</div>
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
            style={{ ...buttonStyle, background: '#D4AF37', color: '#11185A' }}
          >
            Apply Filter
          </button>
          <DateRangeShortcuts selectedRange={{ fromDate: activeFromDate, toDate: activeToDate }} onSelect={applyDateRange} />
        </div>
      </div>

      <SectionTileNav items={analyticsSections} activeId={activeSection} onSelect={setActiveSection} singleRow />

      {activeSection === 'overview' ? <div style={gridStyle}>
            <div style={cardStyle}>
              <div style={{ color: '#D7DEEA', fontWeight: 800 }}>Sales</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{formatMoney(analysis.sales)}</div>
              <div style={{ color: '#D7DEEA', marginTop: 6 }}>{analysis.invoiceCount} invoice(s)</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#D7DEEA', fontWeight: 800 }}>Profit</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6, color: analysis.profit >= 0 ? '#1B7F3A' : '#B42318' }}>{formatMoney(analysis.profit)}</div>
              <div style={{ color: '#D7DEEA', marginTop: 6 }}>{formatPercent(analysis.margin)} margin</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#D7DEEA', fontWeight: 800 }}>Collected</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6 }}>{formatMoney(analysis.collected)}</div>
              <div style={{ color: '#D7DEEA', marginTop: 6 }}>{formatPercent(analysis.collectionRate)} of sales</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#D7DEEA', fontWeight: 800 }}>Collection Gap</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 6, color: analysis.outstanding > 0 ? '#B42318' : '#1B7F3A' }}>{formatMoney(analysis.outstanding)}</div>
              <div style={{ color: '#D7DEEA', marginTop: 6 }}>Sales less receipts in range</div>
            </div>
          </div> : null}

          {activeSection === 'breakeven' ? <div style={{ ...cardStyle, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900 }}>Breakeven Analysis</div>
                <div style={{ color: '#D7DEEA', marginTop: 4 }}>
                  Fixed cost is allocated from the monthly cost saved in Admin Settings.
                </div>
              </div>
              <div style={{ color: analysis.netProfit >= 0 ? '#1B7F3A' : '#B42318', fontWeight: 900 }}>
                {analysis.fixedCost > 0 ? (analysis.netProfit >= 0 ? 'Above breakeven' : 'Below breakeven') : 'Fixed cost not set'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Gross Profit</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatMoney(analysis.profit)}</div>
              </div>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Allocated Fixed Cost</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatMoney(analysis.fixedCost)}</div>
              </div>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Net After Fixed Cost</div>
                <div style={{ fontWeight: 900, marginTop: 4, color: analysis.netProfit >= 0 ? '#1B7F3A' : '#B42318' }}>{formatMoney(analysis.netProfit)}</div>
              </div>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Sales Needed</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{analysis.fixedCost > 0 ? formatMoney(analysis.breakEvenSalesGap) : '-'}</div>
              </div>
            </div>

            <div style={{ height: 10, borderRadius: 999, background: '#E8EDF4', overflow: 'hidden', marginBottom: 16 }}>
              <div
                style={{
                  width: `${analysis.breakEvenProgress}%`,
                  height: '100%',
                  background: analysis.netProfit >= 0 ? '#1B7F3A' : '#D4AF37'
                }}
              />
            </div>

            <div style={{ color: '#D4AF37', fontWeight: 900, margin: '4px 0 10px' }}>Month-on-Month Breakeven</div>
            <ResponsiveContainer width="100%" height={isMobile ? 240 : 300}>
              <BarChart data={monthlyBreakevenRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8EDF4" />
                <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} tick={{ fill: '#D7DEEA', fontSize: 11 }} />
                <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} axisLine={false} tickLine={false} tick={{ fill: '#D7DEEA', fontSize: 11 }} />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Bar dataKey="netProfit" name="Net After Fixed Cost" radius={[8, 8, 0, 0]}>
                  {monthlyBreakevenRows.map((row) => (
                    <Cell key={row.month} fill={row.netProfit >= 0 ? '#1B7F3A' : '#B42318'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Month', 'Sales', 'Gross Profit', 'Fixed Cost', 'Net', 'Status'].map((header) => (
                      <th key={header} style={{ ...cellStyle, background: 'var(--role-card-subtle)', textAlign: 'left' }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyBreakevenRows.map((row) => (
                    <tr key={row.month}>
                      <td style={cellStyle}><strong>{row.monthLabel}</strong></td>
                      <td style={cellStyle}>{formatMoney(row.sales)}</td>
                      <td style={cellStyle}>{formatMoney(row.grossProfit)}</td>
                      <td style={cellStyle}>{formatMoney(row.fixedCost)}</td>
                      <td style={{ ...cellStyle, color: row.netProfit >= 0 ? '#1B7F3A' : '#B42318', fontWeight: 900 }}>{formatMoney(row.netProfit)}</td>
                      <td style={{ ...cellStyle, fontWeight: 900 }}>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div> : null}

          {activeSection === 'contribution' ? <div style={gridStyle}>
            {renderContributionPie('Sales Contribution', salesPieRows)}
            {renderContributionPie('Profit Contribution', profitPieRows)}
          </div> : null}

          {activeSection === 'insights' ? <div style={gridStyle}>
            {insightCards.map((insight) => (
              <div key={insight.title} style={{ ...cardStyle, borderTop: `4px solid ${getSignalColor(insight.tone)}` }}>
                <div style={{ color: '#D7DEEA', fontWeight: 800 }}>{insight.title}</div>
                <div style={{ color: getSignalColor(insight.tone), fontSize: 28, fontWeight: 900, marginTop: 8 }}>{insight.value}</div>
                <div style={{ color: '#FFFFFF', marginTop: 8, lineHeight: 1.45 }}>{insight.detail}</div>
              </div>
            ))}
          </div> : null}

          {activeSection === 'contribution' ? <div style={{ ...cardStyle, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900 }}>Contribution Explorer</div>
                <div style={{ color: '#D7DEEA', marginTop: 4 }}>Sales and profit contribution by customer group.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['top5', 'next10', 'remaining'] as ContributionGroup[]).map((group) => (
                  <button
                    key={group}
                    type="button"
                    style={{ ...buttonStyle, background: contributionGroup === group ? 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)' : '#E8EDF4', color: contributionGroup === group ? '#FFFFFF' : '#11185A' }}
                    onClick={() => setContributionGroup(group)}
                  >
                    {contributionButtonLabels[group]}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Group Sales</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatMoney(contributionGroupSummary.sales)}</div>
              </div>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Sales %</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatPercent(contributionGroupSummary.salesPercent)}</div>
              </div>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Group Profit</div>
                <div style={{ fontWeight: 900, marginTop: 4, color: contributionGroupSummary.profit >= 0 ? '#1B7F3A' : '#B42318' }}>{formatMoney(contributionGroupSummary.profit)}</div>
              </div>
              <div style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12 }}>
                <div style={{ color: '#D7DEEA', fontSize: 12, fontWeight: 800 }}>Profit %</div>
                <div style={{ fontWeight: 900, marginTop: 4 }}>{formatPercent(contributionGroupSummary.profitPercent)}</div>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {['Customer', 'Invoices', 'Sales', 'Sales %', 'Profit', 'Profit %'].map((header) => (
                      <th key={header} style={{ ...cellStyle, background: 'var(--role-card-subtle)', textAlign: 'left' }}>{header}</th>
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
          </div> : null}

          {activeSection === 'briefing' ? <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ color: '#D4AF37', fontWeight: 900 }}>Business Analyst Briefing</div>
                <div style={{ color: '#D7DEEA', marginTop: 4 }}>
                  Dynamic read of sales, profit, collection, customer concentration, and trend movement.
                </div>
              </div>
              <div style={{ color: '#D7DEEA', fontWeight: 900 }}>{businessBriefing.length} signal(s)</div>
            </div>
            <div style={{ ...latestFiveScrollStyle, maxHeight: 520, display: 'grid', gap: 10, paddingRight: 4 }}>
              {businessBriefing.map((item, index) => (
                <div key={`${index}-${item}`} style={{ background: 'var(--role-card-subtle)', border: '1px solid var(--role-card-border)', borderRadius: 10, padding: 12, fontWeight: 700, lineHeight: 1.45 }}>
                  <span style={{ color: '#D4AF37', fontWeight: 900, marginRight: 8 }}>{index + 1}.</span>
                  {item}
                </div>
              ))}
            </div>
          </div> : null}
    </div>
  );
};

export default Analytics;
