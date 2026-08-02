import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { adjustCustomerPcBalance, approveReferralBonus, generateBonusPcRequests, generateOverduePcRequests, getAppSettings, getApprovedBonusPcRequestsForCustomer, getApprovedOverduePcRequestsForCustomer, getBonusPcRequests, getCustomerPcBalanceRecord, getCustomerPcLedgerEntries, getCustomers, getInvoicesByCustomerId, getOverduePcRequests, getPaymentsByCustomerId, getRedemptionRequestsForCustomer, protectCustomerPcBalance, reviewBonusPcRequest, reviewOverduePcRequest } from '../services/firestoreService';
import type { AppSettings, BonusPcRequest, Customer, Invoice, LoyaltyLedgerEntry, OverduePcRequest, Payment, RedemptionRequest } from '../types';
import { formatDate, formatMoney } from '../utils/formatters';
import { formatPc } from '../utils/loyalty';
import { latestFiveScrollStyle, sortNewestFirst } from '../utils/listDisplay';
import { DEFAULT_SETTINGS } from '../utils/settings';
import { formatCustomerSelectLabel } from '../utils/customerLabels';
import { calculateInvoiceApcInfo, getInvoiceFullPaymentDate } from '../utils/customerPortal';
import { getBusinessInvoices, getInvoiceDisplayNumber } from '../utils/openingBalance';
import { buildCustomerScores } from '../utils/customerAnalytics';
import { buildCustomerPortalPcBalance } from '../utils/pcBalance';

interface PcHistoryItem {
  id: string;
  direction: 'Incoming' | 'Redeemed';
  title: string;
  detail: string;
  points: number;
  date: string;
}

interface CustomerPcView {
  customer: Customer;
  availablePc: number;
  incomingPc: number;
  redeemedPc: number;
  protected: boolean;
}

interface PcHistorySources {
  customer: Customer;
  invoices: Invoice[];
  payments: Payment[];
  bonusRequests: BonusPcRequest[];
  overdueRequests: OverduePcRequest[];
  redemptions: RedemptionRequest[];
  performanceBonus: number;
}

const ledgerHistoryTitle = (entry: LoyaltyLedgerEntry) => {
  if (entry.type === 'opening_balance') return 'Protected opening balance';
  if (entry.type === 'manual_adjustment') return 'Manual PC adjustment';
  if (entry.type === 'redemption') return 'Gift approved';
  if (entry.type === 'redemption_reversal') return 'Gift approval removed';
  if (entry.type === 'purchase') return 'Invoice PC';
  if (entry.type === 'overdue_payment') return 'Overdue PC';
  if (entry.type === 'bonus') return 'Bonus PC';
  return 'PC earned';
};

const mapLedgerHistory = (entries: LoyaltyLedgerEntry[]): PcHistoryItem[] => entries.map((entry) => ({
  id: entry.id,
  direction: entry.points >= 0 ? 'Incoming' : 'Redeemed',
  title: ledgerHistoryTitle(entry),
  detail: entry.reason,
  points: Math.abs(entry.points),
  date: entry.createdAt.slice(0, 10)
}));

