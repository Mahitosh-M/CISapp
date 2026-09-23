// Notification-only guards mirror the existing invoice eligibility rules in src/utils/bonusPc.ts.
export type Row = Record<string, unknown>;
export const TOPICS = ['customers_all', 'customers_general', 'customers_medicals', 'staff_announcements'] as const;
export type Topic = typeof TOPICS[number];
export const isCustomer = (profile: Row) => profile.active === true && ['customer', 'Medical'].includes(String(profile.role));
export const isAdmin = (profile: Row) => profile.active === true && profile.role === 'Admin';
export function topicsFor(profile: Row, customer?: Row): Topic[] {
  if (profile.active !== true) return [];
  if (profile.role === 'Staff') return ['staff_announcements'];
  if (!isCustomer(profile) || !customer) return [];
  const medical = customer.customerType ? customer.customerType === 'medical' : profile.role === 'Medical';
  return ['customers_all', medical ? 'customers_medicals' : 'customers_general'];
}
export function validInvoice(invoice: Row): boolean {
  const normal = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return typeof invoice.customerId === 'string' && !!invoice.customerId && !invoice.isOpeningBalance &&
    !['draft', 'cancelled', 'canceled', 'deleted', 'void'].includes(normal(invoice.recordStatus)) &&
    !['opening balance', 'sales return', 'sale return', 'return', 'credit note', 'inter shop',
      'quotation', 'quote', 'order', 'confirmed order', 'cogs', 'inventory'].includes(normal(invoice.invoiceType));
}
export function validPayment(payment: Row): boolean {
  return typeof payment.customerId === 'string' && !!payment.customerId &&
    payment.paymentKind !== 'advance_application' && typeof payment.amount === 'number' &&
    Number.isFinite(payment.amount) && payment.amount > 0;
}
// Wait for every persisted part. Never announce the planned total of an incomplete split receipt.
export function completedReceipt(parts: Row[]): number | null {
  const first = parts[0];
  if (!first || !parts.every(validPayment)) return null;
  const count = first.splitPaymentCount;
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 500 || parts.length !== count) return null;
  const seen = new Set<number>();
  for (const part of parts) {
    const position = Number(part.splitPaymentPart);
    if (part.customerId !== first.customerId || part.splitPaymentGroupId !== first.splitPaymentGroupId ||
        part.splitPaymentCount !== count || !Number.isInteger(position) || position < 1 || position > Number(count) || seen.has(position)) return null;
    seen.add(position);
  }
  return Math.round(parts.reduce((sum, part) => sum + Number(part.amount), 0) * 100) / 100;
}
export const shopForBranch = (branch: unknown) => branch === 'SINDHANUR' ? 'SHOP_S' : branch === 'MASKI' ? 'SHOP_A' : undefined;
export function safeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\/\x00-\x1f]/.test(value) && !['.', '..'].includes(value);
}

// Stop configuration/network failures from redelivering the same event for hours or days.
export function notificationEventExpired(time?: string, now = Date.now()): boolean {
  if (!time) return false;
  const timestamp = Date.parse(time);
  return !Number.isFinite(timestamp) || now - timestamp > 15 * 60 * 1000;
}
