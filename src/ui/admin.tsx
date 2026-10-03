// Wrynch admin: the master panel for Wrynch staff. Pilot sign-ups (review, approve and email the sign-up link,
// decline, keep notes) and every shop on Wrynch. The database refuses all of it to anyone who isn't staff, so this
// screen only decides what to show.
import { useEffect, useState, type CSSProperties } from 'react';
import { actions, isLive, toast, useStore, type AdminShop, type PilotCounts, type PilotRequest } from '../state/store';
import { APP_DOMAIN, hostInfo } from '../state/remote';
import { go } from './hooks';
import { fmtDate, Icon } from './kit';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
type Filter = 'pending' | 'approved' | 'used' | 'declined' | 'all';
const FILTERS: [Filter, string][] = [['pending', 'To review'], ['approved', 'Approved'], ['used', 'Signed up'], ['declined', 'Declined'], ['all', 'All']];
const STATUS: Record<PilotRequest['status'], { label: string; style: CSSProperties }> = {
  pending: { label: 'To review', style: { background: 'var(--blue-tint)', color: 'var(--blue-text)' } },
  approved: { label: 'Approved · not signed up yet', style: { background: 'var(--mon-tint)', color: 'var(--mon)' } },
  used: { label: 'Signed up', style: { background: 'var(--ok-tint)', color: 'var(--ok)' } },
  declined: { label: 'Declined', style: { background: 'var(--na-tint)', color: 'var(--na)' } },
};
const when = (iso: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : '');

/** The sign-up link for an approved application (on the app's bare domain in production). */
export function signupLink(token: string): string {
  if (hostInfo().onAppDomain) return `${location.protocol}//${APP_DOMAIN}${location.port ? `:${location.port}` : ''}/#/pilot/${token}`;
  return `${location.origin}${location.pathname}#/pilot/${token}`;
}

