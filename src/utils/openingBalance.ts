import type { Customer, Invoice, InvoiceFormData } from '../types';

export const OPENING_BALANCE_INVOICE_TYPE = 'opening_balance';
export const OPENING_BALANCE_INVOICE_PREFIX = '0000-OPENING';

export const getOpeningBalanceInvoiceId = (customerId: string) => `openingBalance_${customerId}`;

export const getOpeningBalanceInvoiceNumber = (customerId: string) =>
  `${OPENING_BALANCE_INVOICE_PREFIX}-${customerId.slice(0, 6).toUpperCase()}`;

export const isOpeningBalanceInvoice = (invoice: Pick<Invoice, 'invoiceNumber'> & { invoiceType?: string; isOpeningBalance?: boolean }) => {
  return invoice.isOpeningBalance === true || invoice.invoiceType === OPENING_BALANCE_INVOICE_TYPE || invoice.invoiceNumber.startsWith(OPENING_BALANCE_INVOICE_PREFIX);
};

export const getInvoiceDisplayNumber = (invoice: Pick<Invoice, 'invoiceNumber'> & { invoiceType?: string; isOpeningBalance?: boolean }) =>
  isOpeningBalanceInvoice(invoice) ? 'Opening Balance' : invoice.invoiceNumber;

export const isBusinessInvoice = (invoice: Pick<Invoice, 'invoiceNumber'> & { invoiceType?: string; isOpeningBalance?: boolean }) =>
  !isOpeningBalanceInvoice(invoice);

export const getBusinessInvoices = <T extends Pick<Invoice, 'invoiceNumber'> & { invoiceType?: string; isOpeningBalance?: boolean }>(invoices: T[]) =>
  invoices.filter(isBusinessInvoice);

export const prepareOpeningBalanceInvoiceEdit = (existingInvoice: Invoice, invoice: InvoiceFormData): InvoiceFormData => {
  const amount = Math.max(0, Number(invoice.salesAmount) || 0);

  return {
    customerId: existingInvoice.customerId,
    customerName: existingInvoice.customerName,
    date: invoice.date,
    dueDate: invoice.date,
    salesAmount: amount,
    costAmount: 0,
    transportAmount: 0,
    totalSales: amount,
    totalCost: 0,
    totalProfit: 0,
    notes: invoice.notes
  };
};

export const sortInvoicesForPaymentAllocation = <T extends Pick<Invoice, 'date' | 'invoiceNumber'> & { invoiceType?: string; isOpeningBalance?: boolean }>(invoices: T[]) => {
  return [...invoices].sort((left, right) => {
    const leftOpening = isOpeningBalanceInvoice(left) ? 1 : 0;
    const rightOpening = isOpeningBalanceInvoice(right) ? 1 : 0;

    if (leftOpening !== rightOpening) return rightOpening - leftOpening;
    return left.date.localeCompare(right.date) || left.invoiceNumber.localeCompare(right.invoiceNumber);
  });
};

export const getPreviousOutstandingFallback = (customer: Customer | undefined, invoices: Invoice[]) => {
  if (!customer) return 0;
  return invoices.some(isOpeningBalanceInvoice) ? 0 : Math.max(0, customer.previousOutstandingAmount ?? 0);
};
