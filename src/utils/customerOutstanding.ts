export interface CustomerOutstandingSource {
  totalOutstandingAmount?: number;
  invoiceOutstandingAmount?: number;
  openingBalanceOutstandingAmount?: number;
  previousOutstandingAmount?: number;
}

export interface CustomerOutstandingDelta {
  invoice?: number;
  openingBalance?: number;
  legacy?: number;
}

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const combineCustomerOutstandingDeltas = (...deltas: CustomerOutstandingDelta[]) => (
  deltas.reduce<CustomerOutstandingDelta>((combined, delta) => ({
    invoice: numberOrZero(combined.invoice) + numberOrZero(delta.invoice),
    openingBalance: numberOrZero(combined.openingBalance) + numberOrZero(delta.openingBalance),
    legacy: numberOrZero(combined.legacy) + numberOrZero(delta.legacy)
  }), {})
);

export const applyCustomerOutstandingDelta = (
  current: CustomerOutstandingSource,
  delta: CustomerOutstandingDelta
) => {
  const currentInvoice = Math.max(0, numberOrZero(current.invoiceOutstandingAmount));
  const currentOpening = Math.max(0, numberOrZero(current.openingBalanceOutstandingAmount));
  const currentTotal = current.totalOutstandingAmount === undefined
    ? currentInvoice + currentOpening + Math.max(0, numberOrZero(current.previousOutstandingAmount))
    : Math.max(0, numberOrZero(current.totalOutstandingAmount));
  const invoiceDelta = numberOrZero(delta.invoice);
  const openingDelta = numberOrZero(delta.openingBalance);
  const legacyDelta = numberOrZero(delta.legacy);

  return {
    totalOutstandingAmount: Math.max(0, currentTotal + invoiceDelta + openingDelta + legacyDelta),
    invoiceOutstandingAmount: Math.max(0, currentInvoice + invoiceDelta),
    openingBalanceOutstandingAmount: Math.max(0, currentOpening + openingDelta)
  };
};
