import type { Customer, CustomerTier, Invoice, Payment } from "../types";
import { isShopId } from "./shops";
import { getPaymentTermsLabel } from "./settings";
const numberOrZero = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const MEDICAL_PAYMENT_TERMS = "15 day credit";
const getPaymentTermsForTier = (tier: CustomerTier) =>
  getPaymentTermsLabel(tier);

export const mapCustomerDoc = (
  id: string,
  data: Record<string, unknown>,
): Customer => {
  const tier = (data.tier as CustomerTier) || "Tier 4";

  return {
    id,
    name: String(data.name || ""),
    mobile: String(data.mobile || ""),
    area: String(data.area || ""),
    customerType: data.customerType === "medical" ? "medical" : "customer",
    branchId:
      data.branchId === "MASKI" || data.branchId === "SINDHANUR"
        ? data.branchId
        : undefined,
    tier,
    // Old balance from before this ERP started. Missing legacy documents safely read as zero.
    previousOutstandingAmount: Math.max(
      0,
      numberOrZero(data.previousOutstandingAmount),
    ),
    advanceBalance: Math.max(0, numberOrZero(data.advanceBalance)),
    totalOutstandingAmount:
      data.totalOutstandingAmount === undefined
        ? undefined
        : numberOrZero(data.totalOutstandingAmount),
    invoiceOutstandingAmount:
      data.invoiceOutstandingAmount === undefined
        ? undefined
        : numberOrZero(data.invoiceOutstandingAmount),
    openingBalanceOutstandingAmount:
      data.openingBalanceOutstandingAmount === undefined
        ? undefined
        : numberOrZero(data.openingBalanceOutstandingAmount),
    latestOutstandingInvoiceId: data.latestOutstandingInvoiceId
      ? String(data.latestOutstandingInvoiceId)
      : undefined,
    overdueAmount:
      data.overdueAmount === undefined
        ? undefined
        : numberOrZero(data.overdueAmount),
    financialSummaryUpdatedAt: data.financialSummaryUpdatedAt
      ? String(data.financialSummaryUpdatedAt)
      : undefined,
    paymentTerms: String(
      data.paymentTerms ||
        (data.customerType === "medical"
          ? MEDICAL_PAYMENT_TERMS
          : getPaymentTermsLabel(tier)),
    ),
    notes: String(data.notes || ""),
    status: data.status ? String(data.status) : "",
    createdAt: String(data.createdAt || ""),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
  };
};

export const mapInvoiceDoc = (
  id: string,
  data: Record<string, unknown>,
): Invoice => {
  const salesAmount = numberOrZero(data.salesAmount ?? data.totalSales);
  const costAmount = numberOrZero(data.costAmount);
  const transportAmount = numberOrZero(data.transportAmount);
  const totalCost = numberOrZero(
    data.totalCost ?? costAmount + transportAmount,
  );
  const totalProfit = numberOrZero(data.totalProfit ?? salesAmount - totalCost);

  return {
    id,
    invoiceNumber: String(data.invoiceNumber || ""),
    customerId: String(data.customerId || ""),
    customerName: String(data.customerName || ""),
    lateChargePolicy: data.lateChargePolicy as Invoice["lateChargePolicy"],
    lateChargeEvents: (data.lateChargeEvents ?? []) as Invoice["lateChargeEvents"],
    lateChargesTotal: numberOrZero(data.lateChargesTotal),
    nextLateChargeDate: data.nextLateChargeDate ? String(data.nextLateChargeDate) : null,
    deliveryRequired: data.deliveryRequired === true,
    deliveryDetails: data.deliveryDetails
      ? (data.deliveryDetails as Invoice["deliveryDetails"])
      : null,
    deliveryRevision: Number(data.deliveryRevision ?? 0),
    invoiceType: data.invoiceType ? String(data.invoiceType) : undefined,
    recordStatus: data.status ? String(data.status) : undefined,
    isOpeningBalance: data.isOpeningBalance === true,
    date: String(data.date || data.invoiceDate || ""),
    dueDate: String(data.dueDate || ""),
    pcPolicyVersionAtInvoice:
      data.pcPolicyVersionAtInvoice === undefined
        ? undefined
        : Math.max(0, Math.round(numberOrZero(data.pcPolicyVersionAtInvoice))),
    tierAtInvoice: data.tierAtInvoice as CustomerTier | undefined,
    pcPercentageAtInvoice:
      data.pcPercentageAtInvoice === undefined
        ? undefined
        : numberOrZero(data.pcPercentageAtInvoice),
    creditDaysAtInvoice:
      data.creditDaysAtInvoice === undefined
        ? undefined
        : numberOrZero(data.creditDaysAtInvoice),
    bufferDaysAtInvoice:
      data.bufferDaysAtInvoice === undefined
        ? undefined
        : numberOrZero(data.bufferDaysAtInvoice),
    savedDueDate: data.savedDueDate ? String(data.savedDueDate) : undefined,
    finalPcCutoffDate: data.finalPcCutoffDate
      ? String(data.finalPcCutoffDate)
      : undefined,
    termsEstimated: data.termsEstimated === true,
    salesAmount,
    costAmount,
    transportAmount,
    totalSales: numberOrZero(data.totalSales ?? salesAmount),
    totalCost,
    totalProfit,
    salesStaffEmail: data.salesStaffEmail
      ? String(data.salesStaffEmail)
      : undefined,
    salesStaffName: data.salesStaffName
      ? String(data.salesStaffName)
      : undefined,
    salesStaffDirectoryToken: data.salesStaffDirectoryToken
      ? String(data.salesStaffDirectoryToken)
      : undefined,
    customerBalanceBeforeInvoice:
      data.customerBalanceBeforeInvoice === undefined
        ? undefined
        : Math.max(0, numberOrZero(data.customerBalanceBeforeInvoice)),
    customerBalanceAfterInvoice:
      data.customerBalanceAfterInvoice === undefined
        ? undefined
        : Math.max(0, numberOrZero(data.customerBalanceAfterInvoice)),
    notes: String(data.notes || ""),
    createdAt: String(data.createdAt || ""),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    shopId: isShopId(data.shopId) ? data.shopId : undefined,
    branchSystemVersion:
      data.branchSystemVersion === undefined
        ? undefined
        : numberOrZero(data.branchSystemVersion),
  };
};

