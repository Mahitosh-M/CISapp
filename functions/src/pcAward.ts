export type PcDocumentData = Record<string, unknown>;

const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const addDays = (dateString: string, days: number) => {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const paymentEffect = (payment: PcDocumentData) => {
  const amount = payment.amountAppliedToInvoice === undefined
    ? numberOrZero(payment.amount ?? payment.amountReceived)
    : numberOrZero(payment.amountAppliedToInvoice);
  return Math.max(0, amount) + Math.max(0, numberOrZero(payment.cashDiscount));
};

export const calculatePaymentPcAward = (
  invoice: PcDocumentData,
  payments: PcDocumentData[],
  customer: PcDocumentData,
  settings: PcDocumentData
) => {
  const tier = String(customer.tier || 'Tier 4');
  const invoiceDate = String(invoice.date || invoice.invoiceDate || '');
  const storedDueDate = String(invoice.dueDate || '');
  const creditDays = Math.max(0, Math.round(numberOrZero((settings.creditDays as PcDocumentData | undefined)?.[tier])));
  const bufferDays = Math.max(0, Math.round(numberOrZero((settings.paymentBuffers as PcDocumentData | undefined)?.[tier])));
  const deadline = storedDueDate
    ? addDays(storedDueDate, bufferDays)
    : addDays(invoiceDate, creditDays + bufferDays);
  const invoiceAmount = Math.max(0, numberOrZero(invoice.totalSales ?? invoice.salesAmount));
  let runningPaid = 0;
  let fullPaymentDate = '';

  [...payments]
    .sort((left, right) => String(left.date || left.paymentDate || '').localeCompare(String(right.date || right.paymentDate || '')))
    .some((payment) => {
      runningPaid += paymentEffect(payment);
      if (invoiceAmount > 0 && runningPaid >= invoiceAmount - 0.01) {
        fullPaymentDate = String(payment.date || payment.paymentDate || '');
        return true;
      }
      return false;
    });

  const giftPercentages = settings.giftPercentages as PcDocumentData | undefined;
  const loyaltySettings = settings.loyaltySettings as PcDocumentData | undefined;
  const giftPercentage = Math.max(0, numberOrZero(giftPercentages?.[tier]));
  const onTimeBonus = Math.max(0, numberOrZero(loyaltySettings?.onTimePaymentBonus));
  const points = Math.max(0, Math.round(Math.max(0, numberOrZero(invoice.totalProfit)) * (giftPercentage / 100)) + onTimeBonus);
  const eligible = Boolean(fullPaymentDate && deadline && fullPaymentDate <= deadline && points > 0);

  return { eligible, points: eligible ? points : 0, fullPaymentDate, deadline };
};
