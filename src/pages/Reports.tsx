import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import StatCard from '../components/StatCard';
import { useErpData } from '../hooks/useErpData';
import { getGiftHistory } from '../services/firestoreService';
import type { CustomerTier, GiftHistory } from '../types';
import { buildCustomerScoresForDateRange } from '../utils/customerAnalytics';
import { getCurrentMonthRange, getMonthValue, getYearValue, isDateInRange } from '../utils/dateUtils';
import { formatMoney } from '../utils/formatters';
import { latestEntriesNotice, latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { getInvoicePaymentEffect, getPendingAmount } from '../utils/paymentUtils';
import { calculateDynamicDueDate } from '../utils/settings';

type ReportType = 'sales' | 'profit' | 'payments' | 'outstanding' | 'ranking' | 'tier' | 'gifts';

type ReportRow = Record<string, string | number>;

interface ReportFilters {
  fromDate: string;
  toDate: string;
  customerId: string;
  month: string;
  year: string;
  tier: string;
  area: string;
}

const reportOptions: { value: ReportType; label: string }[] = [
  { value: 'sales', label: 'Sales Report' },
  { value: 'profit', label: 'Profit Report' },
  { value: 'payments', label: 'Payment Report' },
  { value: 'outstanding', label: 'Outstanding Report' },
  { value: 'ranking', label: 'Customer Ranking Report' },
  { value: 'tier', label: 'Tier Report' },
  { value: 'gifts', label: 'Gift Report' }
];

const monthOptions = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

const escapeHtml = (value: string | number) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const downloadFile = (content: BlobPart, fileName: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const buildReportTableHtml = (title: string, headers: string[], rows: ReportRow[]) => {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const rowHtml = rows
    .map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? '')}</td>`).join('')}</tr>`)
    .join('');

  return `
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0B1F3A; padding: 24px; }
          h1 { color: #0B1F3A; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #0B1F3A; color: #FFFFFF; }
          th, td { border: 1px solid #D8DEE9; padding: 10px; text-align: left; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table>
      </body>
    </html>
  `;
};

const getOutstandingStatus = (dueDate: string, outstanding: number) => {
  if (outstanding <= 0) return 'Paid';
  if (dueDate < new Date().toISOString().slice(0, 10)) return 'Overdue';
  return 'Open';
};