export const mapPaymentDoc = (
  id: string,
  data: Record<string, unknown>,
): Payment => {
  const amount = numberOrZero(data.amount ?? data.amountReceived);
  const amountAppliedToInvoice =
    data.amountAppliedToInvoice === undefined
      ? amount
      : numberOrZero(data.amountAppliedToInvoice);
  const paymentKind =
    data.paymentKind === "advance_application"
      ? "advance_application"
      : "receipt";

  return {
    id,
    invoiceId: String(data.invoiceId || ""),
    invoiceNumber: String(data.invoiceNumber || ""),
    customerId: String(data.customerId || ""),
    customerName: String(data.customerName || ""),
    date: String(data.date || data.paymentDate || ""),
    pcPolicyVersionAtPayment:
      data.pcPolicyVersionAtPayment === undefined
        ? undefined
        : Math.max(0, Math.round(numberOrZero(data.pcPolicyVersionAtPayment))),
    amount,
    amountAppliedToInvoice,
    advanceCreatedAmount:
      data.advanceCreatedAmount === undefined && paymentKind === "receipt"
        ? Math.max(0, amount - amountAppliedToInvoice)
        : Math.max(0, numberOrZero(data.advanceCreatedAmount)),
    advanceAppliedAmount: Math.max(0, numberOrZero(data.advanceAppliedAmount)),
    paymentKind,
    amountUsedForOldBalance: numberOrZero(data.amountUsedForOldBalance),
    oldBalanceBeforePayment: numberOrZero(data.oldBalanceBeforePayment),
    oldBalanceAfterPayment: numberOrZero(data.oldBalanceAfterPayment),
    splitPaymentGroupId: data.splitPaymentGroupId
      ? String(data.splitPaymentGroupId)
      : undefined,
    splitPaymentTotalAmount:
      data.splitPaymentTotalAmount === undefined
        ? undefined
        : numberOrZero(data.splitPaymentTotalAmount),
    splitPaymentPart:
      data.splitPaymentPart === undefined
        ? undefined
        : numberOrZero(data.splitPaymentPart),
    splitPaymentCount:
      data.splitPaymentCount === undefined
        ? undefined
        : numberOrZero(data.splitPaymentCount),
    cashDiscount: numberOrZero(data.cashDiscount),
    mode: (data.mode as Payment["mode"]) || "Cash",
    notes: String(data.notes || ""),
    createdAt: String(data.createdAt || ""),
    updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
    shopId: isShopId(data.shopId) ? data.shopId : undefined,
    branchSystemVersion:
      data.branchSystemVersion === undefined
        ? undefined
        : numberOrZero(data.branchSystemVersion),
    affectsShopCash:
      data.affectsShopCash === undefined
        ? undefined
        : data.affectsShopCash === true,
    cashSyncedAmount:
      data.cashSyncedAmount === undefined
        ? undefined
        : Math.max(0, numberOrZero(data.cashSyncedAmount)),
  };
};
