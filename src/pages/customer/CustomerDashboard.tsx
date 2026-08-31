import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, CircleDollarSign, Coins, Gift, ReceiptText, Sparkles, Trophy, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { formatDate, formatMoney } from '../../utils/formatters';
import { getTodayDateString } from '../../utils/dateUtils';
import { calculateCustomerTotalOutstanding, calculateInvoiceApcInfo, getInvoiceFullPaymentDate, isCurrentMonth } from '../../utils/customerPortal';
import { formatApc } from '../../utils/loyalty';
import { getBusinessInvoices, getInvoiceDisplayNumber, isOpeningBalanceInvoice } from '../../utils/openingBalance';
import { getInvoicePaymentEffect } from '../../utils/paymentUtils';
import { getShopName } from '../../utils/shops';
import type { Invoice, Payment } from '../../types';

type PcHistoryFilter = 'all' | 'purchase' | 'bonus' | 'overdue';

interface PcHistoryItem {
  id: string;
  type: Exclude<PcHistoryFilter, 'all'>;
  title: string;
  detail: string;
  points: number;
  date: string;
}

interface OutstandingHistoryItem {
  id: string;
  type: 'invoice' | 'payment';
  date: string;
  transactionAmount: number;
  transactionCount: number;
  previousOutstanding: number;
  currentOutstanding: number;
  shopName?: string;
}

interface PaymentLedgerEvent {
  id: string;
  type: 'payment';
  date: string;
  createdAt?: string;
  order: number;
  amount: number;
  shopName: string;
}

const splitPaymentPattern = /Split payment\s+(\d+)\/(\d+)/i;

const getPaymentOutstandingEffect = (payment: Payment) => (
  getInvoicePaymentEffect(payment) + Math.max(0, payment.amountUsedForOldBalance ?? 0)
);

const getPaymentGroupKey = (payment: Payment) => {
  if (payment.splitPaymentGroupId) return `split:${payment.splitPaymentGroupId}`;

  const splitMatch = payment.notes.match(splitPaymentPattern);
  if (!splitMatch) return `payment:${payment.id}`;

  const baseNotes = payment.notes.replace(/\s*\|?\s*Split payment\s+\d+\/\d+/i, '').trim();
  return `legacy-split:${payment.customerId}|${payment.date}|${payment.mode}|${baseNotes}|${splitMatch[2]}`;
};

const buildPaymentLedgerEvents = (payments: Payment[]) => {
  const groupedEvents = new Map<string, PaymentLedgerEvent>();

  payments.forEach((payment) => {
    const groupKey = getPaymentGroupKey(payment);
    const existingEvent = groupedEvents.get(groupKey);
    const paymentEffect = getPaymentOutstandingEffect(payment);

    if (existingEvent) {
      existingEvent.amount += paymentEffect;

      if ((payment.createdAt ?? '') > (existingEvent.createdAt ?? '')) {
        existingEvent.createdAt = payment.createdAt;
      }
      return;
    }

    groupedEvents.set(groupKey, {
      id: groupKey,
      type: 'payment',
      date: payment.date,
      createdAt: payment.createdAt,
      order: 1,
      amount: paymentEffect,
      shopName: getShopName(payment.shopId)
    });
  });

  return Array.from(groupedEvents.values());
};

const compareLedgerDates = (
  left: { date: string; createdAt?: string; id: string; order: number },
  right: { date: string; createdAt?: string; id: string; order: number }
) => (
  left.date.localeCompare(right.date)
  || (left.createdAt ?? '').localeCompare(right.createdAt ?? '')
  || left.order - right.order
  || left.id.localeCompare(right.id)
);

const outstandingMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatOutstandingDate = (dateString: string) => {
  const [, month = '', day = ''] = dateString.match(/^\d{4}-(\d{2})-(\d{2})/) ?? [];
  const monthLabel = outstandingMonths[Number(month) - 1];
  return monthLabel && day ? `${Number(day)} ${monthLabel}` : dateString;
};

