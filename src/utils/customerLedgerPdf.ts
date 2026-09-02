import type { Customer } from '../types';
import type { jsPDF } from 'jspdf';
import { getLedgerPaymentParts, getPaymentNoteWithoutSplitMarker } from './customerLedger';
import type { CustomerLedgerEntry } from './customerLedger';
import { formatShortDate } from './formatters';
import { isOpeningBalanceInvoice } from './openingBalance';
import { getInvoicePaymentEffect } from './paymentUtils';
import { getShopName } from './shops';

interface CustomerLedgerPdfOptions {
  customer: Customer;
  rows: CustomerLedgerEntry[];
  rangeLabel: string;
  openingBalance?: number;
}

type PdfRowMeta = {
  kind: 'invoice' | 'payment' | 'opening';
  invoiceFullyPaid?: boolean;
  balance: number;
};

const formatPdfMoney = (value: number) => `₹ ${Math.round(value || 0).toLocaleString('en-IN')}`;

const getPdfShopName = (shopId?: NonNullable<CustomerLedgerEntry['invoice']>['shopId']) => {
  if (shopId === 'SHOP_S') return 'SND';
  if (shopId === 'SHOP_A') return 'MSK';
  return getShopName(shopId);
};

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const loadPdfFont = async (document: jsPDF) => {
  const response = await fetch('/fonts/Roboto-Regular.ttf');
  if (!response.ok) throw new Error('Unable to load the PDF font. Check your connection and try again.');
  document.addFileToVFS('Roboto-Regular.ttf', toBase64(await response.arrayBuffer()));
  document.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  document.addFont('Roboto-Regular.ttf', 'Roboto', 'bold');
};

