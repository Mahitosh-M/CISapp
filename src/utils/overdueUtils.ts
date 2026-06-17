import type { AppSettings, Customer, Invoice, OverdueInvoiceAlert, Payment } from '../types';
<<<<<<< HEAD
import { getInvoicePaymentEffect } from './paymentUtils';
import { getEffectiveInvoiceDueDate } from './settings';
=======
import { getInvoicePaymentEffect, getPendingAmount } from './paymentUtils';
import { calculateDynamicDueDate } from './settings';
>>>>>>> Development

const parseDate = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const daysBetween = (fromDate: string, toDate: string) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((parseDate(toDate).getTime() - parseDate(fromDate).getTime()) / msPerDay));
};

const getToday = () => new Date().toISOString().slice(0, 10);

export const getPaidAmountForInvoice = (invoiceId: string, payments: Payment[]) => {
  return payments
    .filter((payment) => payment.invoiceId === invoiceId)
    .reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
};

export const buildOverdueInvoiceAlerts = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  settings?: AppSettings
): OverdueInvoiceAlert[] => {
  const today = getToday();
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  return invoices
    .map((invoice) => {
      const customer = customerById.get(invoice.customerId);
      const tier = customer?.tier ?? 'Tier 3';
      const paidAmount = getPaidAmountForInvoice(invoice.id, payments);
<<<<<<< HEAD
      const overdueAmount = invoice.totalSales - paidAmount;
      const effectiveDueDate = getEffectiveInvoiceDueDate(invoice.date, invoice.dueDate, tier, settings);
=======
      const overdueAmount = getPendingAmount(invoice.totalSales, paidAmount);
      const effectiveDueDate = calculateDynamicDueDate(invoice.date, tier, settings);
>>>>>>> Development
      const overdueDays = effectiveDueDate < today && overdueAmount > 0 ? daysBetween(effectiveDueDate, today) : 0;
      const severity: OverdueInvoiceAlert['severity'] = overdueAmount <= 0 ? 'green' : overdueDays > 7 ? 'red' : overdueDays > 0 ? 'yellow' : 'green';

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        tier,
        invoiceDate: invoice.date,
        dueDate: invoice.dueDate,
        effectiveDueDate,
        totalSales: invoice.totalSales,
        paidAmount,
        overdueAmount: Math.max(0, overdueAmount),
        overdueDays,
        severity
      };
    })
    .filter((alert) => alert.overdueAmount > 0 && alert.overdueDays > 0)
    .sort((a, b) => b.overdueAmount - a.overdueAmount);
};

export const buildCustomerOutstandingRows = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  settings?: AppSettings
) => {
  const overdueAlerts = buildOverdueInvoiceAlerts(customers, invoices, payments, settings);

  return customers.map((customer) => {
    const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
    const totalSales = customerInvoices.reduce((sum, invoice) => sum + invoice.totalSales, 0);
    const customerPayments = payments.filter((payment) => payment.customerId === customer.id);
    const totalPayments = customerPayments.reduce((sum, payment) => sum + payment.amount + payment.cashDiscount, 0);
    const invoicePaymentEffect = customerPayments.reduce((sum, payment) => sum + getInvoicePaymentEffect(payment), 0);
    // Previous outstanding is the opening balance from old records before this ERP started.
    const previousOutstanding = customer.previousOutstandingAmount ?? 0;
    const newOutstanding = getPendingAmount(totalSales, invoicePaymentEffect);
    const customerAlerts = overdueAlerts.filter((alert) => alert.customerId === customer.id);
    const overdueAmount = customerAlerts.reduce((sum, alert) => sum + alert.overdueAmount, 0);
    const overdueDays = customerAlerts.reduce((highest, alert) => Math.max(highest, alert.overdueDays), 0);
    const outstanding = previousOutstanding + newOutstanding;
    const indicator = overdueAmount > 0 ? 'red' : outstanding > 0 ? 'yellow' : 'green';

    return {
      customerId: customer.id,
      totalSales,
      totalPayments,
      previousOutstanding,
      newOutstanding,
      // Future improvement: allow payments to be allocated specifically to previous outstanding.
      outstanding,
      overdueAmount,
      overdueDays,
      indicator
    };
  });
};
