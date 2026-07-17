import type { AppSettings, BonusPcRequest, Customer, Invoice, OverduePcRequest, Payment, RedemptionRequest } from '../types';
import { calculateInvoiceApcInfo } from './customerPortal';
import { calculateCustomerApcBonuses } from './giftUtils';
import { getBusinessInvoices } from './openingBalance';

export const buildCustomerPortalPcBalance = (
  customer: Customer,
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings,
  redemptions: RedemptionRequest[],
  approvedOverduePcRequests: OverduePcRequest[],
  approvedBonusPcRequests: BonusPcRequest[]
) => {
  const businessInvoices = getBusinessInvoices(invoices);
  const basePc = businessInvoices.reduce(
    (sum, invoice) => sum + calculateInvoiceApcInfo(invoice, payments, customer.tier, settings).earnedApc,
    0
  );
  const performanceBonusPc = calculateCustomerApcBonuses(customer, businessInvoices, payments, settings).totalBonus;
  const overduePc = approvedOverduePcRequests.reduce((sum, request) => sum + request.approvedCoins, 0);
  const approvedBonusPc = approvedBonusPcRequests.reduce((sum, request) => sum + request.approvedCoins, 0);
  const redeemedPc = redemptions
    .filter((request) => request.status === 'Gifted')
    .reduce((sum, request) => sum + request.points, 0);
  const incomingPc = basePc + performanceBonusPc + overduePc + approvedBonusPc;

  return {
    basePc,
    performanceBonusPc,
    overduePc,
    approvedBonusPc,
    incomingPc: Math.round(incomingPc),
    redeemedPc: Math.round(redeemedPc),
    availablePc: Math.max(0, Math.round(incomingPc - redeemedPc))
  };
};
