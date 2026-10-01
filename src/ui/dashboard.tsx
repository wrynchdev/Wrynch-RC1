// Shop dashboard: what's in the bays, what's waiting on the advisor, what customers approved.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { summarizeDashboard, type Approval, type DashEvent, type DayBucket } from '../domain/dashboard';
import { actions, useStore } from '../state/store';
import { Icon } from './kit';

// Chart colors: the first three slots of the validated categorical palette, dark steps
// (checked against the card surface #111a2b: all six checks pass).
const SERIES = [
  { key: 'sent', label: 'Sent to customer', color: '#3987e5' },
  { key: 'review', label: 'Awaiting review', color: '#d95926' },
  { key: 'progress', label: 'In progress', color: '#199e70' },
] as const;

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
function ago(at: string, now = Date.now()) {
  const m = Math.round((now - new Date(at).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const EVENT: Record<DashEvent['kind'], { icon: string; text: (e: DashEvent) => string }> = {
  created: { icon: 'clipboard', text: () => 'New inspection' },
  submitted: { icon: 'review', text: () => 'Ready for advisor review' },
  sent: { icon: 'send', text: () => 'Report sent to customer' },
  delivered: { icon: 'send', text: (e) => (e.detail === 'sms' ? 'Report texted to customer' : e.detail === 'email' ? 'Report emailed to customer' : 'Report link created') },
  approved: { icon: 'approve', text: (e) => `Customer approved ${e.detail ?? ''} ${e.detail === '1' ? 'repair' : 'repairs'}`.replace('  ', ' ') },
};

export function Dashboard() {
  const s = useStore((x) => x);
  const [days, setDays] = useState(() => { try { return Number(localStorage.getItem('wrynch-dash-days')) || 7; } catch { return 7; } });
  useEffect(() => { void actions.loadDashboard(days); }, [days, s.mode, s.workspace?.shop?.id, s.mode === 'demo' ? s.inspections : null]);
  const data = s.dashboard;
  const sum = useMemo(() => (data ? summarizeDashboard(data, days) : null), [data, days]);
  const first = (s.workspace?.me?.name ?? (s.mode === 'demo' ? 'Jordan' : '')).split(' ')[0];
  const pickDays = (n: number) => { setDays(n); try { localStorage.setItem('wrynch-dash-days', String(n)); } catch { /* ignore */ } };

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>{greeting()}{first ? `, ${first}` : ''}.</h1>
          <p>{sum ? `${sum.inProgress} ${sum.inProgress === 1 ? 'inspection' : 'inspections'} in progress · ${sum.awaitingReview} awaiting review` : 'Loading your shop…'}</p>
        </div>
        <div className="tools">
          <label className="sr" htmlFor="range">Date range</label>
          <select id="range" className="input" value={days} onChange={(e) => pickDays(Number(e.target.value))}>
            <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <a className="btn primary sm hide-mobile" href="#/new"><Icon name="plus" size={16} />New inspection</a>
        </div>
      </div>

      {sum && data && (
        <>
          <div className="kpis">
            <Kpi icon="clipboard" tone="blue" n={String(sum.inProgress)} label="In progress" sub="Open inspections in the bays" href="#/jobs" />
            <Kpi icon="review" tone="amber" n={String(sum.awaitingReview)} label="Awaiting review" sub={sum.urgent ? `${sum.urgent} with red items` : 'Ready for the advisor'} href="#/advisor" />
            {data.money ? (
              <>
                <Kpi icon="dollar" tone="violet" n={money(sum.quoted)} label="Quoted" sub={`Estimates on reports, ${rangeText(days)}`} />
                <Kpi icon="approve" tone="green" n={money(sum.approved)} label="Approved"
                  sub={sum.approvalRate === null ? 'No quotes yet' : `${Math.round(sum.approvalRate * 100)}% of quoted`} />
              </>
            ) : (
              <>
                <Kpi icon="send" tone="violet" n={String(sum.sent)} label="Sent to customers" sub={rangeText(days)} />
                <Kpi icon="immediate" tone="green" n={String(sum.urgent)} label="Reports with red items" sub="Awaiting review" />
              </>
            )}
          </div>

          <ApprovalPanel a={sum.approval} days={days} owner={s.mode === 'demo' || s.workspace?.role === 'owner'} />

          <div className="dash-grid">
            <section className="card panel" aria-labelledby="act-h">
              <div className="head">
                <h2 id="act-h">Inspection activity</h2>
                <div className="legend" aria-hidden="true">{SERIES.map((x) => <span key={x.key}><i style={{ background: x.color }} />{x.label}</span>)}</div>
              </div>
              <ActivityChart series={sum.series} />
            </section>
            <section className="card panel" aria-labelledby="feed-h">
              <h2 id="feed-h">Recent activity</h2>
              {sum.recent.length === 0 ? <div className="empty">Nothing yet {rangeText(days)}.</div> : (
                <div className="feed">
                  {sum.recent.map((e, k) => (
                    <a key={k} href={e.kind === 'created' ? `#/insp/${e.inspectionId}` : `#/advisor/${e.inspectionId}`}>
                      <span className={`ev ${e.kind}`}><Icon name={EVENT[e.kind].icon} size={16} /></span>
                      <span style={{ minWidth: 0 }}>
                        <span className="t" style={{ display: 'block' }}>{e.ro && <span className="ro">RO {e.ro}</span>}{EVENT[e.kind].text(e)}</span>
                        <span className="d" style={{ display: 'block' }}>{e.vehicle}</span>
                      </span>
                      <span className="w">{ago(e.at)}</span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>

          <Queue rows={data.rows.filter((r) => r.status === 'submitted')} title="Waiting on the advisor" money={data.money} empty="Nothing waiting. Reports land here when a tech sends an inspection to the advisor." hrefFor={(id) => `#/advisor/${id}`} action="Review" />
          <Queue rows={data.rows.filter((r) => r.status === 'not_started' || r.status === 'in_progress')} title="In the bays" money={false} empty="No open inspections." hrefFor={(id) => `#/insp/${id}`} action="Open" />
        </>
      )}
    </div>
  );
}

/** The pilot's key number: of the work recommended on reports sent, how much customers approved, against the shop's before-Wrynch rate. */
function ApprovalPanel({ a, days, owner }: { a: Approval; days: number; owner: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
  const weeks = a.weeks;
  const save = (e: FormEvent) => { e.preventDefault(); const n = val.trim() === '' ? null : Number(val); void actions.setApprovalBaseline(n !== null && Number.isFinite(n) ? n : null); setEditing(false); };
  return (
    <section className="card panel approval" aria-labelledby="appr-h">
      <div className="appr-main">
        <h2 id="appr-h">Approval rate</h2>
        <div className="appr-big">{pct(a.rate)}</div>
        <p className="appr-sub">{a.reports === 0 ? `No reports sent to customers ${rangeText(days)}.`
          : `${a.approved} of ${a.recommended} recommended ${a.recommended === 1 ? 'item' : 'items'} approved on ${a.reports} ${a.reports === 1 ? 'report' : 'reports'} sent ${rangeText(days)}.`}</p>
        {a.baseline !== null && !editing && (
          <p className="appr-base">
            Before Wrynch: <b>{a.baseline}%</b>
            {a.change !== null && <span className={`delta ${a.change >= 0 ? 'up' : 'down'}`}>{a.change >= 0 ? '+' : ''}{a.change} pts</span>}
            {owner && <button className="linkbtn" onClick={() => { setVal(String(a.baseline)); setEditing(true); }}>Change</button>}
          </p>
        )}
        {a.baseline === null && !editing && owner && (
          <p className="appr-base">What did customers approve before Wrynch? <button className="linkbtn" onClick={() => { setVal(''); setEditing(true); }}>Add your estimate</button> to compare.</p>
        )}
        {editing && (
          <form className="row appr-form" onSubmit={save}>
            <label htmlFor="baseline" className="small">Before Wrynch, customers approved about</label>
            <input id="baseline" className="input" inputMode="decimal" style={{ width: 80 }} value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ''))} autoFocus />
            <span className="small">% of recommended work</span>
            <button className="btn sm primary">Save</button>
            <button type="button" className="btn sm quiet" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        )}
      </div>
      <div className="appr-weeks" role="img" aria-label={`Approval rate by week: ${weeks.map((w) => `${w.start} ${w.recommended ? pct(w.approved / w.recommended) : 'no reports'}`).join(', ')}`}>
        {weeks.map((w) => {
          const r = w.recommended ? w.approved / w.recommended : null;
          return (
            <div key={w.start} className="wk" title={r === null ? 'No reports sent' : `${w.approved} of ${w.recommended} approved`}>
              <span className="v">{pct(r)}</span>
              <span className="bar"><i style={{ height: `${Math.max(r ?? 0, 0.02) * 100}%`, opacity: r === null ? 0.25 : 1 }} />
                {a.baseline !== null && <b style={{ bottom: `${a.baseline}%` }} />}</span>
              <span className="d">{new Date(`${w.start}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
          );
        })}
      </div>
      <p className="appr-note">Weeks start Monday. Approvals on recent reports can still come in.{a.baseline !== null ? ' The line marks your before-Wrynch rate.' : ''}</p>
    </section>
  );
}

const rangeText = (days: number) => (days === 1 ? 'today' : `last ${days} days`);

function Kpi({ icon, tone, n, label, sub, href }: { icon: string; tone: string; n: string; label: string; sub: string; href?: string }) {
  const body = (
    <>
      <span className={`ic ${tone}`}><Icon name={icon} size={22} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="n" style={{ display: 'block' }}>{n}</span>
        <span className="l" style={{ display: 'block' }}>{label}</span>
        <span className="s" style={{ display: 'block' }}>{sub}</span>
      </span>
    </>
  );
  return href ? <a className="card kpi" href={href} style={{ color: 'var(--ink)' }}>{body}</a> : <div className="card kpi">{body}</div>;
}

/** Stacked bars per day. Thin bars, 2px gaps between segments, rounded top, recessive grid, hover tooltip, table for screen readers. */
function ActivityChart({ series }: { series: DayBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width so text stays at its true size on phones.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 320 : 720));
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = W < 480 ? 220 : 260, L = 30, R = 6, T = 10, B = 28;
  const max = Math.max(4, ...series.map((d) => d.sent + d.review + d.progress));
  const step = max <= 8 ? 2 : max <= 20 ? 5 : Math.ceil(max / 4 / 5) * 5;
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L - R) / series.length;
  const bw = Math.max(4, Math.min(28, slot * 0.56));
  const every = Math.max(1, Math.ceil(series.length / Math.max(3, Math.floor(W / 64))));
  const d = hover === null ? null : series[hover];
  return (
    <div className="chart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Inspections per day by status, ${series.length} days`} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: top / step + 1 }, (_, k) => k * step).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#1E2B44" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#8C9AB1">{v}</text>
          </g>
        ))}
        {series.map((day, i) => {
          const cx = L + slot * i + slot / 2;
          let base = 0;
          const segs = SERIES.map((x) => ({ ...x, v: day[x.key] })).filter((x) => x.v > 0);
          return (
            <g key={day.date}>
              {hover === i && <rect x={cx - slot / 2 + 2} y={T} width={slot - 4} height={H - T - B} rx={6} fill="rgba(255,255,255,.04)" />}
              {segs.map((x, j) => {
                const y0 = y(base), y1 = y(base + x.v);
                base += x.v;
                const isTop = j === segs.length - 1;
                const h = Math.max(1, y0 - y1 - (j > 0 ? 2 : 0)); // 2px surface gap between stacked segments
                const yTop = y1;
                return isTop
                  ? <path key={x.key} d={roundTop(cx - bw / 2, yTop, bw, h, Math.min(4, h, bw / 2))} fill={x.color} />
                  : <rect key={x.key} x={cx - bw / 2} y={yTop} width={bw} height={h} fill={x.color} />;
              })}
              {(i % every === 0 || i === series.length - 1) && <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="#8C9AB1">{dayLabel(day.date)}</text>}
              <rect x={cx - slot / 2} y={T} width={slot} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
                tabIndex={0} aria-label={`${dayLabel(day.date)}: ${day.sent} sent, ${day.review} awaiting review, ${day.progress} in progress`} />
            </g>
          );
        })}
      </svg>
      {d && hover !== null && (
        <div className="tip" style={{ left: `${((L + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(d.sent + d.review + d.progress) / H) * 100}%` }}>
          <b>{dayLabel(d.date)}</b>
          {SERIES.map((x) => <div key={x.key}><span><i style={{ background: x.color }} />{x.label}</span><span>{d[x.key]}</span></div>)}
        </div>
      )}
      <div className="sr"><table>
        <caption>Inspections per day by status</caption>
        <thead><tr><th>Day</th>{SERIES.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
        <tbody>{series.map((day) => <tr key={day.date}><td>{dayLabel(day.date)}</td>{SERIES.map((x) => <td key={x.key}>{day[x.key]}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}

/** A bar with only its top corners rounded, anchored flat to the baseline. */
function roundTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Queue({ rows, title, money: showMoney, empty, hrefFor, action }: {
  rows: import('../domain/dashboard').DashRow[]; title: string; money: boolean; empty: string; hrefFor: (id: string) => string; action: string;
}) {
  return (
    <section className="card panel">
      <div className="head"><h2>{title}</h2><span className="caps">{rows.length}</span></div>
      {rows.length === 0 ? <div className="empty">{empty}</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table queue">
            <thead><tr><th>Vehicle</th><th className="hide-sm">RO</th><th className="hide-sm">Technician</th><th>Findings</th>{showMoney && <th style={{ textAlign: 'right' }}>Estimate</th>}<th /></tr></thead>
            <tbody>
              {rows.slice(0, 12).map((r) => (
                <tr key={r.id}>
                  <td><div className="v">{r.vehicle}</div><div className="c">{r.customer}</div></td>
                  <td className="mono small hide-sm">{r.ro || '—'}</td>
                  <td className="small hide-sm">{r.technician || '—'}</td>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      {r.immediate > 0 && <span className="chip immediate"><Icon name="immediate" size={14} />{r.immediate}</span>}
                      {r.monitor > 0 && <span className="chip monitor"><Icon name="monitor" size={14} />{r.monitor}</span>}
                      {!r.immediate && !r.monitor && <span className="small muted">{r.status === 'submitted' ? 'All OK' : '—'}</span>}
                    </span>
                  </td>
                  {showMoney && <td style={{ textAlign: 'right' }} className="mono small">{r.estimate ? money(r.estimate) : '—'}</td>}
                  <td style={{ textAlign: 'right' }}><a className="btn quiet sm" href={hrefFor(r.id)}>{action}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
