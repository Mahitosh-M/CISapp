import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getActiveOffers,
  getAppSettings,
  getCustomerById,
  getCustomersByName,
  getInvoicesForCustomerViewer,
  getPaymentsForCustomerViewer
} from '../services/firestoreService';
import type { AppSettings, Customer, Invoice, Offer, Payment } from '../types';
import { calculateDueStatus, filterCustomerRecords } from '../utils/customerPortal';
import { DEFAULT_SETTINGS } from '../utils/settings';

export const useCustomerPortalData = () => {
  const { userProfile } = useAuth();
  const [customer, setCustomer] = useState<Customer>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshData = useCallback(async () => {
    if (!userProfile || userProfile.role !== 'customer') {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      let linkedCustomer = userProfile.customerId ? await getCustomerById(userProfile.customerId) : undefined;

      if (!linkedCustomer && userProfile.customerName) {
        linkedCustomer = (await getCustomersByName(userProfile.customerName))[0];
      }

      // Customer portal free-tier/privacy rule: these helpers query only the linked customer
      // (customerId first, customerName only as a legacy fallback), never full company collections.
      const [customerInvoices, customerPayments, appSettings, activeOffers] = await Promise.all([
        getInvoicesForCustomerViewer(linkedCustomer?.id ?? userProfile.customerId, linkedCustomer?.name ?? userProfile.customerName),
        getPaymentsForCustomerViewer(linkedCustomer?.id ?? userProfile.customerId, linkedCustomer?.name ?? userProfile.customerName),
        getAppSettings(),
        getActiveOffers()
      ]);

      setCustomer(linkedCustomer);
      setInvoices(filterCustomerRecords(customerInvoices, { customerId: linkedCustomer?.id ?? userProfile.customerId, customerName: linkedCustomer?.name ?? userProfile.customerName }));
      setPayments(filterCustomerRecords(customerPayments, { customerId: linkedCustomer?.id ?? userProfile.customerId, customerName: linkedCustomer?.name ?? userProfile.customerName }));
      setSettings(appSettings);
      setOffers(activeOffers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer portal data.');
    } finally {
      setLoading(false);
    }
  }, [userProfile]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const invoiceViews = useMemo(() => invoices.map((invoice) => calculateDueStatus(invoice, payments)), [invoices, payments]);

  return {
    userProfile,
    customer,
    invoices,
    payments,
    invoiceViews,
    settings,
    offers,
    loading,
    error,
    refreshData
  };
};

export type CustomerPortalData = ReturnType<typeof useCustomerPortalData>;
