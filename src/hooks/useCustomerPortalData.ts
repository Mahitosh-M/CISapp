import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getActiveOffers,
  getActiveRewardItems,
  getApprovedBonusPcRequestsForCustomer,
  getApprovedOverduePcRequestsForCustomer,
  getAppSettings,
  getCustomerById,
  getCustomersByName,
  getInvoicesForCustomerViewer,
  getPaymentsForCustomerViewer,
  getRedemptionRequestsForCustomer
} from '../services/firestoreService';
import { getCustomerCreditSummary } from '../services/creditService';
import type { AppSettings, BonusPcRequest, Customer, CustomerApcSummary, CustomerCreditSummary, Invoice, Offer, OverduePcRequest, Payment, RedemptionRequest, RewardItem } from '../types';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { calculateDueStatus, calculateInvoiceApcInfo, filterCustomerRecords, isCurrentMonth } from '../utils/customerPortal';
import { canViewRewardAtLevel, getNextPartnerLevel, getPartnerLevelForTier, getPcThresholdProgress } from '../utils/loyalty';
import { getBusinessInvoices } from '../utils/openingBalance';
import { buildCustomerPortalPcBalance } from '../utils/pcBalance';
import { DEFAULT_SETTINGS } from '../utils/settings';

const isPermissionError = (err: unknown) => {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'permission-denied';
};

const optionalCustomerRead = async <T,>(read: () => Promise<T>, fallback: T) => {
  try {
    return await read();
  } catch (err) {
    if (isPermissionError(err)) {
      return fallback;
    }

    throw err;
  }
};

export const useCustomerPortalData = () => {
  const { userProfile } = useAuth();
  const [customer, setCustomer] = useState<Customer>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [apcSummary, setApcSummary] = useState<CustomerApcSummary>();
  const [availableRewards, setAvailableRewards] = useState<RewardItem[]>([]);
  const [redemptionRequests, setRedemptionRequests] = useState<RedemptionRequest[]>([]);
  const [bonusPcRequests, setBonusPcRequests] = useState<BonusPcRequest[]>([]);
  const [overduePcRequests, setOverduePcRequests] = useState<OverduePcRequest[]>([]);
  const [creditSummary, setCreditSummary] = useState<CustomerCreditSummary>();
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
      const customerId = linkedCustomer?.id ?? userProfile.customerId;
      const [customerInvoices, customerPayments, appSettings, activeOffers, activeRewards, redemptions, approvedOverduePcRequests, approvedBonusPcRequests, customerCreditSummary] = await Promise.all([
        getInvoicesForCustomerViewer(linkedCustomer?.id ?? userProfile.customerId, linkedCustomer?.name ?? userProfile.customerName),
        getPaymentsForCustomerViewer(linkedCustomer?.id ?? userProfile.customerId, linkedCustomer?.name ?? userProfile.customerName),
        getAppSettings(),
        getActiveOffers(),
        optionalCustomerRead(() => getActiveRewardItems(), []),
        customerId ? optionalCustomerRead(() => getRedemptionRequestsForCustomer(customerId), []) : Promise.resolve([]),
        customerId ? optionalCustomerRead(() => getApprovedOverduePcRequestsForCustomer(customerId), []) : Promise.resolve([]),
        customerId ? optionalCustomerRead(() => getApprovedBonusPcRequestsForCustomer(customerId), []) : Promise.resolve([]),
        customerId ? optionalCustomerRead(() => getCustomerCreditSummary(customerId), undefined) : Promise.resolve(undefined)
      ]);

      const scopedInvoices = filterCustomerRecords(customerInvoices, { customerId: linkedCustomer?.id ?? userProfile.customerId, customerName: linkedCustomer?.name ?? userProfile.customerName });
      const scopedPayments = filterCustomerRecords(customerPayments, { customerId: linkedCustomer?.id ?? userProfile.customerId, customerName: linkedCustomer?.name ?? userProfile.customerName });
      const businessInvoices = getBusinessInvoices(scopedInvoices);
      const intelligenceResult = linkedCustomer ? buildCustomerScores([linkedCustomer], businessInvoices, scopedPayments, new Date(), appSettings)[0] : undefined;
      const customerWithIntelligenceTier = linkedCustomer && intelligenceResult ? { ...linkedCustomer, tier: intelligenceResult.tier } : linkedCustomer;
      const pcBalance = customerWithIntelligenceTier
        ? buildCustomerPortalPcBalance(customerWithIntelligenceTier, businessInvoices, scopedPayments, appSettings, redemptions, approvedOverduePcRequests, approvedBonusPcRequests)
        : undefined;
      const apcBalance = pcBalance?.availablePc ?? 0;
      const monthlyApcEarned = customerWithIntelligenceTier
        ? scopedInvoices
            .filter((invoice) => businessInvoices.some((businessInvoice) => businessInvoice.id === invoice.id))
            .filter((invoice) => isCurrentMonth(invoice.date))
            .reduce((sum, invoice) => sum + calculateInvoiceApcInfo(invoice, scopedPayments, customerWithIntelligenceTier.tier, appSettings).earnedApc, 0)
        : 0;
      const currentLevel = getPartnerLevelForTier(customerWithIntelligenceTier?.tier);
      const nextLevel = getNextPartnerLevel(currentLevel);
      const levelEligibleRewards = activeRewards.filter((reward) => canViewRewardAtLevel(currentLevel, reward.levelRequired));
      const eligibleOffers = activeOffers.filter((offer) => canViewRewardAtLevel(currentLevel, offer.levelRequired || 'Active Partner'));
      const nextReward = activeRewards.find((reward) => reward.requiredPoints > apcBalance && canViewRewardAtLevel(currentLevel, reward.levelRequired));
      const rewardAvailable = levelEligibleRewards.some((reward) => reward.requiredPoints <= apcBalance);
      const pcProgress = getPcThresholdProgress(apcBalance, currentLevel, appSettings);
      const apcData: CustomerApcSummary = {
        currentLevel,
        apcBalance,
        monthlyApcEarned,
        progressPercent: pcProgress.progressPercent,
        nextLevel,
        pointsNeededForNextLevel: pcProgress.pointsNeededForNextLevel,
        pointsNeededForNextReward: nextReward ? Math.max(0, Math.round(nextReward.requiredPoints - apcBalance)) : 0,
        rewardAvailable
      };

      setCustomer(customerWithIntelligenceTier);
      setInvoices(scopedInvoices);
      setPayments(scopedPayments);
      setSettings(appSettings);
      setOffers(eligibleOffers);
      setApcSummary(apcData);
      setAvailableRewards(levelEligibleRewards);
      setRedemptionRequests(redemptions);
      setBonusPcRequests(approvedBonusPcRequests);
      setOverduePcRequests(approvedOverduePcRequests);
      setCreditSummary(customerCreditSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer portal data.');
    } finally {
      setLoading(false);
    }
  }, [userProfile]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const invoiceViews = useMemo(
    () => invoices.map((invoice) => calculateDueStatus(invoice, payments, undefined, customer?.tier, settings)),
    [customer?.tier, invoices, payments, settings]
  );

  return {
    userProfile,
    customer,
    invoices,
    payments,
    invoiceViews,
    settings,
    offers,
    apcSummary,
    availableRewards,
    redemptionRequests,
    bonusPcRequests,
    overduePcRequests,
    creditSummary,
    loading,
    error,
    refreshData
  };
};

export type CustomerPortalData = ReturnType<typeof useCustomerPortalData>;
