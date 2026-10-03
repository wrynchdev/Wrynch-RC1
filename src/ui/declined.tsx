// Declined work: parts customers saw on a sent report and didn't approve, grouped by vehicle, with when to follow up
// and why. Advisors text the customer (from their own phone, with a message drafted from the report), mark work
// booked, push the date out, or let it go. Work approved on a later visit counts as recovered.
import { useEffect, useState } from 'react';
import { addDays, declinedTotals, FOLLOW_UP, monthYear, readingText, reminderForVehicle, shortDate, type DeclinedItem } from '../domain/declined';
import type { Vehicle } from '../domain/types';
import { actions, declinedItems, declinedVehicle, isLive, todayIso, toast, useStore, type FollowupStatus } from '../state/store';
import { Icon, StateChip } from './kit';

type Tab = 'due' | 'upcoming' | 'booked' | 'closed';
const TABS: [Tab, string][] = [['due', 'Due now'], ['upcoming', 'Coming up'], ['booked', 'Booked'], ['closed', 'Closed']];
const inTab = (t: Tab, i: DeclinedItem) =>
  t === 'due' ? i.state === 'due' : t === 'upcoming' ? i.state === 'upcoming' || i.state === 'contacted'
    : t === 'booked' ? i.state === 'booked' : i.state === 'won' || i.state === 'resolved' || i.state === 'dismissed';
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const vname = (v: Vehicle) => `${v.year || ''} ${v.make} ${v.model}`.trim();

export function DeclinedWork() {
  const s = useStore((x) => x);
  const [tab, setTab] = useState<Tab>('due');
  const today = todayIso();
  useEffect(() => { void actions.loadDeclined(); }, []);
  const all = declinedItems(s, today);
  const totals = declinedTotals(all, today);
  const shown = all.filter((i) => inTab(tab, i));
  if (tab === 'closed') shown.sort((a, b) => (b.closed?.date ?? b.followup?.updatedAt ?? '').localeCompare(a.closed?.date ?? a.followup?.updatedAt ?? ''));
  const groups = new Map<string, DeclinedItem[]>();
  for (const i of shown) groups.set(i.vehicleId, [...(groups.get(i.vehicleId) ?? []), i]);
  const shop = s.workspace?.shop?.name ?? (s.mode === 'demo' ? 'Reyes Auto Care' : 'your shop');
  const loading = isLive() && !s.declinedData;

  return (
    <div className="wide stack" style={{ gap: 18, maxWidth: 1040 }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Declined work</h1>
        <div className="muted">
          Work customers saw on a report and didn’t approve. Parts measured on more than one visit are followed up about a month
          before they’re projected to need replacing; others after {FOLLOW_UP.monitor} days, and anything Immediate right away.
        </div>
      </div>
      <div className="kpis">
        <Kpi n={String(totals.due)} label="Due for a follow-up" sub="Now or overdue" />
        <Kpi n={String(totals.open)} label="Open items" sub={totals.openAmount ? `${money(totals.openAmount)} on estimates` : 'No estimate amounts yet'} />
        <Kpi n={money(totals.recovered)} label="Recovered" sub={`${totals.recoveredJobs} job${totals.recoveredJobs === 1 ? '' : 's'} in the last 90 days`} />
      </div>
      <div className="seg" role="tablist" aria-label="Which items" style={{ maxWidth: 560 }}>
        {TABS.map(([k, label]) => {
          const n = all.filter((i) => inTab(k, i)).length;
          return <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}{n ? ` (${n})` : ''}</button>;
        })}
      </div>
      {loading && <p className="muted" role="status">Loading declined work…</p>}
      {!loading && groups.size === 0 && (
        <div className="card pad muted">
          {tab === 'due' ? 'Nothing is due for a follow-up. Items show up here once a report is sent and the customer doesn’t approve a part.'
            : tab === 'upcoming' ? 'Nothing coming up.' : tab === 'booked' ? 'Nothing booked yet.' : 'Nothing closed yet.'}
        </div>
      )}
      {[...groups.entries()].map(([vehicleId, list]) => {
        const v = declinedVehicle(s, vehicleId);
        return v ? <VehicleGroup key={vehicleId} v={v} items={list} tab={tab} shop={shop} today={today} /> : null;
      })}
    </div>
  );
}

function Kpi({ n, label, sub }: { n: string; label: string; sub: string }) {
  return (
    <div className="card kpi">
      <span>
        <span className="n" style={{ display: 'block' }}>{n}</span>
        <span className="l" style={{ display: 'block' }}>{label}</span>
        <span className="s" style={{ display: 'block' }}>{sub}</span>
      </span>
    </div>
  );
}

