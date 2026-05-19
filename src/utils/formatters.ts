export const formatMoney = (value: number) => `Rs. ${Math.round(value || 0).toLocaleString()}`;

export const formatNumber = (value: number) => Math.round(value || 0).toLocaleString();
