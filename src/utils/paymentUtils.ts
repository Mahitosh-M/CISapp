import type { Payment } from '../types';

export const getAmountAppliedToInvoice = (payment: Payment) => {
  // Existing payment documents do not have allocation fields, so they still apply their full amount to invoices.
  return Math.max(0, payment.amountAppliedToInvoice ?? payment.amount);
};

export const getInvoicePaymentEffect = (payment: Payment) => {
  // Invoice outstanding should only reduce by the amount left after clearing old balance, plus cash discount.
  return getAmountAppliedToInvoice(payment) + Math.max(0, payment.cashDiscount ?? 0);
};
