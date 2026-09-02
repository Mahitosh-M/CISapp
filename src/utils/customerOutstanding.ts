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

interface InvoiceLedgerInput {
  id: string;
  totalSales: number;
  date: string;
  createdAt: string;
}

interface PaymentLedgerInput {
  id: string;
  amount: number;
  amountAppliedToInvoice?: number;
  amountUsedForOldBalance?: number;
  cashDiscount?: number;
  date: string;
  createdAt: string;
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

export const buildInvoiceBalanceCheckpoints = (
  invoices: InvoiceLedgerInput[],
  payments: PaymentLedgerInput[]
) => {
  const events = [
    ...invoices.map((invoice) => ({
      id: invoice.id,
      kind: 'invoice' as const,
      timestamp: invoice.createdAt || `${invoice.date}T00:00:00.000Z`,
      delta: Math.max(0, numberOrZero(invoice.totalSales))
    })),
    ...payments.map((payment) => ({
      id: payment.id,
      kind: 'payment' as const,
      timestamp: payment.createdAt || `${payment.date}T00:00:00.000Z`,
      delta: -(
        Math.max(0, numberOrZero(payment.amountAppliedToInvoice ?? payment.amount))
        + Math.max(0, numberOrZero(payment.amountUsedForOldBalance))
        + Math.max(0, numberOrZero(payment.cashDiscount))
      )
    }))
  ].sort((left, right) => (
    left.timestamp.localeCompare(right.timestamp)
    || (left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind === 'invoice' ? -1 : 1)
  ));
  const balanceByInvoiceId: Record<string, number> = {};
  let balance = 0;
  let latestInvoiceId = '';

  events.forEach((event) => {
    balance = Math.max(0, balance + event.delta);
    if (event.kind === 'invoice') latestInvoiceId = event.id;
    if (latestInvoiceId) balanceByInvoiceId[latestInvoiceId] = balance;
  });

  return {
    balanceByInvoiceId,
    latestInvoiceId,
    totalOutstandingAmount: balance
  };
};
