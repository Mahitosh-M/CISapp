import { describe, expect, it } from "vitest";
import {
  mapCustomerDoc,
  mapInvoiceDoc,
  mapPaymentDoc,
} from "./financialDocuments";
describe("shared financial document mapping", () => {
  it("preserves legacy invoice amount/cost/profit fallbacks and delivery snapshots", () => {
    expect(
      mapInvoiceDoc("i", {
        invoiceNumber: "I",
        customerId: "c",
        salesAmount: 1000,
        costAmount: 600,
        transportAmount: 50,
        deliveryRequired: true,
        deliveryDetails: { address: "Verified address" },
      }),
    ).toMatchObject({
      id: "i",
      totalSales: 1000,
      totalCost: 650,
      totalProfit: 350,
      deliveryRequired: true,
      deliveryDetails: { address: "Verified address" },
    });
  });
  it("preserves legacy received amount, applied amount, discounts and advance application kinds", () => {
    expect(
      mapPaymentDoc("p", {
        amountReceived: 1000,
        amountAppliedToInvoice: 800,
        cashDiscount: 20,
      }),
    ).toMatchObject({
      amount: 1000,
      amountAppliedToInvoice: 800,
      cashDiscount: 20,
      advanceCreatedAmount: 200,
      paymentKind: "receipt",
    });
    expect(
      mapPaymentDoc("a", {
        amount: 0,
        advanceAppliedAmount: 500,
        paymentKind: "advance_application",
      }),
    ).toMatchObject({
      amount: 0,
      advanceCreatedAmount: 0,
      advanceAppliedAmount: 500,
      paymentKind: "advance_application",
    });
  });
  it("keeps medical customer credit terms while mapping optional legacy fields", () => {
    expect(
      mapCustomerDoc("c", { name: "Test", customerType: "medical" }),
    ).toMatchObject({
      customerType: "medical",
      paymentTerms: "15 day credit",
      previousOutstandingAmount: 0,
      advanceBalance: 0,
    });
  });
});
