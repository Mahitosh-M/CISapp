import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import SectionHeader from '../components/SectionHeader';
import { useAuth } from '../contexts/AuthContext';
import { approveReferralBonus, BONUS_PC_LABELS, generateBonusPcRequests, generateOverduePcRequests, getAppSettings, getApprovedBonusPcRequestsForCustomer, getApprovedOverduePcRequestsForCustomer, getBonusPcRequests, getCustomers, getInvoicesByCustomerId, getOverduePcRequests, getPaymentsByCustomerId, getRedemptionRequestsForCustomer, reviewBonusPcRequest, reviewOverduePcRequest } from '../services/firestoreService';
import type { AppSettings, BonusPcRequest, Customer, Invoice, OverduePcRequest, Payment, RedemptionRequest } from '../types';
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
  const [pcHistory, setPcHistory] = useState<PcHistoryItem[] | null>(null);
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
      const [invoiceRows, paymentRows, approvedBonusRows, approvedOverdueRows, redemptionRows] = await Promise.all([
        getInvoicesByCustomerId(customerId),
        getPaymentsByCustomerId(customerId),
        getApprovedBonusPcRequestsForCustomer(customerId, 200),
        getApprovedOverduePcRequestsForCustomer(customerId, 200),
        getRedemptionRequestsForCustomer(customerId, 200)
      ]);
      const businessInvoices = getBusinessInvoices(invoiceRows);
      const intelligenceResult = buildCustomerScores([customer], businessInvoices, paymentRows, new Date(), settings)[0];
      const portalCustomer = intelligenceResult ? { ...customer, tier: intelligenceResult.tier } : customer;
      const pcBalance = buildCustomerPortalPcBalance(portalCustomer, businessInvoices, paymentRows, settings, redemptionRows, approvedOverdueRows, approvedBonusRows);

      setCustomerPcView({
        customer: portalCustomer,
        availablePc: pcBalance.availablePc,
        incomingPc: pcBalance.incomingPc,
        redeemedPc: pcBalance.redeemedPc
      });
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
      .filter((request) => request.status === 'Gifted')
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

  const cardStyle: CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    color: '#0B1F3A',
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

  const tableStyle: CSSProperties = {
    width: '100%',
    minWidth: 1040,
    borderCollapse: 'collapse'
  };

  const thStyle: CSSProperties = {
    textAlign: 'left',
    padding: 12,
    background: '#F8F9FB',
    borderBottom: '1px solid #E8EDF4'
  };

  const tdStyle: CSSProperties = {
    padding: 12,
    borderBottom: '1px solid #E8EDF4',
    verticalAlign: 'top'
  };

  if (loading) {
    return <SectionHeader title="PC" description="Loading Partner Coin requests..." />;
  }

  return (
    <div>
      <SectionHeader title="PC" description="Approve Partner Coins for invoices paid after the tier due date plus buffer days." />

      {error ? <div style={{ color: '#FDECEC', marginBottom: 16 }}>{error}</div> : null}
      {message ? <div style={{ color: '#D4AF37', marginBottom: 16, fontWeight: 800 }}>{message}</div> : null}

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>Customer PC Balance</div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>View available, incoming, and redeemed Partner Coins.</div>
          </div>
          <button type="button" onClick={() => setShowPcViewer((current) => !current)} style={{ ...buttonStyle, background: '#0B1F3A', color: '#FFFFFF' }}>
            VIEW PC
          </button>
        </div>

        {showPcViewer ? (
          <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
            <label style={{ fontWeight: 800 }}>
              Select Customer
              <select
                value={selectedPcCustomerId}
                onChange={(event) => handlePcCustomerChange(event.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6, color: '#0B1F3A' }}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
                ))}
              </select>
            </label>

            {loadingPcView ? <div style={{ color: '#67738E', fontWeight: 800 }}>Loading PC details...</div> : null}

            {customerPcView && !loadingPcView ? (
              <>
                <div style={{ padding: 16, borderRadius: 14, background: '#FFF7D6', border: '1px solid #D4AF37' }}>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{customerPcView.customer.name}</div>
                  <div style={{ color: '#67738E', marginTop: 3 }}>Area: {customerPcView.customer.area || '-'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 14 }}>
                    <div><div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Available PC</div><div style={{ color: '#166534', fontSize: 24, fontWeight: 900 }}>{formatPc(customerPcView.availablePc)}</div></div>
                    <div><div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Total Incoming</div><div style={{ fontSize: 20, fontWeight: 900 }}>{formatPc(customerPcView.incomingPc)}</div></div>
                    <div><div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Total Redeemed</div><div style={{ color: '#B42318', fontSize: 20, fontWeight: 900 }}>{formatPc(customerPcView.redeemedPc)}</div></div>
                  </div>
                </div>

                <div>
                  <button type="button" onClick={handleViewPcHistory} style={{ ...buttonStyle, background: '#E8EDF4', color: '#0B1F3A', marginBottom: pcHistory ? 10 : 0 }}>
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
                            <td style={{ ...tdStyle, color: item.direction === 'Incoming' ? '#166534' : '#B42318', fontWeight: 900 }}>{item.direction}</td>
                            <td style={tdStyle}><strong>{item.title}</strong><div style={{ color: '#67738E', fontSize: 12, marginTop: 3 }}>{item.detail}</div></td>
                            <td style={{ ...tdStyle, color: item.direction === 'Incoming' ? '#166534' : '#B42318', fontWeight: 900 }}>{item.direction === 'Incoming' ? '+' : '-'}{formatPc(item.points)}</td>
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
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>Referral Bonus</div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
              Approve {formatPc(settings.loyaltySettings.referralBonus)} for a customer referral.
            </div>
          </div>
          <button type="button" onClick={() => setShowReferral((current) => !current)} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
            Referral
          </button>
        </div>

        {showReferral ? (
          <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
            <label style={{ fontWeight: 800 }}>
              Select Customer
              <select
                value={selectedReferralCustomerId}
                onChange={(event) => setSelectedReferralCustomerId(event.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #D8DEE9', marginTop: 6, color: '#0B1F3A' }}
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{formatCustomerSelectLabel(customer)}</option>
                ))}
              </select>
            </label>

            {selectedReferralCustomerId ? (
              <div style={{ padding: 14, borderRadius: 12, background: '#FFF7D6', border: '1px solid #D4AF37', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>Selected customer</div>
                  <div style={{ fontWeight: 900, marginTop: 3 }}>{customers.find((customer) => customer.id === selectedReferralCustomerId)?.name}</div>
                </div>
                <button type="button" disabled={Boolean(savingId)} onClick={handleReferralApproval} style={{ ...buttonStyle, background: '#166534', color: '#FFFFFF' }}>
                  {savingId === 'referral' ? 'Approving...' : 'Approve'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>Request Queue</div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
              The generator checks recent paid invoices and skips requests already created for an invoice.
            </div>
          </div>
          <button type="button" disabled={generating} onClick={handleGenerate} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
            {generating ? 'Generating...' : 'Generate Requests'}
          </button>
        </div>

        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Invoice', 'Due Date', 'Paid Date', 'Overdue', 'Invoice Amount', 'Suggested PC', 'Approved PC', 'Status', 'Actions'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPendingRequests.length === 0 ? (
                <tr><td style={tdStyle} colSpan={10}>No pending PC requests.</td></tr>
              ) : sortedPendingRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>
                    <strong>{request.invoiceNumber}</strong>
                    <div style={{ color: '#67738E', fontSize: 12 }}>{request.invoiceDate ? formatDate(request.invoiceDate) : '-'}</div>
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
                    {request.reviewedBy ? <div style={{ color: '#67738E', fontSize: 12 }}>{request.reviewedBy}</div> : null}
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
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900 }}>Bonus Request Queue</div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
              Pending bonuses need approval before PC is added. Approved/rejected requests are hidden from this queue but kept in history.
            </div>
            <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>
              Payment and target bonuses are generated once per customer per month. Referral bonuses are approved manually above.
            </div>
          </div>
          <button type="button" disabled={generatingBonus} onClick={handleGenerateBonus} style={{ ...buttonStyle, background: '#D4AF37', color: '#0B1F3A' }}>
            {generatingBonus ? 'Generating...' : 'Generate Bonus Requests'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {(['new_customer', 'payment', 'purchase_target', 'referral'] as const).map((key) => (
            <span key={key} style={{ background: '#FFF7D6', color: '#0B1F3A', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900 }}>
              {BONUS_PC_LABELS[key]}
            </span>
          ))}
        </div>

        <div style={{ color: '#67738E', fontSize: 12, marginBottom: 12 }}>
          Bonus PC is capped at 20% of the customer&apos;s base PC earned for the month when generated automatically.
        </div>

        <div style={{ ...latestFiveScrollStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Customer', 'Bonus', 'Trigger', 'Suggested PC', 'Approved PC', 'Generated', 'Status', 'Actions'].map((header) => (
                  <th key={header} style={thStyle}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedPendingBonusRequests.length === 0 ? (
                <tr><td style={tdStyle} colSpan={8}>No pending bonus requests.</td></tr>
              ) : sortedPendingBonusRequests.map((request) => (
                <tr key={request.id}>
                  <td style={tdStyle}>{request.customerName}</td>
                  <td style={tdStyle}>
                    <strong>{request.bonusLabel}</strong>
                    <div style={{ color: '#67738E', fontSize: 12 }}>{request.notes || '-'}</div>
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
        </div>
      </div>
    </div>
  );
};

export default OverduePcRequests;
