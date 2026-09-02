export const formatMoney = (value: number) => `Rs. ${Math.round(value || 0).toLocaleString()}`;

export const formatNumber = (value: number) => Math.round(value || 0).toLocaleString();

export const formatDate = (dateString?: string) => {
  if (!dateString) return '-';

  const datePart = dateString.slice(0, 10);
  const [year, month, day] = datePart.split('-');

  if (!year || !month || !day) return dateString;

  return `${day}-${month}-${year}`;
};

const shortMonthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const formatShortDate = (dateString?: string) => {
  if (!dateString) return '-';

  const [, month = '', day = ''] = dateString.slice(0, 10).match(/^\d{4}-(\d{2})-(\d{2})$/) ?? [];
  const monthName = shortMonthNames[Number(month) - 1];

  return monthName && day ? `${day}-${monthName}` : dateString;
};

export const formatDateRange = (startDate?: string, endDate?: string) => {
  if (startDate && endDate) return `${formatDate(startDate)} to ${formatDate(endDate)}`;
  if (startDate) return `From ${formatDate(startDate)}`;
  if (endDate) return `Until ${formatDate(endDate)}`;
  return 'Open';
};