export function Admin({ tab = 'pilots' }: { tab?: string }) {
  const training = useStore((s) => s.training);
  const staffFlag = useStore((s) => s.checksOff.admin);
  const [denied, setDenied] = useState<string | null>(null);
  // Known once the shop's staff check has loaded; the database refuses non-staff either way.
  const staff = !!training?.admin || staffFlag;
  if (!isLive()) {
    return (
      <div className="wide stack" style={{ gap: 16, maxWidth: 1040 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Wrynch admin</h1>
        <div className="card pad muted">The admin panel works when the app is connected to its server. It isn’t part of the demo.</div>
      </div>
    );
  }
  return (
    <div className="wide stack" style={{ gap: 18, maxWidth: 1100 }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Wrynch admin</h1>
        <div className="muted">Only Wrynch staff can open this page. Everything here covers every shop.</div>
      </div>
      {!staff && training === null ? <p className="muted" role="status">Loading…</p>
        : !staff || denied ? <div className="card pad" role="alert">{denied ?? 'You don’t have access to the admin panel. Ask Wrynch to add you as staff.'}</div> : (
        <>
          <div className="seg" role="group" aria-label="Admin sections" style={{ maxWidth: 520 }}>
            <button aria-pressed={tab !== 'shops'} onClick={() => go('/admin/pilots')}>Pilot sign-ups</button>
            <button aria-pressed={tab === 'shops'} onClick={() => go('/admin/shops')}>Shops</button>
            {training?.admin && <button aria-pressed={false} onClick={() => go('/training')}>Training data</button>}
          </div>
          {tab === 'shops' ? <Shops onDenied={setDenied} /> : <Pilots onDenied={setDenied} />}
        </>
      )}
    </div>
  );
}

const isDenied = (e: unknown) => /Wrynch staff|permission/i.test(errText(e));

function Pilots({ onDenied }: { onDenied: (m: string) => void }) {
  const [data, setData] = useState<{ requests: PilotRequest[]; counts: PilotCounts } | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  // Applications changed here stay in view until the list is refreshed, so approving one doesn't make it vanish.
  const [touched, setTouched] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const load = async () => {
    try { setData(await actions.adminPilots()); } catch (e) { if (isDenied(e)) onDenied('Only Wrynch staff can open this page.'); else toast(errText(e), 'error'); }
  };
  useEffect(() => { void load(); }, []);
  const replace = (r: PilotRequest) => { setTouched((t) => (t.includes(r.id) ? t : [...t, r.id])); setData((d) => {
    if (!d) return d;
    const requests = d.requests.map((x) => (x.id === r.id ? r : x));
    const n = (st: PilotRequest['status']) => requests.filter((x) => x.status === st).length;
    return { requests, counts: { pending: n('pending'), approved: n('approved'), used: n('used'), declined: n('declined'), total: requests.length } };
  }); };
  if (!data) return <p className="muted" role="status">Loading applications…</p>;
  const needle = q.trim().toLowerCase();
  const shown = data.requests.filter((r) => (filter === 'all' || r.status === filter || touched.includes(r.id))
    && (!needle || `${r.shopName} ${r.contactName} ${r.email} ${r.location ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(needle)));
  const c = data.counts;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpis">
        <Kpi n={c.pending} label="To review" sub="New applications" />
        <Kpi n={c.approved} label="Approved" sub="Link sent, not signed up yet" />
        <Kpi n={c.used} label="Signed up" sub="Shops created from a link" />
        <Kpi n={c.declined} label="Declined" sub={`${c.total} applications in all`} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="seg" role="group" aria-label="Which applications">
          {FILTERS.map(([k, label]) => {
            const n = k === 'all' ? c.total : c[k];
            return <button key={k} aria-pressed={filter === k} onClick={() => { setFilter(k); setTouched([]); }}>{label}{n ? ` (${n})` : ''}</button>;
          })}
        </div>
        <label className="sr" htmlFor="ap-q">Search applications</label>
        <input id="ap-q" className="input grow" style={{ minWidth: 220 }} placeholder="Shop, name, email, city" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn quiet sm" onClick={() => { setTouched([]); void load(); }}>Refresh</button>
      </div>
      {shown.length === 0 && <div className="card pad muted">{filter === 'pending' ? 'No applications waiting. New ones from the website show up here.' : 'Nothing here.'}</div>}
      {shown.map((r) => <PilotCard key={r.id} r={r} onChange={replace} />)}
    </div>
  );
}

function Kpi({ n, label, sub }: { n: number | string; label: string; sub: string }) {
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

function PilotCard({ r, onChange }: { r: PilotRequest; onChange: (r: PilotRequest) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(r.adminNote ?? '');
  const [confirmDecline, setConfirmDecline] = useState(false);
  const run = async (f: () => Promise<PilotRequest>, done?: string) => {
    setBusy(true);
    try { onChange(await f()); if (done) toast(done); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const approveAndEmail = async () => {
    setBusy(true);
    try {
      const out = await actions.adminApproveAndEmail(r.id);
      onChange({ ...out.request, linkEmailedAt: out.email.status === 'sent' ? new Date().toISOString() : out.request.linkEmailedAt });
      if (out.email.status === 'sent') toast(`Approved. Sign-up link emailed to ${r.email}.`);
      else {
        try { await navigator.clipboard.writeText(out.link); } catch { /* shown on the card to copy */ }
        toast(`Approved, but the email wasn’t sent (${out.email.detail || 'email isn’t set up'}). The sign-up link is copied; send it to ${r.email}.`, 'error');
      }
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const link = r.token ? signupLink(r.token) : null;
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); toast('Sign-up link copied'); } catch { toast('Couldn’t copy. Select the link and copy it.', 'error'); }
  };
  const facts: [string, string | null][] = [
    ['Location', r.location], ['Technicians', r.techs !== null && r.techs !== undefined ? String(r.techs) : null], ['Uses today', r.currentTool],
    ['Their template', r.templatePoints !== null ? `${r.templatePoints} point${r.templatePoints === 1 ? '' : 's'} uploaded` : null],
  ];
  return (
    <section className="card pad stack" style={{ gap: 12 }} aria-label={r.shopName}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{r.shopName}</h2>
          <div className="small muted">Applied {when(r.createdAt)}</div>
        </div>
        <span className="chip" style={STATUS[r.status].style}>{STATUS[r.status].label}</span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: '6px 16px' }}>
        <strong>{r.contactName}</strong>
        <a href={`mailto:${r.email}`}>{r.email}</a>
        {r.phone && <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}>{r.phone}</a>}
      </div>
      {facts.some(([, v]) => v) && (
        <dl className="grid small" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, margin: 0 }}>
          {facts.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="muted">{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>)}
        </dl>
      )}
      {r.notes && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap', background: 'var(--card2)', borderRadius: 10, padding: '10px 12px' }}>{r.notes}</p>}

      {r.status === 'used' && (
        <div className="small" style={{ color: 'var(--ok)', fontWeight: 600 }}>
          Signed up {when(r.usedAt)}{r.shop ? ` as ${r.shop.name} (#${r.shop.number})` : ''}.
        </div>
      )}
      {r.status === 'approved' && link && (
        <div className="stack" style={{ gap: 6 }}>
          <label className="small muted" htmlFor={`link-${r.id}`}>
            Sign-up link · works once · expires {when(r.linkExpiresAt)} · {r.linkEmailedAt ? `emailed ${when(r.linkEmailedAt)}` : 'not emailed yet'}
          </label>
          <div className="row" style={{ gap: 8 }}>
            <input id={`link-${r.id}`} className="input mono grow small" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn secondary sm" onClick={() => void copy()}>Copy</button>
          </div>
        </div>
      )}

      <div className="field">
        <label className="small muted" htmlFor={`note-${r.id}`}>Private note (only Wrynch staff see it)</label>
        <textarea id={`note-${r.id}`} className="input" rows={2} value={note} placeholder="Called them Tuesday; wants a demo with their service writer"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note.trim() !== (r.adminNote ?? '')) void run(() => actions.adminSetPilotNote(r.id, note), 'Note saved'); }} />
      </div>

      {r.status !== 'used' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {r.status !== 'approved' && <button className="btn primary sm" disabled={busy} onClick={() => void approveAndEmail()}><Icon name="send" size={16} />Approve and email link</button>}
          {r.status === 'approved' && <button className="btn primary sm" disabled={busy} onClick={() => void approveAndEmail()}><Icon name="send" size={16} />{r.linkEmailedAt ? 'Email the link again' : 'Email the link'}</button>}
          {r.status !== 'approved' && <button className="btn quiet sm" disabled={busy} onClick={() => void run(() => actions.adminSetPilotStatus(r.id, 'approved'), 'Approved. Copy the link to send it yourself.')}>Approve without emailing</button>}
          {r.status !== 'pending' && <button className="btn quiet sm" disabled={busy} onClick={() => void run(() => actions.adminSetPilotStatus(r.id, 'pending'), 'Moved back to review')}>Back to review</button>}
          {r.status !== 'declined' && (
            <button className="btn quiet sm" style={{ color: 'var(--imm)' }} disabled={busy} onClick={() => {
              if (!confirmDecline) { setConfirmDecline(true); setTimeout(() => setConfirmDecline(false), 4000); return; }
              void run(() => actions.adminSetPilotStatus(r.id, 'declined'), r.status === 'approved' ? 'Declined. Their sign-up link no longer works.' : 'Declined');
            }}>{confirmDecline ? 'Tap again to decline' : 'Decline'}</button>
          )}
        </div>
      )}
    </section>
  );
}

