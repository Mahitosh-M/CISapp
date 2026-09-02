import { describe, expect, it } from 'vitest';
import { applyCustomerOutstandingDelta, combineCustomerOutstandingDeltas } from './customerOutstanding';

describe('atomic customer outstanding', () => {
  it('stores only the unpaid part after an invoice and same-day payment', () => {
    const afterInvoice = applyCustomerOutstandingDelta({ totalOutstandingAmount: 0 }, { invoice: 100 });
    const afterPayment = applyCustomerOutstandingDelta(afterInvoice, { invoice: -80 });

    expect(afterInvoice.totalOutstandingAmount).toBe(100);
    expect(afterPayment.totalOutstandingAmount).toBe(20);
    expect(afterPayment.invoiceOutstandingAmount).toBe(20);
  });

  it('adds the full invoice when no payment is made', () => {
    expect(applyCustomerOutstandingDelta(
      { totalOutstandingAmount: 250, invoiceOutstandingAmount: 250 },
      { invoice: 100 }
    )).toMatchObject({
      totalOutstandingAmount: 350,
      invoiceOutstandingAmount: 350
    });
  });

  it('combines split-payment parts into one net outstanding reduction', () => {
    const splitPaymentDelta = combineCustomerOutstandingDeltas(
      { invoice: -50 },
      { invoice: -30 }
    );

    expect(applyCustomerOutstandingDelta(
      { totalOutstandingAmount: 100, invoiceOutstandingAmount: 100 },
      splitPaymentDelta
    ).totalOutstandingAmount).toBe(20);
  });

  it('never stores a negative outstanding balance', () => {
    expect(applyCustomerOutstandingDelta(
      { totalOutstandingAmount: 20, invoiceOutstandingAmount: 20 },
      { invoice: -50 }
    )).toMatchObject({
      totalOutstandingAmount: 0,
      invoiceOutstandingAmount: 0
    });
  });
});
