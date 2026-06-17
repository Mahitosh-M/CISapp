import type { AppSettings, Customer, CustomerScore, Invoice, Payment } from '../types';
import { buildCustomerScores } from './customerAnalytics';

export const applyScoresToCustomerTiers = (customers: Customer[], customerScores: CustomerScore[]) => {
  const scoresByCustomerId = new Map(customerScores.map((score) => [score.customerId, score]));

  return customers.map((customer) => {
    const score = scoresByCustomerId.get(customer.id);

    if (!score || customer.tier === score.tier) {
      return customer;
    }

    return {
      ...customer,
      tier: score.tier
    };
  });
};

export const applyIntelligenceTiersToCustomers = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings,
  referenceDate = new Date()
) => {
  return applyScoresToCustomerTiers(customers, buildCustomerScores(customers, invoices, payments, referenceDate, settings));
};
