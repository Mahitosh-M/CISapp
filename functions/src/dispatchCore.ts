import {invoiceReceivableAmount} from '../../src/utils/invoiceCharges';
﻿import { createHash } from "node:crypto";
import type { Invoice, Payment } from "../../src/types";
import {
  sortInvoicesForPaymentAllocation,
  isOpeningBalanceInvoice,
} from "../../src/utils/openingBalance";
import { allocateReceiptOldestFirst } from "../../src/utils/paymentAllocation";
import { getInvoicePaymentEffect } from "../../src/utils/paymentUtils";
export type Data = Record<string, any>;
export const shops = ["SHOP_A", "SHOP_S"];
export function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function text(value: unknown, label: string, max = 500): string {
  requireValue(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `${label} is required or invalid`,
  );
  return value.trim();
}
export function identifier(value: unknown): string {
  const id = text(value, "Identifier", 256);
  requireValue(!/[\/\u0000-\u001f]/.test(id), "Invalid identifier");
  return id;
}
export function paise(value: unknown, allowZero = true): number {
  requireValue(
    typeof value === "number" &&
      Number.isSafeInteger(value) && value % 100 === 0 &&
      value >= (allowZero ? 0 : 1) &&
      value <= 100_000_000_000,
    "Enter whole rupee transaction amounts (paise must be multiples of 100)",
  );
  return value;
}
export function money(value: unknown): number {
  const n = Number(value ?? 0);
  requireValue(
    Number.isFinite(n) &&
      n >= 0 &&
      Math.abs(n * 100 - Math.round(n * 100)) < 0.0001,
    "Source money requires precision review",
  );
  return Math.round(n * 100);
}
export function date(value: unknown): string {
  const d = text(value, "Date", 10);
  requireValue(
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
      new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d,
    "Invalid date",
  );
  return d;
}
export const stableId = (kind: string, key: string) =>
  `${kind}_${createHash("sha256").update(key).digest("hex")}`;
export function deliveryFields(input: Data) {
  requireValue(input && typeof input === "object", "Delivery details required");
  requireValue(
    Number.isInteger(input.packages) &&
      input.packages > 0 &&
      input.packages <= 10000,
    "Invalid package count",
  );
  return {
    required: true,
    scheduledDate: date(input.scheduledDate),
    address: text(input.address, "Verified delivery address", 1500),
    contact: text(input.contact, "Contact", 40),
    packages: input.packages as number,
    instructions: String(input.instructions ?? "").slice(0, 1500),
  };
}
export function assertDeliverable(invoice: Data) {
  requireValue(
    !isOpeningBalanceInvoice({
      invoiceNumber: String(invoice.invoiceNumber ?? ""),
      invoiceType: invoice.invoiceType,
      isOpeningBalance: invoice.isOpeningBalance,
    }),
    "Opening balances cannot be delivered",
  );
  requireValue(
    !["cancelled", "deleted", "void"].includes(
      String(invoice.status ?? "").toLowerCase(),
    ),
    "Invoice is cancelled or deleted",
  );
  requireValue(
    shops.includes(invoice.shopId),
    "Legacy invoice needs an authorised shop assignment before dispatch",
  );
}
export function invoiceBalances(invoices: Invoice[], payments: Payment[]) {
  return sortInvoicesForPaymentAllocation(invoices).map((i) => ({
    ...i,
    pendingPaise: Math.max(
      0,
      money(invoiceReceivableAmount(i)) -
        payments
          .filter((p) => p.invoiceId === i.id)
          .reduce((sum, p) => sum + money(getInvoicePaymentEffect(p)), 0),
    ),
  }));
}
/** CISapp opening-balance-first allocator and payment-effect rules remain authoritative. */
export function planReceipt(
  invoices: Invoice[],
  payments: Payment[],
  amount: number,
  overrides?: Array<{ invoiceId: string; amount: number }>,
  discount = 0,
) {
  paise(amount, false);
  paise(discount);
  const balances = invoiceBalances(invoices, payments);
  requireValue(
    balances.length > 0 && balances.length <= 150,
    "Invoice references need review",
  );
  let rows: Array<{ invoiceId: string; amount: number; discount: number }>;
  if (overrides) {
    requireValue(
      Array.isArray(overrides) && overrides.length <= 150 && discount === 0,
      "Discounts require the default reviewed allocation",
    );
    requireValue(
      new Set(overrides.map((x) => x.invoiceId)).size === overrides.length,
      "Duplicate allocation",
    );
    rows = overrides.map((x) => {
      identifier(x.invoiceId);
      paise(x.amount, false);
      return { invoiceId: x.invoiceId, amount: x.amount, discount: 0 };
    });
  } else {
    const result = allocateReceiptOldestFirst(
      balances.map((i) => ({ ...i, pendingAmount: i.pendingPaise / 100 })),
      amount / 100,
      discount / 100,
    );
    // Excess is deliberately retained in the claim for review; no automatic advance.
    rows = result.allocations
      .filter((x) => x.appliedTotal > 0)
      .map((x) => ({
        invoiceId: x.invoice.id,
        amount: money(x.amountAppliedToInvoice),
        discount: money(x.cashDiscount),
      }));
  }
  let allocated = 0,
    discounted = 0;
  for (const row of rows) {
    const i = balances.find((x) => x.id === row.invoiceId);
    requireValue(
      i && row.amount + row.discount <= i.pendingPaise,
      "Outstanding changed; refresh and review allocation",
    );
    requireValue(row.amount % 100 === 0 && row.discount % 100 === 0, "This allocation has a legacy fractional balance; Admin review is required");
    allocated += row.amount;
    discounted += row.discount;
  }
  requireValue(
    allocated <= amount && discounted === discount,
    "Invalid allocation or discount",
  );
  requireValue(
    allocated + discounted > 0,
    "No outstanding reference can receive this collection",
  );
  return {
    rows,
    allocated,
    discount: discounted,
    unallocated: amount - allocated,
  };
}
