export const formatMoney = (value: number) => `Rs. ${Math.round(value || 0).toLocaleString()}`;

export const formatNumber = (value: number) => Math.round(value || 0).toLocaleString();

export const formatDate = (dateString?: string) => {
  if (!dateString) return '-';

  const datePart = dateString.slice(0, 10);
  const [year, month, day] = datePart.split('-');

  if (!year || !month || !day) return dateString;

  return `${day}-${month}-${year}`;
};

export const formatDateRange = (startDate?: string, endDate?: string) => {
  if (startDate && endDate) return `${formatDate(startDate)} to ${formatDate(endDate)}`;
  if (startDate) return `From ${formatDate(startDate)}`;
  if (endDate) return `Until ${formatDate(endDate)}`;
  return 'Open';
};