export const buildOutstandingHistory = (
  invoices: Invoice[],
  payments: Payment[],
  currentOutstanding: number
): OutstandingHistoryItem[] => {
  const events = [
    ...invoices.map((invoice) => ({
      id: invoice.id,
      type: isOpeningBalanceInvoice(invoice) ? 'opening_balance' as const : 'invoice' as const,
      date: invoice.date,
      createdAt: invoice.createdAt,
      order: 0,
      amount: Math.max(0, invoice.totalSales || invoice.salesAmount)
    })),
    ...buildPaymentLedgerEvents(payments).filter((payment) => payment.amount > 0)
  ].sort(compareLedgerDates).reverse();

  let runningOutstanding = Math.max(0, currentOutstanding);
  const newestHistory: OutstandingHistoryItem[] = [];
  let eventIndex = 0;
  let paymentCount = 0;

  while (eventIndex < events.length) {
    const event = events[eventIndex];

    if (event.type === 'opening_balance') {
      runningOutstanding = Math.max(0, runningOutstanding - event.amount);
      eventIndex += 1;
      continue;
    }

    if (event.type === 'payment') {
      if (paymentCount === 3) break;

      newestHistory.push({
        id: event.id,
        type: 'payment',
        date: event.date,
        transactionAmount: event.amount,
        transactionCount: 1,
        previousOutstanding: runningOutstanding + event.amount,
        currentOutstanding: runningOutstanding,
        shopName: event.shopName
      });
      runningOutstanding += event.amount;
      paymentCount += 1;
      eventIndex += 1;
      continue;
    }

    const currentAfterInvoices = runningOutstanding;
    const latestInvoiceDate = event.date;
    const invoiceIds: string[] = [];
    let invoiceAmount = 0;

    while (eventIndex < events.length && events[eventIndex].type === 'invoice') {
      invoiceIds.push(events[eventIndex].id);
      invoiceAmount += events[eventIndex].amount;
      eventIndex += 1;
    }

    const previousBeforeInvoices = Math.max(0, currentAfterInvoices - invoiceAmount);
    newestHistory.push({
      id: `invoices:${invoiceIds.join(':')}`,
      type: 'invoice',
      date: latestInvoiceDate,
      transactionAmount: invoiceAmount,
      transactionCount: invoiceIds.length,
      previousOutstanding: previousBeforeInvoices,
      currentOutstanding: currentAfterInvoices
    });
    runningOutstanding = previousBeforeInvoices;
  }

  return newestHistory;
};

