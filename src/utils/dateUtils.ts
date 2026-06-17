// Dates are stored as yyyy-mm-dd strings so Firestore filtering and form inputs stay simple.
export const getTodayDateString = () => new Date().toISOString().slice(0, 10);

const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export interface DateRange {
  fromDate: string;
  toDate: string;
}

export type DateRangeShortcutKey = 'this_month' | 'last_month' | 'last_quarter' | 'last_6_months' | 'last_year';

export const addDaysToDateString = (dateString: string, days: number) => {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const getPrevious30DaysRange = () => {
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - 30);

  return {
    fromDate: fromDate.toISOString().slice(0, 10),
    toDate: today.toISOString().slice(0, 10)
  };
};

export const getCurrentMonthRange = () => {
  const today = new Date();
  const firstDayOfCurrentMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  // Manual formatting avoids timezone shifts around midnight in date input values.
  return {
    fromDate: formatDateInputValue(firstDayOfCurrentMonth),
    toDate: formatDateInputValue(today)
  };
};

export const getLastMonthRange = () => {
  const today = new Date();
  const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastDayOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

  return {
    fromDate: formatDateInputValue(firstDayOfLastMonth),
    toDate: formatDateInputValue(lastDayOfLastMonth)
  };
};

const getQuarterStartMonth = (month: number) => {
  if (month >= 3 && month <= 5) return 3;
  if (month >= 6 && month <= 8) return 6;
  if (month >= 9 && month <= 11) return 9;
  return 0;
};

export const getLastFinancialQuarterRange = () => {
  const today = new Date();
  const currentQuarterStartMonth = getQuarterStartMonth(today.getMonth());
  const currentQuarterStartYear = currentQuarterStartMonth === 0 && today.getMonth() < 3 ? today.getFullYear() : today.getFullYear();
  const currentQuarterStart = new Date(currentQuarterStartYear, currentQuarterStartMonth, 1);
  const firstDayOfLastQuarter = new Date(currentQuarterStart.getFullYear(), currentQuarterStart.getMonth() - 3, 1);
  const lastDayOfLastQuarter = new Date(currentQuarterStart.getFullYear(), currentQuarterStart.getMonth(), 0);

  return {
    fromDate: formatDateInputValue(firstDayOfLastQuarter),
    toDate: formatDateInputValue(lastDayOfLastQuarter)
  };
};

export const getLastSixMonthsRange = () => {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);

  return {
    fromDate: formatDateInputValue(firstDay),
    toDate: formatDateInputValue(lastDay)
  };
};

export const getLastFinancialYearRange = () => {
  const today = new Date();
  const currentFinancialYearStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  const previousFinancialYearStart = new Date(currentFinancialYearStartYear - 1, 3, 1);
  const previousFinancialYearEnd = new Date(currentFinancialYearStartYear, 2, 31);

  return {
    fromDate: formatDateInputValue(previousFinancialYearStart),
    toDate: formatDateInputValue(previousFinancialYearEnd)
  };
};

export const getDateRangeShortcut = (shortcut: DateRangeShortcutKey): DateRange => {
  if (shortcut === 'this_month') return getCurrentMonthRange();
  if (shortcut === 'last_quarter') return getLastFinancialQuarterRange();
  if (shortcut === 'last_6_months') return getLastSixMonthsRange();
  if (shortcut === 'last_year') return getLastFinancialYearRange();
  return getLastMonthRange();
};

export const getDateRangeForReportPeriod = (period: 'current_month' | 'last_month' | 'previous_30_days') => {
  if (period === 'last_month') return getLastMonthRange();
  if (period === 'previous_30_days') return getPrevious30DaysRange();
  return getCurrentMonthRange();
};

export const getMonthsAgoDateString = (monthsAgo: number) => {
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth() - monthsAgo, today.getDate());
  return date.toISOString().slice(0, 10);
};

export const isDateInRange = (dateString: string, fromDate: string, toDate: string) => {
  return dateString >= fromDate && dateString <= toDate;
};

export const getMonthValue = (dateString: string) => dateString.slice(5, 7);

export const getYearValue = (dateString: string) => dateString.slice(0, 4);
