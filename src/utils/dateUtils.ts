// Dates are stored as yyyy-mm-dd strings so Firestore filtering and form inputs stay simple.
export const getTodayDateString = () => new Date().toISOString().slice(0, 10);

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

export const getLastMonthRange = () => {
  const today = new Date();
  const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastDayOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

  return {
    fromDate: firstDayOfLastMonth.toISOString().slice(0, 10),
    toDate: lastDayOfLastMonth.toISOString().slice(0, 10)
  };
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
