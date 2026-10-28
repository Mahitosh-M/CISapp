/** Final transaction amounts are whole rupees. Calculation rates may retain paise. */
export function requireWholeRupees(value: number, label = 'Amount') {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole rupee amount`);
  return value;
}

export function roundCashBalance(balance: number, delta = 0) {
  if (!Number.isFinite(balance) || !Number.isFinite(delta)) throw new Error('Invalid cash balance');
  const rawPaise = Math.round((balance + delta) * 100);
  if (!Number.isSafeInteger(rawPaise)) throw new Error('Cash balance is too large');
  const availableBalance = Math.sign(rawPaise) * Math.floor((Math.abs(rawPaise) + 50) / 100) || 0;
  const adjustment = (availableBalance * 100 - rawPaise) / 100;
  return { availableBalance, adjustment, rawBalance: rawPaise / 100 };
}
