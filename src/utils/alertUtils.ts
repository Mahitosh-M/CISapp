import type { Alert, AppSettings, Customer, Invoice, Payment } from '../types';
import { buildCustomerScores } from './customerAnalytics';
import { getTodayDateString } from './dateUtils';
import { buildCustomerOutstandingRows, buildOverdueInvoiceAlerts, getPaidAmountForInvoice } from './overdueUtils';

const parseDate = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const daysBetween = (fromDate: string, toDate: string) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((parseDate(toDate).getTime() - parseDate(fromDate).getTime()) / msPerDay));
};

type GeneratedAlert = Omit<Alert, 'id' | 'createdAt' | 'updatedAt'>;

const makeAlert = (alert: GeneratedAlert): GeneratedAlert => alert;

export const buildOperationalAlerts = (
  customers: Customer[],
  invoices: Invoice[],
  payments: Payment[],
  settings: AppSettings
): GeneratedAlert[] => {
  const today = getTodayDateString();
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const alerts: GeneratedAlert[] = [];

  buildOverdueInvoiceAlerts(customers, invoices, payments, settings).forEach((alert) => {
    alerts.push(
      makeAlert({
        uniqueKey: `overdue_payment:${alert.invoiceId}`,
        customerId: alert.customerId,
        customerName: alert.customerName,
        invoiceId: alert.invoiceId,
        invoiceNumber: alert.invoiceNumber,
        alertType: 'overdue_payment',
        severity: alert.severity === 'red' ? 'High' : 'Medium',
        date: today,
        status: 'Open',
        actionRequired: 'Collect payment or review credit before next supply.',
        message: `${alert.invoiceNumber} is overdue by ${alert.overdueDays} day(s).`
      })
    );
  });

  buildCustomerOutstandingRows(customers, invoices, payments, settings)
    .filter((row) => row.outstanding > settings.highOutstandingThreshold)
    .forEach((row) => {
      const customer = customerById.get(row.customerId);
      if (!customer) return;

      alerts.push(
        makeAlert({
          uniqueKey: `high_outstanding:${customer.id}`,
          customerId: customer.id,
          customerName: customer.name,
          alertType: 'high_outstanding',
          severity: 'High',
          date: today,
          status: 'Open',
          actionRequired: 'Admin should review outstanding balance before further credit.',
          message: `${customer.name} has outstanding above the configured threshold.`
        })
      );
    });

  invoices
    .filter((invoice) => invoice.totalProfit < 0)
    .forEach((invoice) => {
      alerts.push(
        makeAlert({
          uniqueKey: `negative_profit:${invoice.id}`,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          alertType: 'negative_profit',
          severity: 'High',
          date: today,
          status: 'Open',
          actionRequired: 'Review pricing, cost, transport, or discount for this invoice.',
          message: `${invoice.invoiceNumber} has negative estimated profit.`
        })
      );
    });

  customers.forEach((customer) => {
    const customerInvoices = invoices.filter((invoice) => invoice.customerId === customer.id);
    const lastInvoice = customerInvoices.sort((a, b) => b.date.localeCompare(a.date))[0];
    const inactiveDays = lastInvoice ? daysBetween(lastInvoice.date, today) : 999;

    if (inactiveDays > 45) {
      alerts.push(
        makeAlert({
          uniqueKey: `inactive_customer:${customer.id}`,
          customerId: customer.id,
          customerName: customer.name,
          alertType: 'inactive_customer',
          severity: inactiveDays > 90 ? 'High' : 'Medium',
          date: today,
          status: 'Open',
          actionRequired: 'Contact customer or review customer status.',
          message: lastInvoice ? `${customer.name} has no invoice activity for ${inactiveDays} days.` : `${customer.name} has no invoice activity.`
        })
      );
    }
  });

  buildCustomerScores(customers, invoices, payments, new Date(), settings).forEach((score) => {
    if (score.storedTier !== score.tier) {
      alerts.push(
        makeAlert({
          uniqueKey: `automatic_tier_change:${score.customerId}:${score.storedTier}:${score.tier}`,
          customerId: score.customerId,
          customerName: score.customerName,
          alertType: 'automatic_tier_change',
          severity: score.tier === 'Tier 3' ? 'High' : 'Medium',
          date: today,
          status: 'Open',
          actionRequired: 'Admin should review the automatic tier movement.',
          message: `${score.customerName} changed from ${score.storedTier} to ${score.tier}. Score ${score.intelligenceScore}, payment discipline ${score.paymentDisciplineScore}.`
        })
      );
    }

    if (score.previousTier && score.previousTier !== score.tier) {
      alerts.push(
        makeAlert({
          uniqueKey: `automatic_tier_change:${score.customerId}:${score.previousTier}:${score.tier}`,
          customerId: score.customerId,
          customerName: score.customerName,
          alertType: 'automatic_tier_change',
          severity: score.movement === 'Demoted' ? 'High' : 'Medium',
          date: today,
          status: 'Open',
          actionRequired: 'Admin should review the tier movement reason.',
          message: `${score.customerName} moved from ${score.previousTier} to ${score.tier}. ${score.movementReason}`
        })
      );
    }

    if (score.tier === 'Tier 2' && score.paymentDisciplineScore < 55) {
      alerts.push(
        makeAlert({
          uniqueKey: `tier_downgrade_risk:${score.customerId}`,
          customerId: score.customerId,
          customerName: score.customerName,
          alertType: 'tier_downgrade_risk',
          severity: 'Medium',
          date: today,
          status: 'Open',
          actionRequired: 'Improve collection discipline before automatic downgrade.',
          message: `${score.customerName} has downgrade risk from weak payment discipline.`
        })
      );
    }
  });

  invoices.forEach((invoice) => {
    const customer = customerById.get(invoice.customerId);
    const paidAmount = getPaidAmountForInvoice(invoice.id, payments);
    const outstanding = invoice.totalSales - paidAmount;

    if (customer?.tier === 'Tier 3' && outstanding > 0) {
      alerts.push(
        makeAlert({
          uniqueKey: `tier3_credit_warning:${invoice.id}`,
          customerId: customer.id,
          customerName: customer.name,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          alertType: 'tier3_credit_warning',
          severity: 'Medium',
          date: today,
          status: 'Open',
          actionRequired: 'Collect same-day payment or approve exception.',
          message: `${customer.name} is Tier 3 but has unpaid credit on ${invoice.invoiceNumber}.`
        })
      );
    }
  });

  return alerts;
};