const Reports = () => {
  const { customers, invoices, payments, settings, loading, error } = useErpData();
  const { userProfile } = useAuth();
  const [giftHistory, setGiftHistory] = useState<GiftHistory[]>([]);
  const [giftError, setGiftError] = useState('');
  const defaultRange = useMemo(() => getCurrentMonthRange(), []);
  const defaultFilters: ReportFilters = {
    fromDate: defaultRange.fromDate,
    toDate: defaultRange.toDate,
    customerId: 'all',
    month: 'all',
    year: 'all',
    tier: 'all',
    area: 'all'
  };

  const [reportType, setReportType] = useState<ReportType>('sales');
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(defaultFilters);
  const [activeFilters, setActiveFilters] = useState<ReportFilters>(defaultFilters);

  useEffect(() => {
    getGiftHistory()
      .then(setGiftHistory)
      .catch((err) => setGiftError(err instanceof Error ? err.message : 'Unable to load gift history.'));
  }, []);

  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    invoices.forEach((invoice) => years.add(getYearValue(invoice.date)));
    payments.forEach((payment) => years.add(getYearValue(payment.date)));
    return [...years].filter(Boolean).sort((a, b) => b.localeCompare(a));
  }, [invoices, payments]);

  const matchesCommonFilters = (dateString: string, customerId: string) => {
    const customer = customerById.get(customerId);
    const matchesDate = isDateInRange(dateString, activeFilters.fromDate, activeFilters.toDate);
    const matchesCustomer = activeFilters.customerId === 'all' || customerId === activeFilters.customerId;
    const matchesMonth = activeFilters.month === 'all' || getMonthValue(dateString) === activeFilters.month;
    const matchesYear = activeFilters.year === 'all' || getYearValue(dateString) === activeFilters.year;
    const matchesTier = activeFilters.tier === 'all' || customer?.tier === activeFilters.tier;
    const matchesArea = activeFilters.area === 'all' || customer?.area === activeFilters.area;

    return matchesDate && matchesCustomer && matchesMonth && matchesYear && matchesTier && matchesArea;
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => matchesCommonFilters(invoice.date, invoice.customerId));
  }, [activeFilters, invoices, customerById]);

  const filteredPayments = useMemo(() => {
    return payments.filter((payment) => matchesCommonFilters(payment.date, payment.customerId));
  }, [activeFilters, payments, customerById]);

  const filteredGiftHistory = useMemo(() => {
    return giftHistory.filter((gift) => matchesCommonFilters(gift.giftGivenDate || gift.giftedDate || gift.createdAt.slice(0, 10), gift.customerId));
  }, [activeFilters, giftHistory, customerById]);

  const getPaidAmountForInvoice = (invoiceId: string) => {
    // Outstanding always uses every payment linked to the invoice, not only visible payment-report rows.
    return payments.filter((payment) => payment.invoiceId === invoiceId).reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
  };

  const filteredOutstandingCustomers = useMemo(() => {
    return customers.filter((customer) => {
      const matchesCustomer = activeFilters.customerId === 'all' || customer.id === activeFilters.customerId;
      const matchesTier = activeFilters.tier === 'all' || customer.tier === activeFilters.tier;
      const matchesArea = activeFilters.area === 'all' || customer.area === activeFilters.area;

      return matchesCustomer && matchesTier && matchesArea;
    });
  }, [activeFilters, customers]);

  const filteredScores = useMemo(() => {
    return buildCustomerScoresForDateRange(customers, invoices, payments, activeFilters.fromDate, activeFilters.toDate, settings)
      .filter((score) => activeFilters.customerId === 'all' || score.customerId === activeFilters.customerId)
      .filter((score) => activeFilters.tier === 'all' || score.tier === activeFilters.tier)
      .filter((score) => activeFilters.area === 'all' || score.customerArea === activeFilters.area)
      .filter((score) => score.totalSales > 0 || score.totalPayments > 0 || score.outstanding !== 0);
  }, [activeFilters, customers, invoices, payments, settings]);

  const salesRows = filteredInvoices.map((invoice) => {
    const paid = getPaidAmountForInvoice(invoice.id);
    return {
      Invoice: invoice.invoiceNumber,
      Date: invoice.date,
      Customer: invoice.customerName,
      Tier: customerById.get(invoice.customerId)?.tier ?? '-',
      Sales: formatMoney(invoice.totalSales),
      Paid: formatMoney(paid),
      Outstanding: formatMoney(getPendingAmount(invoice.totalSales, paid))
    };
  });

  const profitRows = filteredInvoices.map((invoice) => ({
    Invoice: invoice.invoiceNumber,
    Date: invoice.date,
    Customer: invoice.customerName,
    Sales: formatMoney(invoice.totalSales),
    Cost: formatMoney(invoice.costAmount),
    Transport: formatMoney(invoice.transportAmount),
    Profit: formatMoney(invoice.totalProfit)
  }));

  const paymentRows = filteredPayments.map((payment) => ({
    Date: payment.date,
    Customer: payment.customerName,
    Invoice: payment.invoiceNumber,
    Amount: formatMoney(payment.amount),
    'Cash Discount': formatMoney(payment.cashDiscount),
    Mode: payment.mode,
    Notes: payment.notes || '-'
  }));

  const outstandingRowsData = filteredOutstandingCustomers
    .map((customer) => {
      const customerInvoices = filteredInvoices.filter((invoice) => invoice.customerId === customer.id);
      const invoiceIds = new Set(customerInvoices.map((invoice) => invoice.id));
      const newSales = customerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
      const linkedPayments = payments
        .filter((payment) => invoiceIds.has(payment.invoiceId))
        .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
      const unallocatedPeriodPayments = filteredPayments
        .filter((payment) => payment.customerId === customer.id && !payment.invoiceId)
        .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
      const newPayments = linkedPayments + unallocatedPeriodPayments;
      // Previous outstanding is the opening balance from before this ERP; reports add it to new invoice outstanding.
      const previousOutstanding = customer.previousOutstandingAmount ?? 0;
      const newOutstanding = getPendingAmount(newSales, newPayments);
      const totalOutstanding = previousOutstanding + newOutstanding;
      const hasOverdueInvoice = customerInvoices.some((invoice) => {
        const invoiceOutstanding = getPendingAmount(invoice.totalSales, getPaidAmountForInvoice(invoice.id));
        const effectiveDueDate = calculateDynamicDueDate(invoice.date, customer.tier, settings);
        return getOutstandingStatus(effectiveDueDate, invoiceOutstanding) === 'Overdue';
      });

      return {
        customer,
        newSales,
        newPayments,
        previousOutstanding,
        newOutstanding,
        totalOutstanding,
        status: totalOutstanding <= 0 ? 'Paid' : hasOverdueInvoice ? 'Overdue' : 'Open'
      };
    })
    .filter((row) => row.previousOutstanding > 0 || row.newOutstanding > 0 || row.totalOutstanding > 0);

  const outstandingRows = outstandingRowsData.map((row) => ({
    SortDate: row.customer.updatedAt || row.customer.createdAt,
    Customer: row.customer.name,
    Tier: row.customer.tier,
    Area: row.customer.area || '-',
    'Previous Outstanding': formatMoney(row.previousOutstanding),
    'New Sales': formatMoney(row.newSales),
    'New Payments': formatMoney(row.newPayments),
    'Invoice Outstanding': formatMoney(row.newOutstanding),
    'Total Outstanding': formatMoney(row.totalOutstanding),
    Status: row.status
  }));

  const rankingRows = filteredScores.map((score) => ({
    Rank: score.rank,
    Customer: score.customerName,
    Tier: score.tier,
    Score: score.intelligenceScore,
    Sales: formatMoney(score.totalSales),
    Profit: formatMoney(score.totalProfit),
    Outstanding: formatMoney(score.outstanding),
    'Gift Budget': formatMoney(score.giftBudget),
    Overdue: score.overdueStatus
  }));

  const tierRows = (['Tier 1', 'Tier 2', 'Tier 3'] as CustomerTier[]).map((tier) => {
    const tierScores = filteredScores.filter((score) => score.tier === tier);
    return {
      Tier: tier,
      Customers: tierScores.length,
      Sales: formatMoney(tierScores.reduce((sum, score) => sum + score.totalSales, 0)),
      Profit: formatMoney(tierScores.reduce((sum, score) => sum + score.totalProfit, 0)),
      Outstanding: formatMoney(tierScores.reduce((sum, score) => sum + score.outstanding, 0)),
      'Gift Budget': formatMoney(tierScores.reduce((sum, score) => sum + score.giftBudget, 0))
    };
  });

  const giftRows = filteredGiftHistory.map((gift) => ({
    Date: gift.giftGivenDate || gift.giftedDate || gift.createdAt.slice(0, 10),
    Customer: gift.customerName,
    Tier: gift.tier,
    Period: `${gift.periodStart} to ${gift.periodEnd}`,
    Profit: formatMoney(gift.profitConsidered),
    Percentage: `${gift.giftPercentage}%`,
    Status: gift.status,
    'Suggested Budget': formatMoney(gift.suggestedGiftBudget),
    'Gift Amount': formatMoney(gift.actualGiftAmount),
    'Gifted By': gift.giftedBy || gift.approvedBy,
    Notes: gift.notes || '-'
  }));

  const rowsByReport: Record<ReportType, ReportRow[]> = {
    sales: salesRows,
    profit: profitRows,
    payments: paymentRows,
    outstanding: outstandingRows,
    ranking: rankingRows,
    tier: tierRows,
    gifts: giftRows
  };

  const headersByReport: Record<ReportType, string[]> = {
    sales: ['Invoice', 'Date', 'Customer', 'Tier', 'Sales', 'Paid', 'Outstanding'],
    profit: ['Invoice', 'Date', 'Customer', 'Sales', 'Cost', 'Transport', 'Profit'],
    payments: ['Date', 'Customer', 'Invoice', 'Amount', 'Cash Discount', 'Mode', 'Notes'],
    outstanding: ['Customer', 'Tier', 'Area', 'Previous Outstanding', 'New Sales', 'New Payments', 'Invoice Outstanding', 'Total Outstanding', 'Status'],
    ranking: ['Rank', 'Customer', 'Tier', 'Score', 'Sales', 'Profit', 'Outstanding', 'Gift Budget', 'Overdue'],
    tier: ['Tier', 'Customers', 'Sales', 'Profit', 'Outstanding', 'Gift Budget'],
    gifts: ['Date', 'Customer', 'Tier', 'Period', 'Profit', 'Percentage', 'Status', 'Suggested Budget', 'Gift Amount', 'Gifted By', 'Notes']
  };

  const activeRows = sortNewestFirst(rowsByReport[reportType], ['Date', 'SortDate', 'Due', 'Period']);
  const activeHeaders = headersByReport[reportType];
  const activeTitle = reportOptions.find((option) => option.value === reportType)?.label ?? 'Report';

  const summary = {
    sales: filteredInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0),
    profit: filteredInvoices.reduce((sum, invoice) => sum + invoice.totalProfit, 0),
    payments: filteredPayments.reduce((sum, payment) => sum + payment.amount, 0),
    outstanding: outstandingRowsData.reduce((sum, row) => sum + row.totalOutstanding, 0),
    gifts: filteredGiftHistory.reduce((sum, gift) => sum + gift.actualGiftAmount, 0)
  };

  const handleFilterChange = (field: keyof ReportFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  };

  const handleApplyFilters = () => {
    setActiveFilters(draftFilters);
  };

  const areaOptions = useMemo(() => {
    return [...new Set(customers.map((customer) => customer.area).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [customers]);

  const handleExportExcel = () => {
    const html = buildReportTableHtml(activeTitle, activeHeaders, activeRows);
    downloadFile(html, `${reportType}-report.xls`, 'application/vnd.ms-excel');
  };

  const handleExportPdf = () => {
    const printWindow = window.open('', '_blank', 'width=1000,height=720');

    if (!printWindow) return;

    printWindow.document.write(buildReportTableHtml(activeTitle, activeHeaders, activeRows));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    color: '#0B1F3A',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 14
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 12px',
    borderRadius: 10,
    border: '1px solid #D8DEE9',
    marginTop: 6,
    color: '#0B1F3A'
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontWeight: 700,
    fontSize: 13
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: 880,
    borderCollapse: 'collapse'
  };

  const headerCellStyle: CSSProperties = {
    padding: '14px 16px',
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4',
    textAlign: 'left',
    color: '#0B1F3A',
    fontSize: 13,
    fontWeight: 800
  };

  const cellStyle: CSSProperties = {
    padding: '14px 16px',
    borderBottom: '1px solid #E8EDF4',
    color: '#0B1F3A'
  };

  if (loading) {
    return <SectionHeader title="Reports" description="Loading Firestore report data..." />;
  }

  if (userProfile?.role === 'Staff' && !settings.staffPermissions.canViewReports) {
    return (
      <SectionHeader
        title="Reports"
        description="Reports are currently limited to Admin users. An Admin can enable Staff report access in Settings."
      />
    );
  }

  return (
    <div>
      <SectionHeader
        title="Reports"
        description="Default range is the current month. Use filters to review historical customer, month, year, tier, and gift data."
      />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {giftError ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{giftError}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 18, marginBottom: 24 }}>
        <StatCard title="Sales" value={formatMoney(summary.sales)} subtitle="Filtered invoice sales" />
        <StatCard title="Profit" value={formatMoney(summary.profit)} subtitle="Filtered estimated profit" />
        <StatCard title="Payments" value={formatMoney(summary.payments)} subtitle="Filtered payment receipts" />
        <StatCard title="Outstanding" value={formatMoney(summary.outstanding)} subtitle="Previous + filtered new outstanding" color="#EB5757" />
        <StatCard title="Gifts" value={formatMoney(summary.gifts)} subtitle="Filtered gift history" />
      </div>

      <div style={cardStyle}>
        <div style={gridStyle}>
          <label style={labelStyle}>
            Report
            <select style={inputStyle} value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}>
              {reportOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            From Date
            <input style={inputStyle} type="date" value={draftFilters.fromDate} onChange={(event) => handleFilterChange('fromDate', event.target.value)} />
          </label>

          <label style={labelStyle}>
            To Date
            <input style={inputStyle} type="date" value={draftFilters.toDate} onChange={(event) => handleFilterChange('toDate', event.target.value)} />
          </label>

          <label style={labelStyle}>
            Customer
            <select style={inputStyle} value={draftFilters.customerId} onChange={(event) => handleFilterChange('customerId', event.target.value)}>
              <option value="all">All customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Month
            <select style={inputStyle} value={draftFilters.month} onChange={(event) => handleFilterChange('month', event.target.value)}>
              <option value="all">All months</option>
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Year
            <select style={inputStyle} value={draftFilters.year} onChange={(event) => handleFilterChange('year', event.target.value)}>
              <option value="all">All years</option>
              {availableYears.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Tier
            <select style={inputStyle} value={draftFilters.tier} onChange={(event) => handleFilterChange('tier', event.target.value)}>
              <option value="all">All tiers</option>
              <option value="Tier 1">Tier 1</option>
              <option value="Tier 2">Tier 2</option>
              <option value="Tier 3">Tier 3</option>
            </select>
          </label>

          <label style={labelStyle}>
            Area
            <select style={inputStyle} value={draftFilters.area} onChange={(event) => handleFilterChange('area', event.target.value)}>
              <option value="all">All areas</option>
              {areaOptions.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }} onClick={handleApplyFilters}>
            Apply Filter
          </button>
          <button type="button" style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF' }} onClick={handleExportPdf}>
            Export PDF
          </button>
          <button type="button" style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A' }} onClick={handleExportExcel}>
            Export Excel
          </button>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: '#D4AF37', fontWeight: 800, marginBottom: 12 }}>{activeTitle}</div>
        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 8 }}>{latestEntriesNotice}</div>
        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto', borderRadius: 14, border: '1px solid #E8EDF4' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {activeHeaders.map((header) => (
                  <th key={header} style={headerCellStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 ? (
                <tr><td style={cellStyle} colSpan={activeHeaders.length}>No report rows found for the selected filters.</td></tr>
              ) : (
                activeRows.map((row, index) => (
                  <tr key={`${reportType}-${index}`}>
                    {activeHeaders.map((header) => (
                      <td key={header} style={cellStyle}>{row[header]}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Reports;
