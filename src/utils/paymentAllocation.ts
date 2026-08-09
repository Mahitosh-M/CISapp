export interface PendingInvoiceInput {
  id: string;
  pendingAmount: number;
}

export interface PaymentEffectInput {
  id?: string;
  invoiceId: string;
  amount: number;
  amountAppliedToInvoice?: number;
  cashDiscount?: number;
}

export interface InvoiceBalanceInput {
  id: string;
  totalSales: number;
}

export const allocateReceiptOldestFirst = <T extends PendingInvoiceInput>(
  pendingInvoices: T[],
  amount: number,
  cashDiscount: number
) => {
  const cleanAmount = Math.max(0, Number(amount) || 0);
  const cleanDiscount = Math.max(0, Number(cashDiscount) || 0);
  let remainingEffect = cleanAmount + cleanDiscount;
  let remainingAmount = cleanAmount;
  let remainingDiscount = cleanDiscount;

  const allocations = pendingInvoices.map((invoice) => {
    const pendingAmount = Math.max(0, Number(invoice.pendingAmount) || 0);
    const appliedTotal = Math.min(pendingAmount, remainingEffect);
    const amountAppliedToInvoice = Math.min(remainingAmount, appliedTotal);
    const appliedDiscount = Math.min(remainingDiscount, appliedTotal - amountAppliedToInvoice);

    remainingEffect -= appliedTotal;
    remainingAmount -= amountAppliedToInvoice;
    remainingDiscount -= appliedDiscount;

    return {
      invoice,
      amount: amountAppliedToInvoice,
      amountAppliedToInvoice,
      cashDiscount: appliedDiscount,
      appliedTotal
    };
  });

  const allPendingInvoicesPaid = allocations.every(
    (allocation) => allocation.appliedTotal >= Math.max(0, Number(allocation.invoice.pendingAmount) || 0)
  );
  const advanceAmount = allPendingInvoicesPaid ? Math.max(0, remainingAmount) : 0;

  // Keep the excess cash on the final receipt so its advanceCreatedAmount is auditable.
  if (advanceAmount > 0 && allocations.length > 0) {
    allocations[allocations.length - 1].amount += advanceAmount;
  }

  return {
    allocations,
    appliedTotal: allocations.reduce((sum, allocation) => sum + allocation.appliedTotal, 0),
    appliedCashAmount: allocations.reduce((sum, allocation) => sum + allocation.amountAppliedToInvoice, 0),
    advanceAmount,
    allPendingInvoicesPaid
  };
};

const getPaymentEffect = (payment: PaymentEffectInput) => (
  Math.max(0, Number(payment.amountAppliedToInvoice ?? payment.amount) || 0)
  + Math.max(0, Number(payment.cashDiscount) || 0)
);

export const getUnpaidInvoicesAfterPayment = <T extends InvoiceBalanceInput>(
  invoices: T[],
  existingPayments: PaymentEffectInput[],
  candidatePayment: PaymentEffectInput,
  ignoredPaymentId = ''
) => {
  const paidByInvoiceId = new Map<string, number>();

  existingPayments.forEach((payment) => {
    if (!payment.invoiceId || payment.id === ignoredPaymentId) return;
    paidByInvoiceId.set(
      payment.invoiceId,
      (paidByInvoiceId.get(payment.invoiceId) ?? 0) + getPaymentEffect(payment)
    );
  });

  if (candidatePayment.invoiceId) {
    paidByInvoiceId.set(
      candidatePayment.invoiceId,
      (paidByInvoiceId.get(candidatePayment.invoiceId) ?? 0) + getPaymentEffect(candidatePayment)
    );
  }

  return invoices.filter((invoice) => (
    Math.max(0, Number(invoice.totalSales) || 0) - (paidByInvoiceId.get(invoice.id) ?? 0) > 0
  ));
};