function Shops({ onDenied }: { onDenied: (m: string) => void }) {
  const [shops, setShops] = useState<AdminShop[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    actions.adminShops().then(setShops).catch((e) => { if (isDenied(e)) onDenied('Only Wrynch staff can open this page.'); else toast(errText(e), 'error'); });
  }, []);
  if (!shops) return <p className="muted" role="status">Loading shops…</p>;
  const needle = q.trim().toLowerCase();
  const shown = shops.filter((s) => !needle || `${s.name} ${s.number} ${s.owner ?? ''}`.toLowerCase().includes(needle));
  const active = shops.filter((s) => s.last30 > 0).length;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpis">
        <Kpi n={shops.length} label="Shops" sub="On Wrynch" />
        <Kpi n={active} label="Active" sub="An inspection in the last 30 days" />
        <Kpi n={shops.reduce((a, s) => a + s.last30, 0)} label="Inspections" sub="Last 30 days, every shop" />
        <Kpi n={shops.reduce((a, s) => a + s.members, 0)} label="People" sub="Owners, advisors and techs" />
      </div>
      <label className="sr" htmlFor="as-q">Search shops</label>
      <input id="as-q" className="input" style={{ maxWidth: 360 }} placeholder="Shop, number or owner" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Shop</th><th>Owner</th><th>People</th><th>Inspections (30 days)</th><th>All inspections</th><th>Reports sent</th><th>Last inspection</th><th>Joined</th></tr></thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong> <span className="mono small muted">#{s.number}</span></td>
                <td>{s.owner ?? '—'}</td><td>{s.members}</td><td>{s.last30}</td><td>{s.inspections}</td><td>{s.sent}</td>
                <td>{s.lastActivity ? when(s.lastActivity) : '—'}</td><td>{when(s.createdAt)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={8} className="muted">No shops match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