const OverduePcRequests = () => {
  const { userProfile } = useAuth();
  const [requests, setRequests] = useState<OverduePcRequest[]>([]);
  const [bonusRequests, setBonusRequests] = useState<BonusPcRequest[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [coinEdits, setCoinEdits] = useState<Record<string, number>>({});
  const [bonusCoinEdits, setBonusCoinEdits] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingBonus, setGeneratingBonus] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [selectedReferralCustomerId, setSelectedReferralCustomerId] = useState('');
  const [showPcViewer, setShowPcViewer] = useState(false);
  const [selectedPcCustomerId, setSelectedPcCustomerId] = useState('');
  const [customerPcView, setCustomerPcView] = useState<CustomerPcView | null>(null);
  const [loadingPcView, setLoadingPcView] = useState(false);
  const [pcHistorySources, setPcHistorySources] = useState<PcHistorySources | null>(null);
  const [savedPcHistory, setSavedPcHistory] = useState<PcHistoryItem[] | null>(null);
  const [pcHistory, setPcHistory] = useState<PcHistoryItem[] | null>(null);
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjustmentCustomerId, setAdjustmentCustomerId] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<'add' | 'deduct'>('add');
  const [adjustmentPoints, setAdjustmentPoints] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const auditUser = {
    userId: userProfile?.uid,
    userEmail: userProfile?.email,
    role: userProfile?.role
  };

  const loadRequests = async () => {
    try {
      setLoading(true);
      setError('');
      const [rows, bonusRows, customerRows, appSettings] = await Promise.all([
        getOverduePcRequests(100),
        getBonusPcRequests(100),
        getCustomers(),
        getAppSettings()
      ]);
      setRequests(rows);
      setBonusRequests(bonusRows);
      setCustomers(customerRows);
      setSettings(appSettings);
      setCoinEdits(Object.fromEntries(rows.map((request) => [request.id, request.approvedCoins || request.suggestedCoins])));
      setBonusCoinEdits(Object.fromEntries(bonusRows.map((request) => [request.id, request.approvedCoins || request.suggestedCoins])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load PC requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const sortedPendingRequests = useMemo(() => sortNewestFirst(requests, ['generatedAt', 'reviewedAt']), [requests]);
  const sortedPendingBonusRequests = useMemo(() => sortNewestFirst(bonusRequests, ['generatedAt', 'reviewedAt']), [bonusRequests]);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setMessage('');
      setError('');
      const result = await generateOverduePcRequests(auditUser);
      setMessage(result.createdCount > 0 ? `${result.createdCount} PC request(s) created.` : 'No new PC requests found.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate PC requests.');
    } finally {
      setGenerating(false);
    }
  };

  const handleReview = async (request: OverduePcRequest, status: 'Approved' | 'Rejected') => {
    try {
      setSavingId(request.id);
      setMessage('');
      setError('');
      await reviewOverduePcRequest(
        request.id,
        status,
        coinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins,
        auditUser,
        status === 'Approved' ? 'Approved by Admin' : 'Rejected by Admin'
      );
      setMessage(status === 'Approved' ? 'PC approved and added to customer balance.' : 'PC request rejected.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review PC request.');
    } finally {
      setSavingId('');
    }
  };

  const handleGenerateBonus = async () => {
    try {
      setGeneratingBonus(true);
      setMessage('');
      setError('');
      const result = await generateBonusPcRequests(auditUser);
      setMessage(result.createdCount > 0 ? `${result.createdCount} bonus request(s) created.` : 'No new bonus requests found.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate bonus requests.');
    } finally {
      setGeneratingBonus(false);
    }
  };

  const handleBonusReview = async (request: BonusPcRequest, status: 'Approved' | 'Rejected') => {
    try {
      setSavingId(request.id);
      setMessage('');
      setError('');
      await reviewBonusPcRequest(
        request.id,
        status,
        bonusCoinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins,
        auditUser,
        status === 'Approved' ? 'Approved by Admin' : 'Rejected by Admin'
      );
      setMessage(status === 'Approved' ? 'Bonus PC approved and added to customer balance.' : 'Bonus request rejected.');
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review bonus request.');
    } finally {
      setSavingId('');
    }
  };

  const handleReferralApproval = async () => {
    if (!selectedReferralCustomerId) {
      setError('Select a customer for the referral bonus.');
      return;
    }

    try {
      setSavingId('referral');
      setMessage('');
      setError('');
      const result = await approveReferralBonus(selectedReferralCustomerId, auditUser);
      setMessage(`${result.referralCoins} referral PC approved for ${result.customer.name} and added to the available balance.`);
      setSelectedReferralCustomerId('');
      setShowReferral(false);
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve referral bonus.');
    } finally {
      setSavingId('');
    }
  };

  const handlePcCustomerChange = async (customerId: string) => {
    setSelectedPcCustomerId(customerId);
    setCustomerPcView(null);
    setPcHistorySources(null);
    setSavedPcHistory(null);
    setPcHistory(null);

    if (!customerId) return;

    const customer = customers.find((item) => item.id === customerId);
    if (!customer) {
      setError('Selected customer no longer exists.');
      return;
    }

    try {
      setLoadingPcView(true);
      setError('');
      const [invoiceRows, paymentRows, approvedBonusRows, approvedOverdueRows, redemptionRows, protectedBalance, ledgerEntries] = await Promise.all([
        getInvoicesByCustomerId(customerId),
        getPaymentsByCustomerId(customerId),
        getApprovedBonusPcRequestsForCustomer(customerId, 200),
        getApprovedOverduePcRequestsForCustomer(customerId, 200),
        getRedemptionRequestsForCustomer(customerId, 200),
        getCustomerPcBalanceRecord(customerId),
        getCustomerPcLedgerEntries(customerId)
      ]);
      const businessInvoices = getBusinessInvoices(invoiceRows);
      const intelligenceResult = buildCustomerScores([customer], businessInvoices, paymentRows, new Date(), settings)[0];
      const portalCustomer = intelligenceResult ? { ...customer, tier: intelligenceResult.tier } : customer;
      const pcBalance = buildCustomerPortalPcBalance(portalCustomer, businessInvoices, paymentRows, settings, redemptionRows, approvedOverdueRows, approvedBonusRows);

      setCustomerPcView({
        customer: portalCustomer,
        availablePc: protectedBalance?.availablePc ?? pcBalance.availablePc,
        incomingPc: protectedBalance?.incomingPc ?? pcBalance.incomingPc,
        redeemedPc: protectedBalance?.redeemedPc ?? pcBalance.redeemedPc,
        protected: Boolean(protectedBalance)
      });
      setSavedPcHistory(protectedBalance ? mapLedgerHistory(ledgerEntries) : null);
      setPcHistorySources({
        customer: portalCustomer,
        invoices: businessInvoices,
        payments: paymentRows,
        bonusRequests: approvedBonusRows,
        overdueRequests: approvedOverdueRows,
        redemptions: redemptionRows,
        performanceBonus: pcBalance.performanceBonusPc
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load customer PC details.');
    } finally {
      setLoadingPcView(false);
    }
  };

  const handleViewPcHistory = () => {
    if (pcHistory) {
      setPcHistory(null);
      return;
    }

    if (savedPcHistory) {
      setPcHistory(savedPcHistory);
      return;
    }

    if (!pcHistorySources) return;

    const invoiceHistory = pcHistorySources.invoices
      .map((invoice): PcHistoryItem | undefined => {
        const earnedPc = calculateInvoiceApcInfo(invoice, pcHistorySources.payments, pcHistorySources.customer.tier, settings).earnedApc;
        const creditedDate = getInvoiceFullPaymentDate(invoice, pcHistorySources.payments);
        if (earnedPc <= 0 || !creditedDate) return undefined;

        return {
          id: `invoice-${invoice.id}`,
          direction: 'Incoming',
          title: `Invoice ${getInvoiceDisplayNumber(invoice)}`,
          detail: 'PC earned from an on-time invoice payment',
          points: earnedPc,
          date: creditedDate
        };
      })
      .filter((item): item is PcHistoryItem => Boolean(item));
    const performanceHistory: PcHistoryItem[] = pcHistorySources.performanceBonus > 0 ? [{
      id: 'calculated-performance-bonus',
      direction: 'Incoming',
      title: 'Performance bonuses',
      detail: 'Monthly target and order-frequency PC',
      points: pcHistorySources.performanceBonus,
      date: invoiceHistory[0]?.date || pcHistorySources.invoices[0]?.date || ''
    }] : [];
    const bonusHistory: PcHistoryItem[] = pcHistorySources.bonusRequests.map((request) => ({
      id: `bonus-${request.id}`,
      direction: 'Incoming',
      title: request.bonusLabel,
      detail: request.notes || 'Bonus approved by Admin',
      points: request.approvedCoins,
      date: (request.reviewedAt || request.generatedAt).slice(0, 10)
    }));
    const overdueHistory: PcHistoryItem[] = pcHistorySources.overdueRequests.map((request) => ({
      id: `overdue-${request.id}`,
      direction: 'Incoming',
      title: `Overdue PC: ${request.invoiceNumber}`,
      detail: request.notes || 'Overdue PC approved by Admin',
      points: request.approvedCoins,
      date: (request.reviewedAt || request.generatedAt).slice(0, 10)
    }));
    const redemptionHistory: PcHistoryItem[] = pcHistorySources.redemptions
      .filter((request) => request.status === 'Approved' || request.status === 'Gifted')
      .map((request) => ({
        id: `redemption-${request.id}`,
        direction: 'Redeemed',
        title: request.rewardName,
        detail: 'PC redeemed for customer reward',
        points: request.points,
        date: (request.reviewedAt || request.requestedAt).slice(0, 10)
      }));

    setPcHistory([...invoiceHistory, ...performanceHistory, ...bonusHistory, ...overdueHistory, ...redemptionHistory]
      .filter((item) => item.points > 0)
      .sort((left, right) => right.date.localeCompare(left.date)));
  };

  const handleProtectPc = async () => {
    if (!customerPcView) return;
    try {
      setSavingId('protect-pc');
      setError('');
      setMessage('');
      await protectCustomerPcBalance(customerPcView.customer.id, customerPcView.availablePc, auditUser);
      setMessage('Current PC is protected. Future invoice changes cannot reduce this balance.');
      await handlePcCustomerChange(customerPcView.customer.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to protect this PC balance.');
    } finally {
      setSavingId('');
    }
  };

  const handleManualAdjustment = async () => {
    if (!adjustmentCustomerId) {
      setError('Select a customer for the PC adjustment.');
      return;
    }
    try {
      setSavingId('adjust-pc');
      setError('');
      setMessage('');
      await adjustCustomerPcBalance(adjustmentCustomerId, adjustmentDirection, Number(adjustmentPoints), adjustmentReason, auditUser);
      setMessage(`PC ${adjustmentDirection === 'add' ? 'added' : 'deducted'} and recorded in permanent history.`);
      setAdjustmentPoints('');
      setAdjustmentReason('');
      if (selectedPcCustomerId === adjustmentCustomerId) await handlePcCustomerChange(adjustmentCustomerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to adjust PC.');
    } finally {
      setSavingId('');
    }
  };

  const cardStyle: CSSProperties = {
    background: 'var(--role-card-background)',
    borderRadius: 12,
    padding: 18,
    color: '#FFFFFF',
    boxShadow: '0 14px 35px rgba(11, 31, 58, 0.08)',
    marginBottom: 20
  };

  const buttonStyle: CSSProperties = {
    border: 0,
    borderRadius: 10,
    padding: '10px 14px',
    fontWeight: 800,
    cursor: 'pointer'
  };

  const primaryActionStyle: CSSProperties = {
    ...buttonStyle,
    background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)',
    color: '#FFFFFF'
  };

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: 1040,
    borderCollapse: 'collapse'
  };

  const thStyle: CSSProperties = {
    textAlign: 'left',
    padding: 12,
    background: 'var(--role-card-subtle)',
    borderBottom: '1px solid var(--role-card-border)'
  };

  const tdStyle: CSSProperties = {
    padding: 12,
    borderBottom: '1px solid var(--role-card-border)',
    verticalAlign: 'top'
  };

  if (loading) {
    return <SectionHeader title="PC" />;
  }

  return (
    <div>
      <SectionHeader title="PC" />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={{ ...cardStyle, display: 'inline-block', padding: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <button type="button" onClick={() => setShowPcViewer((current) => !current)} style={primaryActionStyle}>
            VIEW PC
          </button>
          <button type="button" onClick={() => setShowReferral((current) => !current)} style={primaryActionStyle}>
            Referral
          </button>
          <button type="button" onClick={() => setShowAdjustment((current) => !current)} style={primaryActionStyle}>
            Adjust PC
          </button>
        </div>
      </div>

      {showPcViewer ? (
          <div style={{ ...cardStyle, display: 'grid', gap: 14 }}>
            <label style={{ fontWeight: 800 }}>
              Select Customer
              <select
                value={selectedPcCustomerId}
                onChange={(event) => handlePcCustomerChange(event.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6, color: '#11185A' }}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
                ))}
              </select>
            </label>

            {loadingPcView ? <div style={{ color: '#D7DEEA', fontWeight: 800 }}>Loading PC details...</div> : null}

            {customerPcView && !loadingPcView ? (
              <>
                <div style={{ padding: 16, borderRadius: 14, background: '#FFF7D6', color: '#11185A', border: '1px solid #D4AF37' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{customerPcView.customer.name}</div>
                    <div style={{ color: customerPcView.protected ? '#166534' : '#B42318', fontWeight: 900 }}>
                      {customerPcView.protected ? 'Protected balance' : 'Legacy calculated balance'}
                    </div>
                  </div>
                  <div style={{ color: '#334155', marginTop: 3 }}>Area: {customerPcView.customer.area || '-'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 14 }}>
                    <div><div style={{ color: '#334155', fontSize: 12, fontWeight: 800 }}>Available PC</div><div style={{ color: '#166534', fontSize: 24, fontWeight: 900 }}>{formatPc(customerPcView.availablePc)}</div></div>
                    <div><div style={{ color: '#334155', fontSize: 12, fontWeight: 800 }}>Total Incoming</div><div style={{ fontSize: 20, fontWeight: 900 }}>{formatPc(customerPcView.incomingPc)}</div></div>
                    <div><div style={{ color: '#334155', fontSize: 12, fontWeight: 800 }}>Total Redeemed</div><div style={{ color: '#B42318', fontSize: 20, fontWeight: 900 }}>{formatPc(customerPcView.redeemedPc)}</div></div>
                  </div>
                  {!customerPcView.protected ? (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                      <button type="button" disabled={Boolean(savingId)} onClick={handleProtectPc} style={{ ...buttonStyle, background: '#B42318', color: '#FFFFFF' }}>
                        {savingId === 'protect-pc' ? 'Protecting...' : 'Protect Current PC'}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div>
                  <button type="button" onClick={handleViewPcHistory} style={{ ...buttonStyle, background: '#E8EDF4', color: '#11185A', marginBottom: pcHistory ? 10 : 0 }}>
                    {pcHistory ? 'Hide History' : 'View History'}
                  </button>
                  {pcHistory ? (
                  <div style={{ ...latestFiveScrollStyle, maxHeight: 420, overflowX: 'auto', overflowY: 'auto', border: '1px solid #E8EDF4', borderRadius: 12 }}>
                    <table style={{ width: '100%', minWidth: 650, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Date', 'Type', 'Details', 'PC'].map((header) => <th key={header} style={thStyle}>{header}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {pcHistory.length === 0 ? (
                          <tr><td style={tdStyle} colSpan={4}>No incoming or redeemed PC history found.</td></tr>
                        ) : pcHistory.map((item) => (
                          <tr key={item.id}>
                            <td style={tdStyle}>{item.date ? formatDate(item.date) : '-'}</td>
                            <td style={{ ...tdStyle, color: item.direction === 'Incoming' ? '#4ADE80' : '#FCA5A5', fontWeight: 900 }}>{item.direction}</td>
                            <td style={tdStyle}><strong>{item.title}</strong><div style={{ color: '#D7DEEA', fontSize: 12, marginTop: 3 }}>{item.detail}</div></td>
                            <td style={{ ...tdStyle, color: item.direction === 'Incoming' ? '#4ADE80' : '#FCA5A5', fontWeight: 900 }}>{item.direction === 'Incoming' ? '+' : '-'}{formatPc(item.points)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      {showAdjustment ? (
        <div style={{ ...cardStyle, display: 'grid', gap: 12 }}>
          <label style={{ fontWeight: 800 }}>
            Select Customer
            <select
              value={adjustmentCustomerId}
              onChange={(event) => setAdjustmentCustomerId(event.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6, color: '#11185A' }}
            >
              <option value="">Select customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['add', 'deduct'] as const).map((direction) => (
              <button
                type="button"
                key={direction}
                onClick={() => setAdjustmentDirection(direction)}
                style={{ ...buttonStyle, background: adjustmentDirection === direction ? (direction === 'add' ? '#166534' : '#B42318') : '#E8EDF4', color: adjustmentDirection === direction ? '#FFFFFF' : '#11185A' }}
              >
                {direction === 'add' ? 'Add PC' : 'Deduct PC'}
              </button>
            ))}
          </div>
          <label style={{ fontWeight: 800 }}>
            PC Amount
            <input type="number" min="1" step="1" value={adjustmentPoints} onChange={(event) => setAdjustmentPoints(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6 }} />
          </label>
          <label style={{ fontWeight: 800 }}>
            Reason
            <input type="text" maxLength={140} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6 }} />
          </label>
          <div>
            <button type="button" disabled={Boolean(savingId)} onClick={handleManualAdjustment} style={{ ...buttonStyle, background: adjustmentDirection === 'add' ? '#166534' : '#B42318', color: '#FFFFFF' }}>
              {savingId === 'adjust-pc' ? 'Saving...' : adjustmentDirection === 'add' ? 'Add and Record' : 'Deduct and Record'}
            </button>
          </div>
        </div>
      ) : null}
      {showReferral ? (
          <div style={{ ...cardStyle, display: 'grid', gap: 12 }}>
            <label style={{ fontWeight: 800 }}>
              Select Customer
              <select
                value={selectedReferralCustomerId}
                onChange={(event) => setSelectedReferralCustomerId(event.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6, color: '#11185A' }}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
                ))}
              </select>
            </label>

            {selectedReferralCustomerId ? (
              <div style={{ padding: 14, borderRadius: 12, background: '#FFF7D6', color: '#11185A', border: '1px solid #D4AF37', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#334155', fontSize: 12, fontWeight: 800 }}>Selected customer</div>
                  <div style={{ fontWeight: 900, marginTop: 3 }}>{customers.find((customer) => customer.id === selectedReferralCustomerId)?.name}</div>
                </div>
                <button type="button" disabled={Boolean(savingId)} onClick={handleReferralApproval} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }}>
                  {savingId === 'referral' ? 'Approving...' : 'Approve'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

      <div style={sortedPendingRequests.length > 0 ? cardStyle : { ...cardStyle, display: 'inline-block', padding: 10 }}>
        <div style={{ marginBottom: sortedPendingRequests.length > 0 ? 14 : 0 }}>
          <button type="button" disabled={generating} onClick={handleGenerate} style={primaryActionStyle}>
            {generating ? 'Generating...' : 'Generate Requests'}
          </button>
        </div>

        {sortedPendingRequests.length > 0 ? <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Invoice', 'Due Date', 'Paid Date', 'Overdue', 'Invoice Amount', 'Suggested PC', 'Approved PC', 'Status', 'Actions'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPendingRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>
                    <strong>{request.invoiceNumber}</strong>
                    <div style={{ color: '#D7DEEA', fontSize: 12 }}>{request.invoiceDate ? formatDate(request.invoiceDate) : '-'}</div>
                  </td>
                  <td style={tdStyle}>{request.dueDate ? formatDate(request.dueDate) : '-'}</td>
                  <td style={tdStyle}>{request.fullPaymentDate ? formatDate(request.fullPaymentDate) : '-'}</td>
                  <td style={tdStyle}>{request.overdueDays} day(s)</td>
                  <td style={tdStyle}>{formatMoney(request.invoiceAmount)}</td>
                  <td style={tdStyle}>{formatPc(request.suggestedCoins)}</td>
                  <td style={tdStyle}>
                    {request.status === 'Pending' ? (
                      <input
                        type="number"
                        min="0"
                        value={coinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins}
                        onChange={(event) => setCoinEdits((current) => ({ ...current, [request.id]: Number(event.target.value) || 0 }))}
                        style={{ width: 96, padding: '8px 10px', borderRadius: 8, border: '1px solid #D8DEE9', boxSizing: 'border-box' }}
                      />
                    ) : formatPc(request.approvedCoins)}
                  </td>
                  <td style={{ ...tdStyle, color: request.status === 'Approved' ? '#166534' : request.status === 'Rejected' ? '#B42318' : '#B7791F', fontWeight: 900 }}>
                    {request.status}
                    {request.reviewedBy ? <div style={{ color: '#D7DEEA', fontSize: 12 }}>{request.reviewedBy}</div> : null}
                  </td>
                  <td style={tdStyle}>
                    {request.status === 'Pending' ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }} onClick={() => handleReview(request, 'Approved')}>
                          {savingId === request.id ? 'Saving...' : 'Approve'}
                        </button>
                        <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleReview(request, 'Rejected')}>
                          Reject
                        </button>
                      </div>
                    ) : 'Reviewed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : null}
      </div>

      <div style={sortedPendingBonusRequests.length > 0 ? cardStyle : { ...cardStyle, display: 'inline-block', padding: 10 }}>
        <div style={{ marginBottom: sortedPendingBonusRequests.length > 0 ? 14 : 0 }}>
          <button type="button" disabled={generatingBonus} onClick={handleGenerateBonus} style={primaryActionStyle}>
            {generatingBonus ? 'Generating...' : 'Generate Bonus Requests'}
          </button>
        </div>

        {sortedPendingBonusRequests.length > 0 ? <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Bonus', 'Trigger', 'Suggested PC', 'Approved PC', 'Generated', 'Status', 'Actions'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPendingBonusRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>
                    <strong>{request.bonusLabel}</strong>
                    <div style={{ color: '#D7DEEA', fontSize: 12 }}>{request.notes || '-'}</div>
                  </td>
                  <td style={tdStyle}>{request.triggerType || '-'}</td>
                  <td style={tdStyle}>{formatPc(request.suggestedCoins)}</td>
                  <td style={tdStyle}>
                    <input
                      type="number"
                      min="0"
                      value={bonusCoinEdits[request.id] ?? request.approvedCoins ?? request.suggestedCoins}
                      onChange={(event) => setBonusCoinEdits((current) => ({ ...current, [request.id]: Number(event.target.value) || 0 }))}
                      style={{ width: 96, padding: '8px 10px', borderRadius: 8, border: '1px solid #D8DEE9', boxSizing: 'border-box' }}
                    />
                  </td>
                  <td style={tdStyle}>{request.generatedAt ? formatDate(request.generatedAt.slice(0, 10)) : '-'}</td>
                  <td style={{ ...tdStyle, color: '#B7791F', fontWeight: 900 }}>{request.status}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }} onClick={() => handleBonusReview(request, 'Approved')}>
                        {savingId === request.id ? 'Saving...' : 'Approve'}
                      </button>
                      <button type="button" disabled={Boolean(savingId)} style={{ ...buttonStyle, background: '#FDECEC', color: '#B42318' }} onClick={() => handleBonusReview(request, 'Rejected')}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div> : null}
      </div>
    </div>
  );
};

export default OverduePcRequests;