const getSafeFileName = (customerName: string, rangeLabel: string) => {
  const cleanPart = (value: string) => value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${cleanPart(customerName) || 'customer'}-ledger-${cleanPart(rangeLabel) || 'statement'}.pdf`;
};

export const createCustomerLedgerPdf = async ({
  customer,
  rows,
  rangeLabel,
  openingBalance
}: CustomerLedgerPdfOptions) => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);
  const document = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  await loadPdfFont(document);
  const pageWidth = document.internal.pageSize.getWidth();
  const currentBalance = rows[rows.length - 1]?.runningBalance ?? customer.totalOutstandingAmount ?? 0;
  const paidByInvoiceId = rows.reduce((totals, row) => {
    getLedgerPaymentParts(row).forEach((payment) => {
      if (!payment.invoiceId) return;
      totals.set(payment.invoiceId, (totals.get(payment.invoiceId) ?? 0) + getInvoicePaymentEffect(payment));
    });
    return totals;
  }, new Map<string, number>());

  document.setFillColor(17, 24, 90);
  document.rect(0, 0, pageWidth, 32, 'F');
  document.setFillColor(212, 175, 55);
  document.rect(0, 32, pageWidth, 1.4, 'F');
  document.setTextColor(255, 255, 255);
  document.setFont('Roboto', 'bold');
  document.setFontSize(17);
  const customerHeadingWidth = document.getTextWidth(customer.name);
  document.setFontSize(Math.max(11, Math.min(17, 17 * (125 / Math.max(customerHeadingWidth, 1)))));
  document.text(customer.name, 10, 13);
  document.setFont('Roboto', 'normal');
  document.setFontSize(8.5);
  document.text(`Customer Ledger Statement  |  ${rangeLabel}`, 10, 21, { maxWidth: 128 });
  document.setFont('Roboto', 'bold');
  document.setFontSize(8);
  document.text('CURRENT BALANCE', pageWidth - 10, 11, { align: 'right' });
  document.setTextColor(currentBalance > 0 ? 255 : 191, currentBalance > 0 ? 190 : 219, currentBalance > 0 ? 190 : 254);
  document.setFontSize(14);
  document.text(formatPdfMoney(currentBalance), pageWidth - 10, 21, { align: 'right' });

  const orderedRows = [...rows].reverse();
  const body: string[][] = [];
  const rowMeta: PdfRowMeta[] = [];

  orderedRows.forEach((row) => {
    const invoice = row.invoice;
    const payment = row.payment;
    const paymentParts = getLedgerPaymentParts(row);
    const paymentInvoiceCount = new Set(paymentParts.map((part) => part.invoiceId).filter(Boolean)).size;
    const paymentModes = [...new Set(paymentParts.map((part) => part.mode).filter(Boolean))].join(', ');
    const paymentShops = [...new Set(paymentParts.map((part) => part.shopId).filter(Boolean))]
      .map((shopId) => getPdfShopName(shopId))
      .join(', ');
    const paymentNotes = [...new Set(paymentParts
      .map(getPaymentNoteWithoutSplitMarker)
      .filter(Boolean))].join(' | ');
    const totalCashDiscount = paymentParts.reduce((total, part) => total + Math.max(0, part.cashDiscount || 0), 0);
    const totalAdvanceCreated = paymentParts.reduce((total, part) => total + Math.max(0, part.advanceCreatedAmount || 0), 0);
    const invoiceFullyPaid = Boolean(invoice && (paidByInvoiceId.get(invoice.id) ?? 0) >= invoice.totalSales);
    const entryLabel = payment?.paymentKind === 'advance_application'
      ? 'Advance'
      : row.kind === 'payment'
        ? 'Payment'
        : invoice && isOpeningBalanceInvoice(invoice)
          ? 'Opening'
          : 'Invoice';
    const details = invoice
      ? [
          invoice.shopId ? getPdfShopName(invoice.shopId) : '',
          invoice.notes
        ].filter(Boolean).join(' | ')
      : payment
        ? [
            paymentParts.length > 1
              ? `${paymentInvoiceCount || paymentParts.length} ${paymentInvoiceCount === 1 ? 'invoice' : 'invoices'}`
              : '',
            paymentModes,
            paymentShops,
            `Received ${formatPdfMoney(row.paymentReceived)}`,
            totalCashDiscount > 0 ? `Discount ${formatPdfMoney(totalCashDiscount)}` : '',
            totalAdvanceCreated > 0 ? `Advance ${formatPdfMoney(totalAdvanceCreated)}` : '',
            paymentNotes
          ].filter(Boolean).join(' | ')
        : '';
    const amount = row.invoiceAmount > 0
      ? `+ ${formatPdfMoney(row.invoiceAmount)}`
      : `- ${formatPdfMoney(row.paymentAmount)}`;

    body.push([
      formatShortDate(row.date),
      entryLabel,
      details,
      amount,
      formatPdfMoney(row.runningBalance)
    ]);
    rowMeta.push({ kind: row.kind, invoiceFullyPaid, balance: row.runningBalance });
  });

  if (openingBalance !== undefined) {
    body.push(['-', 'B/F', 'Balance brought forward', '-', formatPdfMoney(openingBalance)]);
    rowMeta.push({ kind: 'opening', balance: openingBalance });
  }

  autoTable(document, {
    startY: 39,
    margin: { top: 12, right: 10, bottom: 15, left: 10 },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Date', 'Entry', 'Details', 'Amount', 'Balance']],
    body,
    styles: {
      font: 'Roboto',
      fontSize: 8.2,
      cellPadding: 2.2,
      lineColor: [218, 225, 234],
      lineWidth: 0.15,
      textColor: [31, 41, 55],
      valign: 'middle',
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [17, 24, 90],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left'
    },
    columnStyles: {
      0: { cellWidth: 20, fontStyle: 'bold' },
      1: { cellWidth: 22, fontStyle: 'bold' },
      2: { cellWidth: 76 },
      3: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 36, halign: 'right', fontStyle: 'bold' }
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const meta = rowMeta[data.row.index];
      if (!meta) return;

      data.cell.styles.fillColor = meta.kind === 'payment'
        ? [239, 251, 243]
        : meta.kind === 'invoice'
          ? [255, 244, 244]
          : [244, 246, 250];

      if (data.column.index === 3) {
        data.cell.styles.textColor = meta.kind === 'payment'
          ? [21, 128, 61]
          : meta.kind === 'invoice' && meta.invoiceFullyPaid
            ? [124, 58, 237]
            : meta.kind === 'invoice'
              ? [180, 35, 24]
              : [75, 85, 99];
      }

      if (data.column.index === 4) {
        data.cell.styles.textColor = meta.balance > 0 ? [180, 35, 24] : [29, 78, 216];
      }
    }
  });

  const pageCount = document.getNumberOfPages();
  const generatedAt = new Date().toLocaleString('en-IN');
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    document.setPage(pageNumber);
    document.setDrawColor(218, 225, 234);
    document.line(10, 286, pageWidth - 10, 286);
    document.setFont('Roboto', 'normal');
    document.setFontSize(7.5);
    document.setTextColor(107, 114, 128);
    document.text(`Generated ${generatedAt}`, 10, 291);
    document.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 10, 291, { align: 'right' });
  }

  return document;
};

export const downloadCustomerLedgerPdf = async (options: CustomerLedgerPdfOptions) => {
  const document = await createCustomerLedgerPdf(options);
  document.save(getSafeFileName(options.customer.name, options.rangeLabel));
};
