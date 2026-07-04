import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getActiveOffers,
  getActiveRewardItems,
  getAppSettings,
  getCustomerById,
  getCustomersByName,
  getInvoicesForCustomerViewer,
  getPaymentsForCustomerViewer,
  getRedemptionRequestsForCustomer
} from '../services/firestoreService';
import type { AppSettings, Customer, CustomerApcSummary, Invoice, Offer, Payment, RedemptionRequest, RewardItem } from '../types';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { calculateDueStatus, filterCustomerRecords, isCurrentMonth } from '../utils/customerPortal';
import { calculateCustomerGiftBudget } from '../utils/giftUtils';
import { canViewRewardAtLevel, getLevelProgressPercent, getNextPartnerLevel, getPartnerLevelForPoints, getPartnerLevelThreshold } from '../utils/loyalty';
import { DEFAULT_SETTINGS } from '../utils/settings';

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
      const [customerInvoices, customerPayments, appSettings, activeOffers, activeRewards, redemptions] = await Promise.all([
        getInvoicesForCustomerViewer(linkedCustomer?.id ?? userProfile.customerId, linkedCustomer?.name ?? userProfile.customerName),
        getPaymentsForCustomerViewer(linkedCustomer?.id ?? userProfile.customerId, linkedCustomer?.name ?? userProfile.customerName),
        getAppSettings(),
        getActiveOffers(),
        getActiveRewardItems(),
        customerId ? getRedemptionRequestsForCustomer(customerId) : Promise.resolve([])
      ]);

      const scopedInvoices = filterCustomerRecords(customerInvoices, { customerId: linkedCustomer?.id ?? userProfile.customerId, customerName: linkedCustomer?.name ?? userProfile.customerName });
      const scopedPayments = filterCustomerRecords(customerPayments, { customerId: linkedCustomer?.id ?? userProfile.customerId, customerName: linkedCustomer?.name ?? userProfile.customerName });
      const intelligenceScore = linkedCustomer ? buildCustomerScores([linkedCustomer], scopedInvoices, scopedPayments, new Date(), appSettings)[0] : undefined;
      const customerWithIntelligenceTier = linkedCustomer && intelligenceScore ? { ...linkedCustomer, tier: intelligenceScore.tier } : linkedCustomer;
      const apcBalance = Math.max(0, Math.round(intelligenceScore?.giftBudget ?? 0));
      const monthlyProfit = scopedInvoices.filter((invoice) => isCurrentMonth(invoice.date)).reduce((sum, invoice) => sum + invoice.totalProfit, 0);
      const monthlyApcEarned = customerWithIntelligenceTier ? Math.max(0, calculateCustomerGiftBudget(monthlyProfit, customerWithIntelligenceTier, appSettings)) : 0;
      const currentLevel = getPartnerLevelForPoints(apcBalance, appSettings);
      const nextLevel = getNextPartnerLevel(currentLevel);
      const nextLevelThreshold = nextLevel ? getPartnerLevelThreshold(nextLevel, appSettings) : undefined;
      const eligibleRewards = activeRewards.filter((reward) => reward.requiredPoints <= apcBalance && canViewRewardAtLevel(currentLevel, reward.levelRequired));
      const nextReward = activeRewards.find((reward) => reward.requiredPoints > apcBalance && canViewRewardAtLevel(currentLevel, reward.levelRequired));
      const pointsNeededForNextLevel = nextLevelThreshold === undefined ? 0 : Math.max(0, Math.round(nextLevelThreshold - apcBalance));
      const apcData: CustomerApcSummary = {
        currentLevel,
        apcBalance,
        monthlyApcEarned,
        progressPercent: getLevelProgressPercent(apcBalance, currentLevel, appSettings),
        nextLevel,
        pointsNeededForNextLevel,
        pointsNeededForNextReward: nextReward ? Math.max(0, Math.round(nextReward.requiredPoints - apcBalance)) : pointsNeededForNextLevel,
        rewardAvailable: eligibleRewards.length > 0
      };

      setCustomer(customerWithIntelligenceTier);
      setInvoices(scopedInvoices);
      setPayments(scopedPayments);
      setSettings(appSettings);
      setOffers(activeOffers);
      setApcSummary(apcData);
      setAvailableRewards(eligibleRewards);
      setRedemptionRequests(redemptions);
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
    loading,
    error,
    refreshData
  };
};

export type CustomerPortalData = ReturnType<typeof useCustomerPortalData>;