const CustomerDashboard = () => {
  const { customer, invoices, payments, settings, invoiceViews, apcSummary, bonusPcRequests, overduePcRequests, refreshPcBalance } = useCustomerPortalContext();
  const navigate = useNavigate();
  const previousPcBalanceRef = useRef<number | null>(null);
  const bonusNoticeKeyRef = useRef('');
  const bonusNoticeVisibleRef = useRef(false);
  const [showPcHistory, setShowPcHistory] = useState(false);
  const [showOutstandingHistory, setShowOutstandingHistory] = useState(false);
  const [pcHistoryFilter, setPcHistoryFilter] = useState<PcHistoryFilter>('all');
  const [pcBalanceChange, setPcBalanceChange] = useState<number | null>(null);
  const [showCurrentMonthBonusCredit, setShowCurrentMonthBonusCredit] = useState(false);
  const totalOutstanding = customer?.totalOutstandingAmount ?? calculateCustomerTotalOutstanding(customer, invoiceViews);
  const currentMonthBonusRequests = bonusPcRequests.filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)));
  const currentMonthBonusPc = currentMonthBonusRequests.reduce((sum, request) => sum + request.approvedCoins, 0);
  const currentMonthBonusNoticeKey = customer?.id
    ? `customerMonthlyBonusSeen:${customer.id}:${getTodayDateString().slice(0, 7)}`
    : '';
  const currentMonthBonusLabels = useMemo(
    () => Array.from(new Set(currentMonthBonusRequests.map((request) => request.bonusLabel).filter(Boolean))),
    [currentMonthBonusRequests]
  );
  const pcBalance = apcSummary?.apcBalance ?? 0;
  const currentMonthPcHistory: PcHistoryItem[] = [
    ...(customer
      ? getBusinessInvoices(invoices)
          .map((invoice): PcHistoryItem | undefined => {
            const pcInfo = calculateInvoiceApcInfo(invoice, payments, customer.tier, settings);
            const fullPaymentDate = getInvoiceFullPaymentDate(invoice, payments);

            if (pcInfo.earnedApc <= 0 || !fullPaymentDate || !isCurrentMonth(fullPaymentDate)) return undefined;

            return {
              id: `purchase-${invoice.id}`,
              type: 'purchase',
              title: `Invoice ${getInvoiceDisplayNumber(invoice)}`,
              detail: `On-time payment credited on ${formatDate(fullPaymentDate)}`,
              points: pcInfo.earnedApc,
              date: fullPaymentDate
            };
          })
          .filter((item): item is PcHistoryItem => Boolean(item))
      : []),
    ...currentMonthBonusRequests.map((request): PcHistoryItem => ({
      id: `bonus-${request.id}`,
      type: 'bonus',
      title: request.bonusLabel,
      detail: request.notes || `Approved on ${formatDate((request.reviewedAt || request.generatedAt).slice(0, 10))}`,
      points: request.approvedCoins,
      date: (request.reviewedAt || request.generatedAt).slice(0, 10)
    })),
    ...overduePcRequests
      .filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)))
      .map((request): PcHistoryItem => ({
        id: `overdue-${request.id}`,
        type: 'overdue',
        title: `Overdue PC: ${request.invoiceNumber}`,
        detail: `Approved on ${formatDate((request.reviewedAt || request.generatedAt).slice(0, 10))}`,
        points: request.approvedCoins,
        date: (request.reviewedAt || request.generatedAt).slice(0, 10)
      }))
  ].filter((item) => item.points > 0).sort((left, right) => right.date.localeCompare(left.date));
  const currentMonthTotalPc = currentMonthPcHistory.reduce((sum, item) => sum + item.points, 0);
  const visiblePcHistory = pcHistoryFilter === 'all' ? currentMonthPcHistory : currentMonthPcHistory.filter((item) => item.type === pcHistoryFilter);
  const outstandingHistory = useMemo(
    () => buildOutstandingHistory(invoices, payments, totalOutstanding),
    [invoices, payments, totalOutstanding]
  );
  const pcHistoryFilters: { key: PcHistoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'purchase', label: 'Purchase' },
    { key: 'bonus', label: 'Bonus' },
    { key: 'overdue', label: 'Overdue' }
  ];

  useEffect(() => {
    void refreshPcBalance();
  }, [refreshPcBalance]);

  useEffect(() => {
    if (previousPcBalanceRef.current === null) {
      previousPcBalanceRef.current = pcBalance;
      return undefined;
    }

    const change = pcBalance - previousPcBalanceRef.current;
    previousPcBalanceRef.current = pcBalance;

    if (change === 0) return undefined;

    setPcBalanceChange(change);
    const timeout = window.setTimeout(() => setPcBalanceChange(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [pcBalance]);

  useEffect(() => {
    if (!currentMonthBonusNoticeKey || currentMonthBonusPc <= 0) {
      bonusNoticeVisibleRef.current = false;
      setShowCurrentMonthBonusCredit(false);
      return undefined;
    }

    if (bonusNoticeKeyRef.current !== currentMonthBonusNoticeKey) {
      bonusNoticeKeyRef.current = currentMonthBonusNoticeKey;

      try {
        bonusNoticeVisibleRef.current = window.localStorage.getItem(currentMonthBonusNoticeKey) === null;
        if (bonusNoticeVisibleRef.current) {
          window.localStorage.setItem(currentMonthBonusNoticeKey, new Date().toISOString());
        }
      } catch {
        bonusNoticeVisibleRef.current = true;
      }

      setShowCurrentMonthBonusCredit(bonusNoticeVisibleRef.current);
    }

    if (!bonusNoticeVisibleRef.current) return undefined;

    const timeout = window.setTimeout(() => {
      bonusNoticeVisibleRef.current = false;
      setShowCurrentMonthBonusCredit(false);
    }, 60_000);

    return () => window.clearTimeout(timeout);
  }, [currentMonthBonusNoticeKey, currentMonthBonusPc]);

  return (
    <div>
      <style>
        {`
          @keyframes dashboardCoinPulse {
            0% { transform: scale(1); filter: brightness(1); }
            34% { transform: scale(1.08); filter: brightness(1.16); }
            100% { transform: scale(1); filter: brightness(1); }
          }
          @keyframes dashboardCoinFloat {
            0% { opacity: 0; transform: translate(-50%, 8px) scale(0.92); }
            18% { opacity: 1; transform: translate(-50%, 0) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -34px) scale(1.08); }
          }
          @keyframes dashboardCoinSpark {
            0%, 100% { opacity: 0.25; transform: scale(0.8); }
            45% { opacity: 1; transform: scale(1.15); }
          }
        `}
      </style>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#BFC8D9', fontSize: 13, fontWeight: 800 }}>Welcome back</div>
      </div>

      <div
        style={{
          background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)',
          color: '#FFFFFF',
          borderRadius: 24,
          padding: 16,
          boxShadow: '0 18px 36px rgba(11,31,58,0.22)',
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ position: 'absolute', right: -22, top: -24, width: 110, height: 110, borderRadius: '50%', border: '18px solid rgba(212,175,55,0.16)' }} />
        <div style={{ position: 'absolute', left: -44, top: -18, width: 190, height: 132, opacity: 0.18, pointerEvents: 'none', transform: 'rotate(-10deg)' }}>
          <div style={{ position: 'absolute', inset: '16px 6px 10px 20px', border: '3px solid #FDE68A', borderRadius: 26, background: 'linear-gradient(135deg, rgba(212,175,55,0.22), rgba(253,230,138,0.04))', boxShadow: 'inset 0 0 0 2px rgba(212,175,55,0.30), 0 0 28px rgba(212,175,55,0.28)' }} />
          <div style={{ position: 'absolute', right: 10, top: 48, width: 58, height: 40, border: '3px solid #FDE68A', borderRadius: 16, background: 'rgba(212,175,55,0.18)' }}>
            <div style={{ position: 'absolute', left: 15, top: 13, width: 10, height: 10, borderRadius: '50%', background: '#FDE68A', boxShadow: '0 0 14px rgba(253,230,138,0.80)' }} />
          </div>
          <Wallet size={82} strokeWidth={1.5} style={{ position: 'absolute', left: 24, top: 28, color: '#FDE68A' }} />
          <div style={{ position: 'absolute', left: 48, top: 18, width: 76, height: 2, background: '#FDE68A', boxShadow: '20px 18px 0 #FDE68A, 44px 36px 0 #FDE68A' }} />
          <div style={{ position: 'absolute', left: 78, top: 18, width: 2, height: 62, background: '#FDE68A', boxShadow: '34px 16px 0 #FDE68A, -18px 34px 0 #FDE68A' }} />
          <div style={{ position: 'absolute', left: 42, top: 84, width: 8, height: 8, borderRadius: '50%', background: '#FDE68A', boxShadow: '32px -22px 0 #FDE68A, 76px -8px 0 #FDE68A, 102px -38px 0 #FDE68A' }} />
        </div>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 12, position: 'relative' }}>
          <div style={{ textAlign: 'center', justifySelf: 'start' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(212,175,55,0.16)', color: '#FDE68A', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 900 }}>
              <Sparkles size={14} />
              Available PC
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPcHistory((current) => !current)}
            aria-label="Toggle monthly PC history"
            style={{ position: 'relative', flex: '0 0 auto', width: 122, height: 122, border: 0, background: 'transparent', padding: 0, cursor: 'pointer' }}
          >
            <div
              style={{
                width: 122,
                height: 122,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: 'radial-gradient(circle at 34% 27%, #FFFBE8 0 10%, #FDE68A 28%, #D4AF37 62%, #8A5A00 100%)',
                border: '6px solid #F6E6A8',
                boxShadow: 'inset 0 0 0 4px rgba(138,90,0,0.42), 0 16px 30px rgba(212,175,55,0.36)',
                animation: pcBalanceChange !== null ? 'dashboardCoinPulse 900ms ease-out' : undefined
              }}
            >
              <div style={{ width: 88, height: 88, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.55)', color: '#4A3000', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: 31, lineHeight: 1, fontWeight: 900 }}>{formatApc(pcBalance)}</div>
                  <div style={{ fontSize: 11, fontWeight: 900, marginTop: 5 }}>PC</div>
                </div>
              </div>
            </div>
            {pcBalanceChange !== null ? (
              <>
                <div style={{ position: 'absolute', left: '50%', top: -2, color: pcBalanceChange > 0 ? '#00E676' : '#FCA5A5', background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', border: '1px solid rgba(255,255,255,0.22)', borderRadius: 999, padding: '5px 9px', fontSize: 12, fontWeight: 900, boxShadow: '0 10px 18px rgba(0,0,0,0.25)', animation: 'dashboardCoinFloat 1500ms ease-out forwards' }}>
                  {pcBalanceChange > 0 ? '+' : '-'}{formatApc(Math.abs(pcBalanceChange))}
                </div>
                <Sparkles size={16} style={{ position: 'absolute', right: 4, top: 12, color: '#FFF7D6', animation: 'dashboardCoinSpark 900ms ease-in-out infinite' }} />
                <Sparkles size={13} style={{ position: 'absolute', left: 6, bottom: 20, color: '#FDE68A', animation: 'dashboardCoinSpark 900ms ease-in-out 140ms infinite' }} />
              </>
            ) : null}
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate('/customer/partner-points')}
          style={{
            position: 'relative',
            marginTop: 18,
            width: '100%',
            border: 0,
            borderRadius: 16,
            background: '#D4AF37',
            color: '#11185A',
            padding: '12px 14px',
            fontWeight: 900,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer'
          }}
        >
          <Gift size={18} />
          Explore Rewards
          <ArrowRight size={18} />
        </button>
      </div>

      {showPcHistory ? (
        <section style={{ background: '#FFFFFF', borderRadius: 20, padding: 15, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ color: '#D4AF37', fontWeight: 900 }}>This Month PC History</div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginTop: 3 }}>All Partner Coins credited this month</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#166534', fontSize: 22, fontWeight: 900 }}>+{formatApc(currentMonthTotalPc)}</div>
              <div style={{ color: '#67738E', fontSize: 11, fontWeight: 900 }}>PC earned</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
            {pcHistoryFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setPcHistoryFilter(filter.key)}
                style={{
                  border: 0,
                  borderRadius: 999,
                  background: pcHistoryFilter === filter.key ? 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)' : '#EEF2F7',
                  color: pcHistoryFilter === filter.key ? '#FFFFFF' : '#11185A',
                  padding: '8px 11px',
                  fontSize: 12,
                  fontWeight: 900,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer'
                }}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {visiblePcHistory.length === 0 ? (
            <div style={{ background: '#F8F9FB', border: '1px solid #E8EDF4', borderRadius: 14, padding: 12, color: '#67738E', fontSize: 13, fontWeight: 800 }}>
              No PC credits in this category for the current month.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 9, maxHeight: 250, overflowY: 'auto', paddingRight: 3 }}>
              {visiblePcHistory.map((item) => {
                const Icon = item.type === 'purchase' ? ReceiptText : item.type === 'bonus' ? Trophy : AlertTriangle;
                const iconBackground = item.type === 'purchase' ? '#EAF7EE' : item.type === 'bonus' ? '#FFF7D6' : '#FDECEC';
                const iconColor = item.type === 'purchase' ? '#166534' : item.type === 'bonus' ? '#11185A' : '#B42318';

                return (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid #E8EDF4',
                      borderRadius: 16,
                      background: '#FFFFFF',
                      padding: 11,
                      display: 'grid',
                      gridTemplateColumns: '42px 1fr auto',
                      alignItems: 'center',
                      gap: 10
                    }}
                  >
                    <div style={{ width: 42, height: 42, borderRadius: 14, background: iconBackground, color: iconColor, display: 'grid', placeItems: 'center' }}>
                      <Icon size={20} />
                    </div>
                    <div>
                      <div style={{ color: '#11185A', fontSize: 13, fontWeight: 900 }}>{item.title}</div>
                      <div style={{ color: '#67738E', fontSize: 11, fontWeight: 800, marginTop: 3 }}>{item.detail}</div>
                    </div>
                    <div style={{ color: '#166534', fontSize: 16, fontWeight: 900 }}>+{formatApc(item.points)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <div style={{ background: 'linear-gradient(135deg, #11185A 0%, #1E2961 45%, #4C1D95 100%)', color: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 12 }}>
        <div style={{ color: '#D4AF37', fontWeight: 900, textAlign: 'center' }}>Total Outstanding</div>
        <button
          type="button"
          aria-expanded={showOutstandingHistory}
          aria-controls="customer-outstanding-history"
          onClick={() => setShowOutstandingHistory((current) => !current)}
          style={{ width: '100%', border: 0, background: 'transparent', color: '#FF7B7B', padding: '6px 0 2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
        >
          <span style={{ fontSize: 30, lineHeight: 1.2, fontWeight: 900 }}>{formatMoney(totalOutstanding)}</span>
          <ChevronDown size={21} aria-hidden="true" style={{ flex: '0 0 auto', transform: showOutstandingHistory ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 180ms ease' }} />
        </button>

        {showOutstandingHistory ? <div id="customer-outstanding-history" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.18)' }}>
          <div style={{ color: '#FDE68A', fontSize: 16, fontWeight: 900, marginBottom: 10 }}>Outstanding Record</div>
          {outstandingHistory.length === 0 ? (
            <div style={{ color: '#BFC8D9', fontSize: 15, fontWeight: 700 }}>No outstanding transactions found.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {outstandingHistory.map((item) => (
                <div key={item.id} style={{ background: item.type === 'payment' ? '#166534' : '#090B10', border: item.type === 'payment' ? '1px solid #22C55E' : '1px solid #252932', borderRadius: 8, padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
                    {item.type === 'invoice' ? (
                      <>
                        <span title={`${item.transactionCount} ${item.transactionCount === 1 ? 'invoice' : 'invoices'} added`} aria-label={`${item.transactionCount} ${item.transactionCount === 1 ? 'invoice' : 'invoices'} added`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#FF7B7B', fontSize: 16, fontWeight: 900 }}>
                          <ReceiptText size={21} aria-hidden="true" />
                          {item.transactionCount}
                        </span>
                        <span style={{ color: '#FF9A9A', fontSize: 13, fontWeight: 900 }}>Invoice added</span>
                      </>
                    ) : (
                      <>
                        <span title={`Payment received from ${item.shopName ?? 'Legacy / shared'}`} aria-label={`Payment received from ${item.shopName ?? 'Legacy / shared'} on ${formatOutstandingDate(item.date)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: '#D7DEEA', fontSize: 15, fontWeight: 900, whiteSpace: 'nowrap' }}>
                          <CircleDollarSign size={22} aria-hidden="true" style={{ color: '#4ADE80', flex: '0 0 auto' }} />
                          {formatOutstandingDate(item.date)}
                        </span>
                        <span style={{ minWidth: 0, color: '#BBF7D0', background: 'rgba(3, 48, 30, 0.48)', border: '1px solid rgba(187, 247, 208, 0.32)', borderRadius: 6, padding: '4px 7px', fontSize: 12, lineHeight: 1.2, fontWeight: 900, overflowWrap: 'anywhere', textAlign: 'right' }}>
                          {item.shopName ?? 'Legacy / shared'}
                        </span>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, paddingTop: 9, borderTop: item.type === 'payment' ? '1px solid rgba(187, 247, 208, 0.24)' : '1px solid #252932', color: '#FFFFFF', fontSize: 15, lineHeight: 1.35, fontWeight: 900, whiteSpace: 'nowrap', overflowX: 'auto' }}>
                    <span>{formatMoney(item.previousOutstanding)}</span>
                    <span style={{ color: item.type === 'invoice' ? '#FF7B7B' : '#FDE68A' }}>{item.type === 'invoice' ? '+' : '-'}</span>
                    <span style={{ color: item.type === 'invoice' ? '#FF7B7B' : '#BBF7D0' }}>{formatMoney(item.transactionAmount)}</span>
                    <span style={{ color: '#FDE68A' }}>=</span>
                    <span style={{ color: '#FF7B7B', fontWeight: 900 }}>{formatMoney(item.currentOutstanding)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div> : null}
      </div>

      {(customer?.advanceBalance ?? 0) > 0 ? (
        <div style={{ background: '#ECFDF3', color: '#166534', border: '1px solid #BBE7C8', borderRadius: 20, padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900 }}>Available Advance</div>
          <div style={{ fontSize: 26, fontWeight: 900, marginTop: 5 }}>{formatMoney(customer?.advanceBalance ?? 0)}</div>
          <div style={{ color: '#477A58', fontSize: 12, fontWeight: 800, marginTop: 5 }}>Automatically adjusted on your next invoice.</div>
        </div>
      ) : null}

      {currentMonthBonusPc > 0 && showCurrentMonthBonusCredit ? (
        <div style={{ background: '#FFFFFF', borderRadius: 20, padding: 15, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 12, border: '1px solid #F4DE91' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 46, height: 46, borderRadius: 16, background: '#FFF7D6', display: 'grid', placeItems: 'center', color: '#11185A' }}>
              <Coins size={24} />
            </div>
            <div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>This Month Bonus Credit</div>
              <div style={{ color: '#166534', fontSize: 22, fontWeight: 900 }}>+{formatApc(currentMonthBonusPc)} PC</div>
              <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800 }}>
                {currentMonthBonusLabels.join(', ')}
              </div>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default CustomerDashboard;
