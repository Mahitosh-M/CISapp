import { ArrowUpRight, CalendarCheck, CalendarClock, CheckCircle2, ChevronDown, CircleX, Clock3, Coins, Crown, Gift, Handshake, Medal, RefreshCw, ShieldCheck, ShoppingBag, Sparkles, Tags, Trophy, Wallet } from 'lucide-react';
import { Fragment, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { PartnerLevelJourney, PartnerLevelTile } from '../utils/partnerLevelJourney';
import { formatDate } from '../utils/formatters';
import './CustomerLevelJourney.css';

const visual = {
  'Tier 4': { icon: Handshake, accent: '#1d4ed8', label: 'active' },
  'Tier 3': { icon: Medal, accent: '#475569', label: 'silver' },
  'Tier 2': { icon: Trophy, accent: '#854d0e', label: 'gold' },
  'Tier 1': { icon: Crown, accent: '#f5d782', label: 'platinum' }
};
const amount = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const stateText = { current: 'Your level', included: 'Included', next: 'Next level', higher: 'Aim higher' };

export function PartnerLevelSteps({ level, journey }: { level: PartnerLevelTile; journey: PartnerLevelJourney }) {
  const pending = [
    !level.startingLevel && !level.purchaseMet
      ? { key: 'purchase', icon: ShoppingBag, text: `Buy ${amount(level.remaining)} more before this month ends.` }
      : undefined,
    journey.dueToday > 0
      ? { key: 'due-today', icon: Clock3, text: `Pay ${amount(journey.dueToday)} today.` }
      : undefined,
    journey.nextDueAmount > 0 && journey.nextDueDate
      ? { key: 'next-due', icon: Clock3, text: `Pay ${amount(journey.nextDueAmount)} by ${formatDate(journey.nextDueDate)}.` }
      : undefined,
    journey.undatedBalance > 0
      ? { key: 'undated', icon: Wallet, text: 'Ask the shop to confirm the payment date for your older balance.' }
      : undefined,
    level.upgradeReasons.length === 0 && level.historyMessage
      ? { key: 'history', icon: CalendarClock, text: level.unlockDate
        ? `Locked until ${formatDate(level.unlockDate)}. ${level.historyMessage}`
        : level.historyMessage }
      : undefined,
    level.upgradeReasons.length === 0 && level.paymentMessage
      ? { key: 'payment', icon: ShieldCheck, text: level.paymentMessage }
      : undefined
  ].filter((item): item is { key: string; icon: typeof ShoppingBag; text: string } => Boolean(item));
  const blocked = [
    journey.overdue > 0
      ? { key: 'overdue', text: `Clear ${amount(journey.overdue)} overdue now. Late payment may block this level.` }
      : undefined,
    ...level.upgradeReasons.map((reason, index) => ({ key: `reason-${index}`, text: reason }))
  ].filter((item): item is { key: string; text: string } => Boolean(item));

  if (pending.length === 0 && blocked.length === 0) {
    return <div className="partner-all-clear"><CheckCircle2 size={18} aria-hidden="true" />No pending requirements for this level.</div>;
  }

  return (
    <ul className="partner-steps">
      {pending.map(({ key, icon: Icon, text }) => <li className="is-pending" key={key}><Icon size={17} aria-hidden="true" /><span>{text}</span></li>)}
      {blocked.map(({ key, text }) => <li className="is-blocked" key={key}><CircleX size={17} aria-hidden="true" /><span>{text}</span></li>)}
    </ul>
  );
}

export default function CustomerLevelJourney({ journey, loading, onRefresh }: {
  journey?: PartnerLevelJourney;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [selectedTier, setSelectedTier] = useState<string>();
  const selectedIndex = journey?.levels.findIndex((level) => level.tier === selectedTier) ?? -1;
  const selectedLevel = journey?.levels[selectedIndex];
  const selectedRow = Math.floor(selectedIndex / 2);
  const desktopRows = ['1fr', '1fr'];
  const mobileRows = ['1fr', '1fr', '1fr', '1fr'];
  if (selectedLevel) {
    desktopRows.splice(selectedRow + 1, 0, 'auto');
    mobileRows.splice(selectedIndex + 1, 0, 'auto');
  }
  if (!journey) return (
    <section className="partner-journey partner-journey-empty" aria-live="polite">
      <Sparkles size={24} aria-hidden="true" />
      <p>{loading ? 'Getting your partner goals…' : 'Your partner goals will appear when your customer account details are available.'}</p>
    </section>
  );
  return (
    <section className="partner-journey" aria-label="Your partner levels" aria-busy={loading}>
      <header className="partner-journey-heading">
        <div><span className="partner-eyebrow"><Sparkles size={14} aria-hidden="true" /> YOUR NEXT MILESTONE</span>
          <h2>Grow your partnership</h2></div>
        <button className="partner-refresh" type="button" aria-label="Refresh purchases and payments" title="Refresh purchases and payments" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={18} aria-hidden="true" className={loading ? 'partner-refreshing' : ''} />
        </button>
      </header>
      {(journey.dueNow > 0 || journey.undatedBalance > 0) && <div className={`partner-payment-note ${journey.dueNow > 0 ? 'has-due' : journey.undatedBalance > 0 ? 'needs-check' : 'is-clear'}`}>
        <Wallet size={24} aria-hidden="true" />
        <div><strong>{journey.dueNow > 0 ? `${amount(journey.dueNow)} to pay now` : 'Some payment dates need checking'}</strong>
          {journey.overdue > 0 && <p>{amount(journey.overdue)} overdue.</p>}
          {journey.dueToday > 0 && <p>{amount(journey.dueToday)} is due today.</p>}
          {journey.undatedBalance > 0 && <p>Older or undated balance: {amount(journey.undatedBalance)}.</p>}
          {(journey.dueNow > 0 || journey.undatedBalance > 0) && <Link to="/customer/invoices">See your bills <ArrowUpRight size={15} aria-hidden="true" /></Link>}
        </div>
      </div>}
      <p className="partner-period-note">{journey.monthName} purchase targets</p>
      <div className="partner-level-grid" style={{ '--level-rows': desktopRows.join(' '), '--level-mobile-rows': mobileRows.join(' ') } as CSSProperties}>
        {journey.levels.map((level, index) => {
          const { icon: Icon, accent, label } = visual[level.tier];
          const row = Math.floor(index / 2);
          return (
            <Fragment key={level.tier}>
            <article className={`partner-level-card partner-level-${label} ${level.state === 'current' ? 'is-current' : ''}`} style={{
              '--level-accent': accent,
              '--card-column': index % 2 + 1,
              '--card-row': row + 1 + (selectedLevel && row > selectedRow ? 1 : 0),
              '--card-mobile-row': index + 1 + (selectedLevel && index > selectedIndex ? 1 : 0)
            } as CSSProperties}>
              <div className="partner-level-card-top"><span className="partner-level-icon"><Icon size={27} aria-hidden="true" /></span><span className="partner-level-status">{stateText[level.state]}</span></div>
              <h3>{level.name}</h3>
              <div className="partner-target">
                <span>{level.startingLevel ? 'START HERE' : level.purchaseMet ? "THIS MONTH'S TARGET" : 'BUY MORE THIS MONTH'}</span>
                <strong className={level.purchaseMet ? 'partner-target-completed' : undefined}>{level.purchaseMet ? 'COMPLETED' : amount(level.remaining)}</strong>
              </div>
              <div className="partner-purchase-progress">
                <div className="partner-progress-label"><span>{level.startingLevel ? 'No minimum purchase' : 'This month’s progress'}</span><strong>{level.startingLevel ? '—' : `${level.progress}%`}</strong></div>
                <div className="partner-progress-track" role={level.startingLevel ? undefined : 'progressbar'} aria-hidden={level.startingLevel || undefined} aria-label={`${level.name} purchase progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level.progress} aria-valuetext={`${amount(journey.thisMonthPurchases)} purchased this month; ${amount(level.remaining)} still needed`}>
                  <span style={{ width: `${level.progress}%` }} />
                </div>
              </div>
              <div className="partner-purchase-slot">
                {level.upgradeReasons.length > 0 ? (
                  <div className="partner-upgrade-notice" role="note" aria-label={`${level.name}: why this level is not active`}>
                    <span className="partner-notice-pin" aria-hidden="true" />
                    <strong>Upgrade not unlocked</strong>
                    <p>{level.upgradeReasons[0]}</p>
                  </div>
                ) : <dl className="partner-purchase-amounts">
                  <div className="partner-bought"><dt>Bought this month</dt><dd>{amount(journey.thisMonthPurchases)}</dd></div>
                  <div className="partner-month-target"><dt>This month’s target</dt><dd>{level.startingLevel ? 'No minimum' : amount(level.monthlyTarget)}</dd></div>
                </dl>}
              </div>
              <div className="partner-card-payment">{journey.dueNow > 0 ? <><Wallet size={15} aria-hidden="true" />{amount(journey.dueNow)} due now</> : <><CheckCircle2 size={15} aria-hidden="true" />{journey.undatedBalance > 0 ? 'Check your payment dates' : 'Pay future bills on time'}</>}</div>
              <button className="partner-howto-button" type="button" aria-expanded={selectedTier === level.tier} aria-controls={selectedTier === level.tier ? 'partner-action-panel' : undefined} onClick={() => setSelectedTier(selectedTier === level.tier ? undefined : level.tier)}>What should I do? <ChevronDown size={17} aria-hidden="true" /></button>
            </article>
            {selectedTier === level.tier && <div id="partner-action-panel" className="partner-action-panel" style={{ '--panel-row': row + 2, '--panel-mobile-row': index + 2 } as CSSProperties}>
              <h3>{level.name} · Next steps</h3><PartnerLevelSteps level={level} journey={journey} />
            </div>}
            </Fragment>
          );
        })}
      </div>
      <section className="partner-benefits-poster" aria-labelledby="partner-benefits-title">
        <div className="partner-poster-heading"><Gift size={28} aria-hidden="true" /><div><span className="partner-eyebrow">MORE TO LOOK FORWARD TO</span><h2 id="partner-benefits-title">Benefits at every level</h2></div></div>
        <div className="partner-benefits-grid">{journey.levels.map((level) => {
          const { icon: Icon, accent, label } = visual[level.tier];
          return <article className={`partner-benefit partner-level-${label}`} key={level.tier} style={{ '--level-accent': accent } as CSSProperties}>
            <h3><Icon size={22} aria-hidden="true" />{level.name}</h3>
            <ul>
              <li><CalendarCheck size={20} aria-hidden="true" /><div><strong>{level.creditDays > 0 ? `Up to ${level.creditDays} days to pay` : 'Pay when you buy'}</strong></div></li>
              {level.earnsCoins && <li className="partner-coin-benefit"><Coins size={20} aria-hidden="true" /><div><strong>Partner Coins · Same invoice</strong>
                <dl className="partner-coin-comparison">{(journey.levels[journey.levels.length - 1]?.coinComparison ?? []).map((comparison) => (
                  <div key={comparison.tier} className={comparison.tier === level.tier ? 'is-selected' : ''}>
                    <dt>{comparison.name.replace(' Partner', '')}</dt><dd>{comparison.coins} coins</dd>
                  </div>
                ))}</dl>
              </div></li>}
              <li><Tags size={20} aria-hidden="true" /><div><strong>Offers for your level</strong></div></li>
              <li><Gift size={20} aria-hidden="true" /><div><strong>Use coins for rewards</strong></div></li>
            </ul>
          </article>;
        })}</div>
      </section>
    </section>
  );
}
