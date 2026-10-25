import test from "node:test";
import assert from "node:assert/strict";
import {
  deliveryFields,
  assertDeliverable,
  planReceipt,
  stableId,
} from "./dispatchCore";
import type { Invoice, Payment } from "../../src/types";
const invoice = (id: string, date: string, totalSales: number, extra = {}) =>
  ({ id, date, totalSales, invoiceNumber: id, ...extra }) as Invoice;
test("Dispatch uses CIS opening balance priority and keeps excess unallocated", () => {
  const rows = [
    invoice("older-sale", "2026-01-01", 1500),
    invoice("opening", "2026-02-01", 500, { isOpeningBalance: true }),
  ];
  const plan = planReceipt(rows, [], 250000);
  assert.deepEqual(
    plan.rows.map((r) => [r.invoiceId, r.amount]),
    [
      ["opening", 50000],
      ["older-sale", 150000],
    ],
  );
  assert.equal(plan.unallocated, 50000);
});
test("Latest external payments reduce allocation and discounts use existing effects", () => {
  const rows = [invoice("one", "2026-01-01", 2000)];
  const payments = [
    {
      invoiceId: "one",
      amount: 500,
      amountAppliedToInvoice: 400,
      cashDiscount: 100,
    } as Payment,
  ];
  assert.equal(planReceipt(rows, payments, 200000).allocated, 150000);
  assert.throws(
    () =>
      planReceipt(rows, payments, 200000, [
        { invoiceId: "one", amount: 200000 },
      ]),
    /Outstanding changed/,
  );
  const discounted = planReceipt(rows, payments, 100000, undefined, 50000);
  assert.equal(discounted.discount, 50000);
});
test("Reject duplicate override rows, negative paise and foreign invoice allocations", () => {
  const rows = [invoice("one", "2026-01-01", 2000)];
  assert.throws(() => planReceipt(rows, [], -1), /paise/);
  assert.throws(
    () =>
      planReceipt(rows, [], 100, [
        { invoiceId: "one", amount: 50 },
        { invoiceId: "one", amount: 50 },
      ]),
    /Duplicate/,
  );
  assert.throws(
    () => planReceipt(rows, [], 100, [{ invoiceId: "foreign", amount: 100 }]),
    /Outstanding changed/,
  );
});
test("Delivery requires verified address and excludes every opening-balance form", () => {
  assert.throws(
    () =>
      deliveryFields({
        packages: 1,
        scheduledDate: "2026-10-19",
        address: "",
        contact: "0000000000",
      }),
    /address/,
  );
  for (const extra of [
    { isOpeningBalance: true },
    { invoiceType: "opening_balance" },
    { invoiceNumber: "0000-OPENING-test" },
  ])
    assert.throws(
      () =>
        assertDeliverable({ invoiceNumber: "I-1", shopId: "SHOP_A", ...extra }),
      /Opening/,
    );
  assert.throws(() => assertDeliverable({ invoiceNumber: "I-1" }), /Legacy/);
  assert.equal(stableId("receipt", "same"), stableId("receipt", "same"));
});
