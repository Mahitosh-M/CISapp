import { useCallback, useEffect, useState } from 'react';
import { getAppSettings, getCustomers, getInvoices, getPayments } from '../services/firestoreService';
import type { AppSettings, Customer, CustomerScore, Invoice, Payment } from '../types';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { applyScoresToCustomerTiers } from '../utils/customerTiering';
import { DEFAULT_SETTINGS } from '../utils/settings';

interface UseErpDataOptions {
  fromDate?: string;
  toDate?: string;
  invoiceLimit?: number;
  paymentLimit?: number;
}

export const useErpData = (options: UseErpDataOptions = {}) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [customerScores, setCustomerScores] = useState<CustomerScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Scoped pages keep their visible invoice/payment rows filtered, but tiers are always calculated
      // from the same full rolling data used by the Intelligence page.
      const hasScopedRecords = Boolean(options.fromDate || options.toDate || options.invoiceLimit || options.paymentLimit);
      const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
        getCustomers(),
        getInvoices({ fromDate: options.fromDate, toDate: options.toDate, limitCount: options.invoiceLimit }),
        getPayments({ fromDate: options.fromDate, toDate: options.toDate, limitCount: options.paymentLimit }),
        getAppSettings()
      ]);
      const [scoringInvoices, scoringPayments] = hasScopedRecords
        ? await Promise.all([getInvoices(), getPayments()])
        : [invoiceRows, paymentRows];
      const intelligenceScores = buildCustomerScores(customerRows, scoringInvoices, scoringPayments, new Date(), appSettings);

      setCustomers(applyScoresToCustomerTiers(customerRows, intelligenceScores));
      setInvoices(invoiceRows);
      setPayments(paymentRows);
      setSettings(appSettings);
      setCustomerScores(intelligenceScores);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Firestore data.');
    } finally {
      setLoading(false);
    }
  }, [options.fromDate, options.invoiceLimit, options.paymentLimit, options.toDate]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return {
    customers,
    invoices,
    payments,
    settings,
    customerScores,
    loading,
    error,
    refreshData
  };
};
