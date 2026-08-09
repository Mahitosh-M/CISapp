import { describe, expect, it } from 'vitest';
import type { Customer, Invoice, Payment } from '../types';
import {
  buildAutomaticBonusCandidates,
  FIXED_BONUS_PC,
  getBonusPcLedgerId,
  getNewCustomerBonusRequestIds,
  getReferralBonusId
} from './bonusPc';
import { DEFAULT_SETTINGS } from './settings';

const customer: Customer = {
  id: 'customer-1',
  name: 'Customer One',
  mobile: '',
  area: '',
  tier: 'Tier 4',
  previousOutstandingAmount: 0,
  advanceBalance: 0,
  paymentTerms: '',
  notes: '',
  createdAt: '2026-01-01T00:00:00.000Z'
};

const invoice = (id: string, date: string, dueDate: string, totalSales = 10_000): Invoice => ({
  id,
  invoiceNumber: id,
  customerId: customer.id,
  customerName: customer.name,
  date,
  dueDate,
  savedDueDate: dueDate,
  tierAtInvoice: 'Tier 4',
  pcPercentageAtInvoice: 1,
  creditDaysAtInvoice: 0,
  bufferDaysAtInvoice: 0,
  finalPcCutoffDate: dueDate,
  salesAmount: totalSales,
  costAmount: 8_000,
  transportAmount: 0,
  totalSales,
  totalCost: 8_000,
  totalProfit: totalSales - 8_000,
  notes: '',
  createdAt: `${date}T00:00:00.000Z`
});

const payment = (invoiceId: string, date: string, amount = 10_000): Payment => ({
  id: `${invoiceId}-${date}`,
  invoiceId,
  invoiceNumber: invoiceId,
  customerId: customer.id,
  customerName: customer.name,
  date,
  amount,
  amountAppliedToInvoice: amount,
  advanceCreatedAmount: 0,
  advanceAppliedAmount: 0,
  amountUsedForOldBalance: 0,
  oldBalanceBeforePayment: 0,
  oldBalanceAfterPayment: 0,
  cashDiscount: 0,
  mode: 'Cash',
  notes: '',
  createdAt: `${date}T00:00:00.000Z`
});

describe('automatic PC bonuses', () => {
  it('uses only the four fixed bonus values', () => {
    expect(FIXED_BONUS_PC).toEqual({
      monthly_target: 5,
      clean_payment_month: 5,
      new_customer: 20,
      referral: 50
    });
  });

  it('awards the welcome candidate only after the first valid invoice is fully paid', () => {
    const first = invoice('first', '2026-05-02', '2026-05-02');
    expect(buildAutomaticBonusCandidates(customer, [first], [], DEFAULT_SETTINGS, '2026-05', '2026-05-10'))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ bonusType: 'new_customer' })]));
    expect(buildAutomaticBonusCandidates(customer, [first], [payment(first.id, '2026-05-04')], DEFAULT_SETTINGS, '2026-05', '2026-05-10'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: `newCustomerWelcome:${customer.id}` })]));
  });

  it('recognizes legacy and current one-time welcome bonus records', () => {
    expect(getNewCustomerBonusRequestIds(customer.id)).toEqual([
      `${customer.id}_new_customer`,
      `newCustomerWelcome:${customer.id}`
    ]);
    expect(getBonusPcLedgerId(customer.id, `${customer.id}_new_customer`))
      .toBe(`${customer.id}_${customer.id}_new_customer_bonus_pc`);
  });

  it('creates one stable monthly target key and keeps it pending until invoices are paid', () => {
    const targetInvoice = invoice('target', '2026-05-02', '2026-05-02', 10_000);
    const pending = buildAutomaticBonusCandidates(customer, [targetInvoice], [], DEFAULT_SETTINGS, '2026-05', '2026-05-10');
    const ready = buildAutomaticBonusCandidates(customer, [targetInvoice], [payment(targetInvoice.id, '2026-05-05')], DEFAULT_SETTINGS, '2026-05', '2026-05-10');
    expect(pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `monthlyTarget:${customer.id}:2026-05`, readyForApproval: false })
    ]));
    expect(ready).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `monthlyTarget:${customer.id}:2026-05`, readyForApproval: true })
    ]));
  });

  it('does not let a not-yet-due invoice disqualify a clean month', () => {
    const dueInvoice = invoice('due', '2026-05-01', '2026-05-20');
    const futureInvoice = invoice('future', '2026-05-25', '2026-06-10');
    const candidates = buildAutomaticBonusCandidates(
      customer,
      [dueInvoice, futureInvoice],
      [payment(dueInvoice.id, '2026-05-20')],
      DEFAULT_SETTINGS,
      '2026-05',
      '2026-06-01'
    );
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `cleanPaymentMonth:${customer.id}:2026-05` })
    ]));
  });

  it('disqualifies a clean month when an invoice was overdue at month-end', () => {
    const overdue = invoice('overdue', '2026-05-01', '2026-05-20');
    const candidates = buildAutomaticBonusCandidates(customer, [overdue], [], DEFAULT_SETTINGS, '2026-05', '2026-06-01');
    expect(candidates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ bonusType: 'clean_payment_month' })
    ]));
  });

  it('uses a stable referral key per referrer and referred customer', () => {
    expect(getReferralBonusId('referrer', 'referred')).toBe('referral:referrer:referred');
  });
});
