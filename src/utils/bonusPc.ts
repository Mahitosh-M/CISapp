import type { AppSettings, BonusPcType, Customer, Invoice, Payment } from '../types';
import { getTodayDateString } from './dateUtils';
import { getInvoicePaymentEffect, getPendingAmount } from './paymentUtils';
import { getInvoiceSavedDueDate, getTierTargetSettings } from './settings';

export const FIXED_BONUS_PC: Record<BonusPcType, number> = {
  monthly_target: 5,
  clean_payment_month: 5,
  new_customer: 20,
  referral: 50
};

export interface BonusPcCandidate {
  id: string;
  bonusType: Exclude<BonusPcType, 'referral'>;
  referenceId: string;
  triggerType: string;
  notes: string;
  readyForApproval: boolean;
}

const normalized = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');

export const isValidBonusInvoice = (invoice: Invoice) => {
  const type = normalized(invoice.invoiceType);
  const status = normalized(invoice.recordStatus);

  if (invoice.isOpeningBalance || type === 'opening balance') return false;
  if (['draft', 'cancelled', 'canceled', 'deleted', 'void'].includes(status)) return false;
  return ![
    'sales return', 'sale return', 'return', 'credit note', 'inter shop',
    'quotation', 'quote', 'order', 'confirmed order', 'cogs', 'inventory'
  ].includes(type);
};

const paymentsForInvoiceThrough = (invoiceId: string, payments: Payment[], throughDate?: string) => payments.filter((payment) => (
  payment.invoiceId === invoiceId && (!throughDate || payment.date <= throughDate)
));

export const isInvoiceFullyPaidThrough = (invoice: Invoice, payments: Payment[], throughDate?: string) => {
  const effect = paymentsForInvoiceThrough(invoice.id, payments, throughDate)
    .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
  return getPendingAmount(invoice.totalSales, effect) <= 1;
};

const getMonthRange = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(year, monthNumber, 0);
  return {
    start: `${month}-01`,
    end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
  };
};

export const buildAutomaticBonusCandidates = (
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings,
  month: string,
  today = getTodayDateString()
): BonusPcCandidate[] => {
  const validInvoices = invoices
    .filter((invoice) => invoice.customerId === customer.id && isValidBonusInvoice(invoice))
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt));
  const candidates: BonusPcCandidate[] = [];
  const firstInvoice = validInvoices[0];

  if (firstInvoice && isInvoiceFullyPaidThrough(firstInvoice, payments, today)) {
    candidates.push({
      id: `newCustomerWelcome:${customer.id}`,
      bonusType: 'new_customer',
      referenceId: firstInvoice.id,
      triggerType: 'first_valid_invoice_fully_paid',
      notes: `First valid invoice ${firstInvoice.invoiceNumber || firstInvoice.id} fully paid.`,
      readyForApproval: true
    });
  }

  const monthRange = getMonthRange(month);
  const monthlyInvoices = validInvoices.filter((invoice) => invoice.date >= monthRange.start && invoice.date <= monthRange.end);
  const monthlySales = monthlyInvoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.totalSales) || 0), 0);
  const target = getTierTargetSettings(customer.tier, settings).monthlySalesTarget;

  if (target > 0 && monthlySales >= target) {
    const qualifyingPaid = monthlyInvoices.every((invoice) => isInvoiceFullyPaidThrough(invoice, payments, today));
    candidates.push({
      id: `monthlyTarget:${customer.id}:${month}`,
      bonusType: 'monthly_target',
      referenceId: `${customer.id}_${month.replace('-', '_')}`,
      triggerType: qualifyingPaid ? 'monthly_target_paid' : 'monthly_target_pending_payment',
      notes: qualifyingPaid
        ? `Monthly sales target reached and qualifying invoices paid for ${month}.`
        : `Monthly sales target reached for ${month}; release after qualifying invoices are paid.`,
      readyForApproval: qualifyingPaid
    });
  }

  if (today >= monthRange.end && monthlyInvoices.length > 0) {
    const dueByMonthEnd = validInvoices.filter((invoice) => {
      const dueDate = getInvoiceSavedDueDate(invoice, customer.tier, settings);
      return Boolean(dueDate && dueDate <= monthRange.end);
    });
    const cleanAtMonthEnd = dueByMonthEnd.every((invoice) => isInvoiceFullyPaidThrough(invoice, payments, monthRange.end));

    if (cleanAtMonthEnd) {
      candidates.push({
        id: `cleanPaymentMonth:${customer.id}:${month}`,
        bonusType: 'clean_payment_month',
        referenceId: `${customer.id}_${month.replace('-', '_')}`,
        triggerType: 'clean_payment_month',
        notes: `No overdue invoices at month-end and every invoice due in ${month} was settled.`,
        readyForApproval: true
      });
    }
  }

  return candidates;
};

export const getReferralBonusId = (referrerId: string, referredCustomerId: string) => (
  `referral:${referrerId}:${referredCustomerId}`
);
