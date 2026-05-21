import { useCallback, useEffect, useState } from 'react';
import { getAppSettings, getCustomers, getInvoices, getPayments } from '../services/firestoreService';
import type { AppSettings, Customer, Invoice, Payment } from '../types';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      // Firestore reads are kept together so dashboard, reports, and intelligence use the same data snapshot.
      // Free-tier safety: callers can pass date ranges and limits so large screens do not fetch all history by default.
      const [customerRows, invoiceRows, paymentRows, appSettings] = await Promise.all([
        getCustomers(),
        getInvoices({ fromDate: options.fromDate, toDate: options.toDate, limitCount: options.invoiceLimit }),
        getPayments({ fromDate: options.fromDate, toDate: options.toDate, limitCount: options.paymentLimit }),
        getAppSettings()
      ]);

      setCustomers(customerRows);
      setInvoices(invoiceRows);
      setPayments(paymentRows);
      setSettings(appSettings);
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
    loading,
    error,
    refreshData
  };
};
