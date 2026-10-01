// A person's profile: how many inspections they've finished and how long an inspection takes them on average.
// Times come from the database (start = first change, end = first sent to the advisor). Inspections left open more
// than 8 hours are counted but left out of the average.
import { useEffect, useState } from 'react';
import { actions, isLive, toast, useStore, type TechStats } from '../state/store';
import { fmtDate } from './kit';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const ROLE: Record<string, string> = { owner: 'Owner', advisor: 'Service advisor', technician: 'Technician' };

/** "1 h 12 min", "18 min", "45 s". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function Profile({ userId }: { userId?: string }) {
  const me = useStore((s) => s.workspace?.me);
  const shop = useStore((s) => s.workspace?.shop?.id);
  const [stats, setStats] = useState<TechStats | null | undefined>(undefined);
  const who = userId ?? me?.userId;
  useEffect(() => {
    if (!isLive() || !shop || !who) return;
    setStats(undefined);
    actions.techStats(who).then((r) => setStats(r[0] ?? null)).catch((e) => { toast(errText(e), 'error'); setStats(null); });
  }, [shop, who]);

  if (!isLive()) return <div className="wide"><h1 className="display" style={{ fontSize: 36 }}>Profile</h1><p className="muted">Inspection counts and times appear here once the app is connected to its server.</p></div>;
  if (stats === undefined) return <div className="wide"><p className="muted" role="status">Loading…</p></div>;
  if (!stats) return <div className="wide"><h1 className="display" style={{ fontSize: 36 }}>Profile</h1><p className="muted">This person isn’t in this shop.</p></div>;
  const mine = who === me?.userId;
  return (
    <div className="wide stack" style={{ gap: 16, maxWidth: 860 }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>{stats.name || 'Profile'}{mine ? ' (you)' : ''}</h1>
        <div className="muted">{ROLE[stats.role] ?? stats.role}</div>
      </div>
      <div className="kpis profile-kpis">
        <div className="card pad"><b>{stats.inspections}</b><span>inspections completed</span></div>
        <div className="card pad"><b>{duration(stats.avgSeconds)}</b><span>average time per inspection</span></div>
        <div className="card pad"><b>{stats.last30}</b><span>in the last 30 days</span></div>
        <div className="card pad"><b>{stats.inProgress}</b><span>in progress now</span></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Time runs from the first change on an inspection to when it’s first sent to the advisor.
        {stats.inspections > stats.timed ? ` ${stats.inspections - stats.timed} ${stats.inspections - stats.timed === 1 ? 'inspection isn’t' : 'inspections aren’t'} in the average (left open over 8 hours, or finished before timing started).` : ''}
      </p>
      <section className="card">
        <h2 className="group-h">Recent inspections</h2>
        {stats.recent.length === 0 ? <div className="pad muted small">None finished yet.</div> : (
          <div className="list">
            {stats.recent.map((r) => (
              <a key={r.id} className="item" href={`#/advisor/${r.id}`}>
                <div className="grow"><div className="t">{r.vehicle || 'Vehicle'}</div><div className="d">{r.ro ? `RO ${r.ro} · ` : ''}{fmtDate(r.submittedAt.slice(0, 10))}</div></div>
                <span className="mono small">{r.seconds !== null && r.seconds <= 8 * 3600 ? duration(r.seconds) : '—'}</span>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Running clock on an inspection: time since it started, or the total once it was sent to the advisor. */
export function InspectionClock({ startedAt, firstSubmittedAt }: { startedAt?: string | null; firstSubmittedAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || firstSubmittedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [startedAt, firstSubmittedAt]);
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = firstSubmittedAt ? new Date(firstSubmittedAt).getTime() : now;
  const t = new Date(startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return <span className="small muted" role="timer">{firstSubmittedAt ? `Inspection time ${duration((end - start) / 1000)}` : `Started ${t} · ${duration((end - start) / 1000)}`}</span>;
}
