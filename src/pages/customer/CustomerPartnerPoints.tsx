import { useMemo, useState } from 'react';
import { AlertTriangle, Award, Coins, Gift, ReceiptText, Trophy, Wallet } from 'lucide-react';
import ExternalImage from '../../components/ExternalImage';
import { useCustomerPortalContext } from '../../components/CustomerMobileLayout';
import { createRedemptionRequest } from '../../services/firestoreService';
import { calculateInvoiceApcInfo, getInvoiceFullPaymentDate, isCurrentMonth } from '../../utils/customerPortal';
import { formatDate } from '../../utils/formatters';
import { formatApc } from '../../utils/loyalty';
import { getBusinessInvoices, getInvoiceDisplayNumber } from '../../utils/openingBalance';
import { sortNewestFirst } from '../../utils/listDisplay';

type PcHistoryFilter = 'all' | 'purchase' | 'bonus' | 'overdue';

interface PcHistoryItem {
  id: string;
  type: Exclude<PcHistoryFilter, 'all'>;
  title: string;
  detail: string;
  points: number;
  date: string;
}

const CustomerPartnerPoints = () => {
  const { customer, invoices, payments, settings, apcSummary, availableRewards, redemptionRequests, bonusPcRequests, overduePcRequests, refreshData } = useCustomerPortalContext();
  const [redemptionMessage, setRedemptionMessage] = useState('');
  const [redemptionError, setRedemptionError] = useState('');
  const [requestingRewardId, setRequestingRewardId] = useState('');
  const [pcHistoryFilter, setPcHistoryFilter] = useState<PcHistoryFilter>('all');
  const [showPcHistory, setShowPcHistory] = useState(false);
  const latestRequestByRewardId = sortNewestFirst(redemptionRequests, ['reviewedAt', 'requestedAt']).reduce((requestMap, request) => {
    if (!requestMap.has(request.rewardId)) {
      requestMap.set(request.rewardId, request);
    }
    return requestMap;
  }, new Map<string, (typeof redemptionRequests)[number]>());
  const currentMonthBonusRequests = bonusPcRequests.filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)));
  const currentMonthPcHistory = useMemo<PcHistoryItem[]>(() => {
    const purchaseItems = customer
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
      : [];
    const bonusItems = currentMonthBonusRequests.map((request): PcHistoryItem => ({
      id: `bonus-${request.id}`,
      type: 'bonus',
      title: request.bonusLabel,
      detail: request.notes || `Approved on ${formatDate((request.reviewedAt || request.generatedAt).slice(0, 10))}`,
      points: request.approvedCoins,
      date: (request.reviewedAt || request.generatedAt).slice(0, 10)
    }));
    const overdueItems = overduePcRequests
      .filter((request) => isCurrentMonth((request.reviewedAt || request.generatedAt).slice(0, 10)))
      .map((request): PcHistoryItem => ({
        id: `overdue-${request.id}`,
        type: 'overdue',
        title: `Overdue PC: ${request.invoiceNumber}`,
        detail: `Approved on ${formatDate((request.reviewedAt || request.generatedAt).slice(0, 10))}`,
        points: request.approvedCoins,
        date: (request.reviewedAt || request.generatedAt).slice(0, 10)
      }));

    return [...purchaseItems, ...bonusItems, ...overdueItems]
      .filter((item) => item.points > 0)
      .sort((left, right) => right.date.localeCompare(left.date));
  }, [currentMonthBonusRequests, customer, invoices, overduePcRequests, payments, settings]);
  const currentMonthTotalPc = currentMonthPcHistory.reduce((sum, item) => sum + item.points, 0);
  const visiblePcHistory = pcHistoryFilter === 'all' ? currentMonthPcHistory : currentMonthPcHistory.filter((item) => item.type === pcHistoryFilter);
  const pcHistoryFilters: { key: PcHistoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'purchase', label: 'Purchase' },
    { key: 'bonus', label: 'Bonus' },
    { key: 'overdue', label: 'Overdue' }
  ];

  const handleRewardRequest = async (rewardId: string) => {
    if (!customer) return;
    const reward = availableRewards.find((item) => item.id === rewardId);
    if (!reward) return;

    try {
      setRequestingRewardId(rewardId);
      setRedemptionError('');
      setRedemptionMessage('');
      await createRedemptionRequest(customer, reward);
      setRedemptionMessage('Reward request sent for approval.');
      await refreshData();
    } catch (err) {
      setRedemptionError(err instanceof Error ? err.message : 'Unable to request reward.');
    } finally {
      setRequestingRewardId('');
    }
  };

  return (
    <div>
      <section style={{ background: '#0B1F3A', color: '#FFFFFF', borderRadius: 22, padding: 16, boxShadow: '0 16px 32px rgba(11,31,58,0.18)', marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', right: -28, top: -28, width: 120, height: 120, borderRadius: '50%', border: '18px solid rgba(212,175,55,0.16)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', position: 'relative' }}>
          <div>
            <div style={{ color: '#D4AF37', fontWeight: 900, fontSize: 20 }}>Rewards</div>
            <div style={{ color: '#DDE6F2', fontSize: 12, fontWeight: 800, marginTop: 4 }}>Redeem your Partner Coins</div>
          </div>
          <div style={{ width: 58, height: 58, borderRadius: 18, background: '#FFF7D6', color: '#0B1F3A', display: 'grid', placeItems: 'center', position: 'relative' }}>
            <Gift size={28} />
            <div style={{ position: 'absolute', right: -5, top: -6, width: 26, height: 26, borderRadius: '50%', background: '#D4AF37', display: 'grid', placeItems: 'center', border: '2px solid #0B1F3A' }}>
              <Coins size={14} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowPcHistory((current) => !current)}
            style={{
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 16,
              padding: 12,
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <div style={{ color: '#BFC8D9', fontSize: 12, fontWeight: 800 }}>Available PC</div>
            <div style={{ color: '#FDE68A', fontSize: 25, fontWeight: 900, marginTop: 4 }}>{formatApc(apcSummary?.apcBalance ?? 0)}</div>
            <div style={{ color: '#DDE6F2', fontSize: 11, fontWeight: 900, marginTop: 5 }}>{showPcHistory ? 'Hide monthly history' : 'Tap for monthly history'}</div>
          </button>
          <div style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: 12 }}>
            <div style={{ color: '#BFC8D9', fontSize: 12, fontWeight: 800 }}>Current Level</div>
            <div style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 900, marginTop: 7 }}>{apcSummary?.currentLevel ?? 'Active Partner'}</div>
          </div>
        </div>
      </section>

      {showPcHistory ? (
      <section style={{ background: '#FFFFFF', borderRadius: 20, padding: 15, boxShadow: '0 10px 24px rgba(11,31,58,0.08)', marginBottom: 16 }}>
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
                background: pcHistoryFilter === filter.key ? '#0B1F3A' : '#EEF2F7',
                color: pcHistoryFilter === filter.key ? '#FFFFFF' : '#0B1F3A',
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
              const iconColor = item.type === 'purchase' ? '#166534' : item.type === 'bonus' ? '#0B1F3A' : '#B42318';

              return (
                <button
                  key={item.id}
                  type="button"
                  style={{
                    width: '100%',
                    border: '1px solid #E8EDF4',
                    borderRadius: 16,
                    background: '#FFFFFF',
                    padding: 11,
                    display: 'grid',
                    gridTemplateColumns: '42px 1fr auto',
                    alignItems: 'center',
                    gap: 10,
                    textAlign: 'left',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ width: 42, height: 42, borderRadius: 14, background: iconBackground, color: iconColor, display: 'grid', placeItems: 'center' }}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <div style={{ color: '#0B1F3A', fontSize: 13, fontWeight: 900 }}>{item.title}</div>
                    <div style={{ color: '#67738E', fontSize: 11, fontWeight: 800, marginTop: 3 }}>{item.detail}</div>
                  </div>
                  <div style={{ color: '#166534', fontSize: 16, fontWeight: 900 }}>+{formatApc(item.points)}</div>
                </button>
              );
            })}
          </div>
        )}
      </section>
      ) : null}

      <section style={{ background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 10px 24px rgba(11,31,58,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 900 }}>Available Rewards</div>
            <div style={{ color: '#67738E', fontSize: 12, fontWeight: 800, marginTop: 3 }}>
              {apcSummary?.rewardAvailable ? 'Some rewards are ready to request' : `You can view level rewards now; need ${formatApc(apcSummary?.pointsNeededForNextReward ?? 0)} more PC for the next request`}
            </div>
          </div>
          <div style={{ width: 42, height: 42, borderRadius: 14, background: '#FFF7D6', color: '#0B1F3A', display: 'grid', placeItems: 'center' }}>
            <Wallet size={21} />
          </div>
        </div>
        {redemptionError ? <div style={{ color: '#B42318', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{redemptionError}</div> : null}
        {redemptionMessage ? <div style={{ color: '#166534', fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{redemptionMessage}</div> : null}
        {availableRewards.length === 0 ? (
          <div style={{ color: '#67738E', fontSize: 13 }}>No rewards are available for your current partner level yet.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {availableRewards.map((reward) => {
              const rewardRequest = latestRequestByRewardId.get(reward.id);
              const hasEnoughApc = (apcSummary?.apcBalance ?? 0) >= reward.requiredPoints;
              const isRequested = rewardRequest?.status === 'Pending' || rewardRequest?.status === 'Approved';
              const isGifted = rewardRequest?.status === 'Gifted';
              const buttonText = isGifted ? 'Gifted' : isRequested ? 'Requested' : requestingRewardId === reward.id ? 'Sending' : 'Request';
              const isButtonDisabled = !hasEnoughApc || isRequested || isGifted || requestingRewardId === reward.id;

              return (
                <div key={reward.id} style={{ border: '1px solid #E8EDF4', borderRadius: 12, padding: 10 }}>
                  {reward.imageUrl ? (
                    <ExternalImage
                      src={reward.imageUrl}
                      alt={reward.name}
                      style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 12, display: 'block', marginBottom: 10 }}
                    />
                  ) : null}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>{reward.name}</div>
                      <div style={{ color: '#67738E', fontSize: 12 }}>{formatApc(reward.requiredPoints)} PC | {reward.levelRequired}</div>
                      {reward.description ? <div style={{ color: '#67738E', fontSize: 12, marginTop: 4 }}>{reward.description}</div> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRewardRequest(reward.id)}
                      disabled={isButtonDisabled}
                      style={{
                        border: 0,
                        borderRadius: 10,
                        background: isGifted ? '#EAF7EE' : isRequested || !hasEnoughApc ? '#E8EDF4' : '#D4AF37',
                        color: isGifted ? '#166534' : isRequested || !hasEnoughApc ? '#67738E' : '#0B1F3A',
                        padding: '8px 10px',
                        fontWeight: 900
                      }}
                    >
                      <Award size={15} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      {buttonText}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default CustomerPartnerPoints;
