// Dates are stored as yyyy-mm-dd strings so Firestore filtering and form inputs stay simple.
export const getTodayDateString = () => new Date().toISOString().slice(0, 10);

const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

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
  const lastDayOfCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // Manual formatting avoids timezone shifts around midnight in date input values.
  return {
    fromDate: formatDateInputValue(firstDayOfCurrentMonth),
    toDate: formatDateInputValue(lastDayOfCurrentMonth)
  };
};

export const getLastMonthRange = () => {
  const today = new Date();
  const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastDayOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

  return {
    fromDate: firstDayOfLastMonth.toISOString().slice(0, 10),
    toDate: lastDayOfLastMonth.toISOString().slice(0, 10)
  };
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
