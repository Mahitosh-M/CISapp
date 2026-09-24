import { formatMoney, formatShortDate } from './formatters';

interface CollectionPdfRow {
  customerName: string;
  area: string;
  overdueAmount: number;
  lastPaymentDate?: string;
  lastPaymentDays?: number;
}

interface CollectionsPdfOptions {
  totalOverdue: number;
  rows: CollectionPdfRow[];
}

export const downloadCollectionsPdf = async ({ totalOverdue, rows }: CollectionsPdfOptions) => {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);
  const document = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = document.internal.pageSize.getWidth();

  document.setFillColor(17, 24, 90);
  document.rect(0, 0, pageWidth, 30, 'F');
  document.setFillColor(76, 29, 149);
  document.rect(0, 30, pageWidth, 1.5, 'F');
  document.setTextColor(255, 255, 255);
  document.setFont('helvetica', 'bold');
  document.setFontSize(17);
  document.text('Collections', 10, 13);
  document.setFont('helvetica', 'normal');
  document.setFontSize(9);
  document.text('Overdue customer balances', 10, 20);
  document.setFont('helvetica', 'bold');
  document.setFontSize(8);
  document.text('TOTAL OVERDUE', pageWidth - 10, 11, { align: 'right' });
  document.setFontSize(14);
  document.text(formatMoney(totalOverdue), pageWidth - 10, 21, { align: 'right' });

  autoTable(document, {
    startY: 38,
    margin: { top: 12, right: 10, bottom: 16, left: 10 },
    theme: 'grid',
    head: [['Customer', 'Area', 'Total overdue', 'Last payment']],
    body: rows.map((row) => [
      row.customerName,
      row.area || '-',
      formatMoney(row.overdueAmount),
      row.lastPaymentDate ? `${formatShortDate(row.lastPaymentDate)} (${row.lastPaymentDays} days ago)` : 'No payment recorded'
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.5, lineColor: [218, 225, 234], lineWidth: 0.15, textColor: [31, 41, 55] },
    headStyles: { fillColor: [17, 24, 90], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 56, fontStyle: 'bold' },
      1: { cellWidth: 38 },
      2: { cellWidth: 42, halign: 'right', textColor: [185, 28, 28], fontStyle: 'bold' },
      3: { cellWidth: 54 }
    }
  });

  const generatedAt = new Date().toLocaleString('en-IN');
  const pageCount = document.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    document.setPage(pageNumber);
    document.setDrawColor(218, 225, 234);
    document.line(10, 286, pageWidth - 10, 286);
    document.setFont('helvetica', 'normal');
    document.setFontSize(7.5);
    document.setTextColor(107, 114, 128);
    document.text(`Generated ${generatedAt}`, 10, 291);
    document.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - 10, 291, { align: 'right' });
  }

  document.save(`collections-${new Date().toISOString().slice(0, 10)}.pdf`);
};