function VehicleGroup({ v, items, tab, shop, today }: { v: Vehicle; items: DeclinedItem[]; tab: Tab; shop: string; today: string }) {
  const open = items.filter((i) => i.state === 'due' || i.state === 'upcoming' || i.state === 'contacted');
  const newest = [...items].sort((a, b) => b.recommendedOn.localeCompare(a.recommendedOn))[0];
  const reportUrl = isLive() && newest.reportToken ? `${window.location.origin}${window.location.pathname}#/r/${newest.reportToken}` : null;
  const text = reminderForVehicle(open.length ? open : items, v, shop, reportUrl, today);
  const phone = (v.customerPhone ?? '').replace(/[^\d+]/g, '');
  const inShop = items.find((i) => i.inShop)?.inShop ?? null;
  const markContacted = () => { for (const i of open) void actions.setFollowup(i, 'contacted', null); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Message copied. Paste it into a text to the customer.'); markContacted(); } catch { toast('Couldn’t copy. Select the message and copy it.', 'error'); }
  };
  return (
    <section className="card">
      <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line2)', background: 'var(--card2)', borderRadius: '14px 14px 0 0', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <a href={`#/vehicle/${v.id}`} style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{vname(v)}</a>
          <div className="small muted">{v.customer || 'No customer name'}{v.customerPhone ? ` · ${v.customerPhone}` : ''}</div>
        </div>
        {open.length > 0 && (
          <div className="row" style={{ gap: 8 }}>
            {phone
              ? <a className="btn primary sm" href={`sms:${phone}?&body=${encodeURIComponent(text)}`} onClick={markContacted}><Icon name="send" size={16} />Text {v.customer ? v.customer.split(/\s+/)[0] : 'customer'}</a>
              : <span className="small muted">No mobile number on file</span>}
            <button className="btn secondary sm" onClick={() => void copy()}>Copy message</button>
          </div>
        )}
      </div>
      {inShop && tab !== 'closed' && (
        <div className="small" style={{ padding: '10px 14px', background: 'var(--blue-tint)', color: 'var(--blue-text)' }}>
          <Icon name="car" size={15} /> In the shop now on <a href={`#/advisor/${inShop.inspectionId}`}>{inShop.ro ? `RO ${inShop.ro}` : 'an open inspection'}</a>. A good time to bring it up.
        </div>
      )}
      {open.length > 0 && tab !== 'closed' && (
        <details style={{ padding: '8px 14px 0' }}>
          <summary className="small muted" style={{ cursor: 'pointer' }}>Message preview</summary>
          <p className="small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{text}</p>
        </details>
      )}
      <div className="list">
        {items.map((i) => <ItemRow key={i.id} i={i} today={today} />)}
      </div>
    </section>
  );
}

const SNOOZE: [string, number][] = [['2 weeks', 14], ['1 month', 30], ['3 months', 91]];

function ItemRow({ i, today }: { i: DeclinedItem; today: string }) {
  const year = today.slice(0, 4);
  const set = (status: FollowupStatus, dueOn: string | null = i.followup?.dueOn ?? null) => void actions.setFollowup(i, status, dueOn);
  const isOpen = i.state === 'due' || i.state === 'upcoming' || i.state === 'contacted';
  return (
    <div className="stack" style={{ gap: 6, padding: '12px 14px', borderTop: '1px solid var(--line2)' }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 16 }}>{i.label}</strong>
        <StateChip state={i.rating} />
      </div>
      {i.findings.length > 0 && <div className="small">{i.findings.join(', ')}</div>}
      {i.reading && (
        <div className="small">
          Last reading {readingText(i.reading)} on {shortDate(i.reading.date, year)}.
          {i.forecast?.reached ? ' At the limit now.'
            : i.forecast?.date ? ` Projected to reach the limit around ${monthYear(i.forecast.date)}${i.forecast.odometer ? ` (about ${i.forecast.odometer.toLocaleString('en-US')} mi)` : ''}, from ${i.forecast.points} visits.`
            : i.forecast ? ' Wearing slowly: more than two years to the limit.' : ''}
        </div>
      )}
      <div className="small muted">
        Recommended {shortDate(i.recommendedOn, year)}{i.ro ? ` on RO ${i.ro}` : ''}{i.amount ? ` · ${money(i.amount)} estimate` : ''}
        {' · '}<a href={`#/advisor/${i.inspectionId}`}>Open report</a>
      </div>
      {isOpen && (
        <div className="small" style={{ color: i.state === 'due' ? 'var(--imm)' : 'var(--text2)', fontWeight: 600 }}>
          {i.state === 'due' ? (i.dueOn < today ? `Overdue since ${shortDate(i.dueOn, year)}` : 'Due today') : `Follow up ${shortDate(i.dueOn, year)}`}
          <span className="muted" style={{ fontWeight: 400 }}> · {i.dueWhy}</span>
          {i.followup?.contacts ? <span className="muted" style={{ fontWeight: 400 }}> · texted {i.followup.contacts}× (last {shortDate(i.followup.contactedAt!, year)})</span> : null}
        </div>
      )}
      {i.state === 'won' && <div className="small" style={{ color: 'var(--ok)', fontWeight: 600 }}>Recovered: approved {shortDate(i.closed!.date, year)}{i.closed!.amount ? ` · ${money(i.closed!.amount)}` : ''}</div>}
      {i.state === 'resolved' && <div className="small muted">Closed: rated OK on {shortDate(i.closed!.date, year)} (done here or elsewhere).</div>}
      {i.state === 'booked' && <div className="small" style={{ color: 'var(--ok)', fontWeight: 600 }}>Booked{i.followup?.dueOn ? ` for ${shortDate(i.followup.dueOn, year)}` : ''}</div>}
      {i.state === 'dismissed' && <div className="small muted">Not following up</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {isOpen && (
          <>
            <button className="btn secondary sm" onClick={() => set('booked', null)}><Icon name="check" size={16} />Booked</button>
            <label className="sr" htmlFor={`later-${i.id}`}>Remind me later</label>
            <select id={`later-${i.id}`} className="input" style={{ width: 'auto', height: 38, fontSize: 14 }} value="" onChange={(e) => {
              if (e.target.value) set('open', addDays(today, Number(e.target.value)));
            }}>
              <option value="">Remind me in…</option>
              {SNOOZE.map(([label, days]) => <option key={days} value={days}>{label}</option>)}
            </select>
            <button className="btn quiet sm" onClick={() => set('dismissed', null)}>Don’t follow up</button>
          </>
        )}
        {(i.state === 'booked' || i.state === 'dismissed') && <button className="btn quiet sm" onClick={() => set('open', null)}>Reopen</button>}
      </div>
    </div>
  );
}
