import { useEffect, useState } from 'react';
import { TekmetricExportButton } from './tekmetric';
import {
  allPoints, cls, compLabel, defaultThreshold, findingLabel, ONTOLOGY, pointComponents, setTemplate, vehicleComponents, type Threshold,
} from '../domain/ontology';
import { completionGate, componentState, countsFinding, linkConfirmed, mediaConfirmed, summarize } from '../domain/rating';
import type { CompKey, EstimateLine, Inspection, Op, Rating, Template, Vehicle } from '../domain/types';
import { actions, isLive, jobList, photoSrc, toast, useStore } from '../state/store';
import { fn } from '../state/remote';
import { CUSTOMER_LABEL, fmtDate, fmtMi, Icon, Sheet, StateChip, Tile } from './kit';
import { enc, useInspection, useVehicleHistory } from './hooks';
import { Missing, REASON_LABEL } from './tech';

const vname = (v: Vehicle) => `${v.year || ''} ${v.make} ${v.model} ${v.trim}`.trim();
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const unitText = (checkKey: string, value: number) => {
  const u = ONTOLOGY.checks[checkKey].unit;
  return u === '/32 in' ? `${value}/32 in` : `${value} ${u ?? ''}`.trim();
};

/** Short description of what was recorded on a component: values and counted findings. */
export function describe(insp: Inspection, key: CompKey): string {
  const vals = insp.results.filter((r) => r.compKey === key && r.value !== null).map((r) => `${ONTOLOGY.checks[r.checkKey].name}: ${unitText(r.checkKey, r.value!)}`);
  const fs = insp.findings.filter((f) => f.compKey === key && countsFinding(f)).map((f) => `${findingLabel(f.key)} (${f.severity})`);
  const picked = insp.results.filter((r) => r.compKey === key && r.value === null && r.rating !== 'ok').map((r) => ONTOLOGY.checks[r.checkKey].name);
  const dtc = insp.dtcs.filter((d) => d.compKey === key).map((d) => d.code);
  return [...vals, ...fs, ...picked, ...dtc].join(' · ') || 'No findings';
}

/** Customer-facing detail: measurements and finding names only (no codes, severities or check jargon). */
export function plain(insp: Inspection, key: CompKey): string {
  const vals = insp.results.filter((r) => r.compKey === key && r.value !== null).map((r) => {
    const c = ONTOLOGY.checks[r.checkKey];
    return c.unit === '/32 in' ? `${r.value}/32 in tread` : `${c.name.replace(/\s*\(.*\)$/, '').toLowerCase()} ${r.value} ${c.unit ?? ''}`.trim();
  });
  const fs = insp.findings.filter((f) => f.compKey === key && countsFinding(f)).map((f) => findingLabel(f.key).toLowerCase());
  return [...vals, ...fs].join(', ');
}

function previous(all: Inspection[], insp: Inspection): Inspection | undefined {
  return all.filter((i) => i.vehicleId === insp.vehicleId && i.date < insp.date && i.status !== 'not_started').sort((a, b) => b.date.localeCompare(a.date))[0];
}

function lastVisitText(prev: Inspection | undefined, key: CompKey): string {
  if (!prev) return '—';
  const st = componentState(prev, key);
  const v = prev.results.find((r) => r.compKey === key && r.value !== null);
  const label = st === 'ok' ? 'OK' : st === 'monitor' ? 'Monitor' : st === 'immediate' ? 'Immediate' : '—';
  return v ? `${unitText(v.checkKey, v.value!)} · ${label}` : label;
}

// ------------------------------------------------------------------ list
const STATUS = { not_started: 'Not started', in_progress: 'Tech working', submitted: 'Ready to send', sent: 'Sent' } as const;
export function AdvisorList() {
  const s = useStore((x) => x);
  const [q, setQ] = useState('');
  const list = jobList(s).filter((j) => j.status !== 'not_started')
    .filter((j) => !q || `${j.ro} ${vname(j.vehicle)} ${j.vehicle.customer} ${j.vehicle.vin}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || a.ro.localeCompare(b.ro));
  return (
    <div className="wide stack" style={{ gap: 18 }}>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Inspections</h1>
        <div className="row">
          <label className="sr" htmlFor="q">Search</label>
          <input id="q" className="input" style={{ width: 260, maxWidth: '60vw' }} placeholder="RO, vehicle, customer or VIN" value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="btn primary sm" href="#/new"><Icon name="plus" />New</a>
        </div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Date</th><th>RO</th><th>Vehicle</th><th>Customer</th><th>Status</th><th>Immediate</th><th>Monitor</th><th /></tr></thead>
          <tbody>
            {list.map((j) => (
              <tr key={j.id}>
                <td>{fmtDate(j.date)}</td><td className="mono">{j.ro}</td><td>{vname(j.vehicle)}</td><td>{j.vehicle.customer}</td>
                <td>{STATUS[j.status]}{j.pendingAi > 0 && j.status === 'in_progress' ? ` · ${j.pendingAi} AI to review` : ''}</td>
                <td>{j.summary?.immediate ?? '—'}</td><td>{j.summary?.monitor ?? '—'}</td>
                <td><a href={`#/advisor/${j.id}`} style={{ fontWeight: 700 }}>Open</a></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={8} className="muted">No inspections in the last two weeks.</td></tr>}
          </tbody>
        </table>
      </div>
      {s.mode === 'live' && <p className="small muted">Showing the last 14 days and anything still open. Older visits are in each vehicle's history.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ results
export function AdvisorResults({ id }: { id: string }) {
  const data = useInspection(id);
  const all = useStore((x) => x.inspections);
  const role = useStore((x) => x.workspace?.role ?? 'owner');
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<Partial<EstimateLine> | null>(null);
  useVehicleHistory(data?.vehicle.id ?? '');
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const sum = summarize(insp, vehicle);
  const prev = previous(all, insp);
  const { applies } = vehicleComponents(vehicle.config, insp.extraComponents);
  const by = (r: Rating) => applies.filter((k) => componentState(insp, k) === r);
  const notChecked = applies.filter((k) => ['not_inspected', 'unable_to_assess'].includes(componentState(insp, k)));
  const gate = completionGate(insp, vehicle);
  const approvedWords = insp.notes.filter((n) => n.customerText && n.status !== 'ai_suggested').length;
  const canAdvise = role === 'owner' || role === 'advisor';
  const lineFor = (k: CompKey) => insp.estimate.filter((e) => e.compKey === k);
  const total = insp.estimate.reduce((a, e) => a + Number(e.parts) + Number(e.labor), 0);
  const approvedTotal = insp.estimate.filter((e) => e.compKey && insp.customerApprovals.includes(e.compKey)).reduce((a, e) => a + Number(e.parts) + Number(e.labor), 0);
  const estimateOpen = canAdvise && insp.status !== 'not_started';
  return (
    <div className="wide" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 24, alignItems: 'start' }}>
      <aside className="stack" style={{ gap: 16, maxWidth: 380 }}>
        <div className="card pad stack">
          <span className="mono small muted">{insp.ro ? `RO ${insp.ro}` : fmtDate(insp.date)}</span>
          <strong style={{ fontSize: 22, lineHeight: 1.2 }}>{vname(vehicle)}</strong>
          <span className="mono small">{vehicle.vin}</span>
          <span className="small" style={{ color: 'var(--text2)' }}>{[fmtMi(insp.odometer), vehicle.engine].filter(Boolean).join(' · ')}</span>
          <div className="row between small"><span className="muted">Customer</span><strong>{vehicle.customer || '—'}</strong></div>
          {vehicle.customerPhone && <div className="row between small"><span className="muted">Phone</span><span>{vehicle.customerPhone}</span></div>}
          {vehicle.customerEmail && <div className="row between small"><span className="muted">Email</span><span>{vehicle.customerEmail}</span></div>}
          <div className="row between small"><span className="muted">Technician</span><strong>{insp.technician || '—'}</strong></div>
          <a href={`#/vehicle/${vehicle.id}`} style={{ fontWeight: 700 }}>Part history for this vehicle</a>
        </div>
        {(insp.concerns.length > 0 || insp.dtcs.length > 0) && (
          <div className="card pad stack">
            <h2 className="h2" style={{ fontSize: 15 }}>Concerns and codes</h2>
            {insp.concerns.map((c) => <span key={c}>{c}</span>)}
            {insp.dtcs.map((d) => (
              <div key={d.code} className="small"><span className="mono" style={{ fontWeight: 600 }}>{d.code}</span> → {d.compKey ? compLabel(d.compKey) : 'not linked'}<div className="muted">{d.description}</div></div>
            ))}
          </div>
        )}
        <div className="card pad stack">
          <h2 className="h2" style={{ fontSize: 15 }}>Before it goes out</h2>
          <Check ok={gate.filter((g) => g.kind === 'ai_finding').length === 0} text="Every AI finding confirmed by the tech" />
          <Check ok={gate.filter((g) => g.kind === 'photo').length === 0} text={`Only confirmed photos (${insp.media.filter(mediaConfirmed).length})`} />
          <Check ok={gate.filter((g) => g.kind === 'wording').length === 0} text={`Customer wording approved (${approvedWords})`} />
          <Check ok={gate.filter((g) => g.kind === 'required').length === 0} text="Every required part rated or explained" />
        </div>
        {insp.estimate.length > 0 && (
          <div className="card pad stack">
            <h2 className="h2" style={{ fontSize: 15 }}>Estimate</h2>
            <div className="row between"><span className="muted">Recommended</span><strong>{money(total)}</strong></div>
            <div className="row between"><span className="muted">Approved by customer</span><strong style={{ color: 'var(--ok)' }}>{money(approvedTotal)}</strong></div>
          </div>
        )}
      </aside>
      <main className="stack" style={{ gap: 18, minWidth: 0, gridColumn: 'span 2' }}>
        <div className="row between" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Inspection results</h1>
            <div className="muted">{fmtDate(insp.date)} · {ONTOLOGY.template.name} · {sum.total - sum.notChecked - sum.unrated} of {sum.total} parts checked</div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {insp.status === 'in_progress' && <span className="chip na">Tech still working</span>}
            {(insp.status === 'submitted' || insp.status === 'sent') && <a className="btn secondary sm" href={isLive() ? `#/r/${insp.reportToken}` : `#/report/${id}`}>Preview customer report</a>}
            {canAdvise && insp.status === 'submitted' && <button className="btn quiet sm" onClick={() => actions.reopen(id)}>Reopen for the tech</button>}
            {canAdvise && <TekmetricExportButton inspId={id} status={insp.status} />}
            {canAdvise && (insp.status === 'submitted' || insp.status === 'sent') && <button className="btn primary sm" onClick={() => setSending(true)}>{insp.status === 'sent' ? 'Send again' : 'Send to customer'}</button>}
            {insp.status === 'sent' && <span className="chip ok"><Icon name="check" size={14} />Sent</span>}
          </div>
        </div>
        {insp.status === 'in_progress' && <div className="card pad small">The technician hasn't finished. These results aren't final and can't be sent yet.</div>}
        <div className="tiles">
          <Tile kind="immediate" n={sum.immediate} label="Immediate attention" />
          <Tile kind="monitor" n={sum.monitor} label="Monitor" />
          <Tile kind="ok" n={sum.ok} label="OK" />
          <Tile kind="na" n={sum.notChecked + sum.unrated} label="Not checked" />
        </div>
        {(['immediate', 'monitor'] as Rating[]).map((r) => {
          const keys = by(r);
          if (!keys.length) return null;
          return (
            <section key={r} className="card" style={{ overflowX: 'auto' }}>
              <h2 className="group-h" style={{ color: r === 'immediate' ? 'var(--imm)' : 'var(--mon)' }}>{r === 'immediate' ? 'Immediate attention' : 'Monitor'} · {keys.length}</h2>
              <table className="table">
                <thead><tr><th>Part</th><th>Finding / measurement</th><th>Last visit</th><th>Photos</th><th>Estimate</th><th>Customer</th></tr></thead>
                <tbody>
                  {keys.map((k) => {
                    const lines = lineFor(k);
                    return (
                      <tr key={k}>
                        <td><a href={`#/history/${vehicle.id}/${enc(k)}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{compLabel(k)}</a></td>
                        <td>{describe(insp, k)}</td>
                        <td className="muted">{lastVisitText(prev, k)}</td>
                        <td>{insp.media.filter((m) => !m.excluded && linkConfirmed(m, k)).length}</td>
                        <td>
                          {lines.map((l) => (
                            <button key={l.id} className="linkbtn" style={{ display: 'block', padding: 0, minHeight: 28, textAlign: 'left' }} disabled={!estimateOpen}
                              onClick={() => setEditing(l)}>{money(Number(l.parts) + Number(l.labor))}</button>
                          ))}
                          {estimateOpen && lines.length === 0 && <button className="linkbtn" style={{ padding: 0 }} onClick={() => setEditing({ compKey: k, description: `Replace ${compLabel(k).toLowerCase()}`, parts: 0, labor: 0 })}>+ Price</button>}
                        </td>
                        <td>{insp.customerApprovals.includes(k) ? <span className="chip ok">Approved</span> : <span className="muted small">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
        {estimateOpen && (
          <section className="card pad stack">
            <div className="row between"><h2 className="h2">Other estimate lines</h2><button className="linkbtn" onClick={() => setEditing({ compKey: null, description: '', parts: 0, labor: 0 })}>+ Add line</button></div>
            {insp.estimate.filter((e) => !e.compKey).map((l) => (
              <button key={l.id} className="item card" onClick={() => setEditing(l)}><span className="grow t">{l.description}</span><strong>{money(Number(l.parts) + Number(l.labor))}</strong></button>
            ))}
            {insp.estimate.filter((e) => !e.compKey).length === 0 && <span className="small muted">Diagnosis, shop supplies or anything not tied to one part.</span>}
          </section>
        )}
        {notChecked.length > 0 && (
          <section className="card">
            <h2 className="group-h">Not checked · {notChecked.length}</h2>
            <div className="list">
              {notChecked.map((k) => {
                const s = insp.statuses.find((x) => x.compKey === k)?.notInspected;
                return <div key={k} className="item"><div className="grow"><div className="t">{compLabel(k)}</div><div className="d">{s ? REASON_LABEL[s.reason] : ''}</div></div><StateChip state={componentState(insp, k)} /></div>;
              })}
            </div>
          </section>
        )}
      </main>
      {sending && <SendSheet insp={insp} vehicle={vehicle} onClose={() => setSending(false)} />}
      {editing && <EstimateSheet inspId={id} line={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return <div className="row small" style={{ color: ok ? 'var(--ok)' : 'var(--imm)' }}><Icon name={ok ? 'check' : 'na'} size={16} stroke={2.6} /><span style={{ color: 'var(--ink)' }}>{text}</span></div>;
}

function EstimateSheet({ inspId, line, onClose }: { inspId: string; line: Partial<EstimateLine>; onClose: () => void }) {
  const [desc, setDesc] = useState(line.description ?? '');
  const [parts, setParts] = useState(String(line.parts ?? 0));
  const [labor, setLabor] = useState(String(line.labor ?? 0));
  const num = (s: string) => Math.max(0, Math.round((parseFloat(s) || 0) * 100) / 100);
  return (
    <Sheet title={line.compKey ? `Price · ${compLabel(line.compKey, true)}` : 'Estimate line'} onClose={onClose}>
      <div className="field"><label htmlFor="ed">Work</label><input id="ed" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
      <div className="row">
        <div className="field grow"><label htmlFor="ep">Parts ($)</label><input id="ep" className="input mono" inputMode="decimal" value={parts} onChange={(e) => setParts(e.target.value)} /></div>
        <div className="field grow"><label htmlFor="el">Labor ($)</label><input id="el" className="input mono" inputMode="decimal" value={labor} onChange={(e) => setLabor(e.target.value)} /></div>
      </div>
      <div className="row between"><span className="muted">Total</span><strong>{money(num(parts) + num(labor))}</strong></div>
      <div className="row">
        {line.id && <button className="btn danger" onClick={() => { actions.deleteEstimateLine(inspId, line.id!); onClose(); }}>Delete</button>}
        <button className="btn primary grow" disabled={!desc.trim()} onClick={() => {
          actions.saveEstimateLine(inspId, { id: line.id, compKey: line.compKey ?? null, description: desc.trim(), parts: num(parts), labor: num(labor) });
          onClose();
        }}>Save</button>
      </div>
    </Sheet>
  );
}

function SendSheet({ insp, vehicle, onClose }: { insp: Inspection; vehicle: Vehicle; onClose: () => void }) {
  const [channel, setChannel] = useState<'sms' | 'email' | 'link'>(vehicle.customerPhone ? 'sms' : vehicle.customerEmail ? 'email' : 'link');
  const [to, setTo] = useState(vehicle.customerPhone ?? '');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTo(channel === 'sms' ? vehicle.customerPhone ?? '' : channel === 'email' ? vehicle.customerEmail ?? '' : ''); }, [channel]);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast('Select the link and copy it'); }
  };
  return (
    <Sheet title="Send to customer" onClose={onClose}>
      <div className="seg" role="group" aria-label="How">
        <button aria-pressed={channel === 'sms'} onClick={() => setChannel('sms')}>Text</button>
        <button aria-pressed={channel === 'email'} onClick={() => setChannel('email')}>Email</button>
        <button aria-pressed={channel === 'link'} onClick={() => setChannel('link')}>Copy link</button>
      </div>
      {channel !== 'link' && (
        <div className="field">
          <label htmlFor="to">{channel === 'sms' ? 'Mobile number' : 'Email address'}</label>
          <input id="to" className="input" inputMode={channel === 'sms' ? 'tel' : 'email'} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>The customer sees only what the technician confirmed, with photos, in plain words, and can approve work from the page.</p>
      {link && (
        <div className="card pad stack">
          <span className="small muted">Customer link</span>
          <input className="input mono small" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Customer link" />
          <button className="btn secondary sm" onClick={() => copy(link)}>Copy link</button>
        </div>
      )}
      <button className="btn primary" disabled={busy || (channel !== 'link' && !to.trim())} onClick={async () => {
        setBusy(true);
        const l = await actions.sendToCustomer(insp.id, channel, to.trim() || undefined);
        setBusy(false);
        if (l) setLink(l.startsWith('#') ? `${window.location.origin}${window.location.pathname}${l}` : l);
      }}>{busy ? 'Sending…' : channel === 'link' ? 'Create link' : channel === 'sms' ? 'Send text' : 'Send email'}</button>
    </Sheet>
  );
}

// ------------------------------------------------------------------ vehicle history grid
export function VehicleHistory({ vehicleId }: { vehicleId: string }) {
  const s = useStore((x) => x);
  useVehicleHistory(vehicleId);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  if (!v) return <Missing />;
  const visits = s.inspections.filter((i) => i.vehicleId === vehicleId && i.status !== 'not_started').sort((a, b) => a.date.localeCompare(b.date));
  const { applies } = vehicleComponents(v.config, visits.flatMap((i) => i.extraComponents));
  const interesting = applies.filter((k) => visits.some((i) => {
    const st = componentState(i, k);
    return st === 'monitor' || st === 'immediate' || i.results.some((r) => r.compKey === k && r.value !== null);
  }));
  const cell = (i: Inspection, k: CompKey) => {
    const st = componentState(i, k);
    const val = i.results.find((r) => r.compKey === k && r.value !== null);
    const f = i.findings.find((x) => x.compKey === k && countsFinding(x));
    const text = val ? unitText(val.checkKey, val.value!) : f ? findingLabel(f.key) : st === 'ok' ? 'OK' : st === 'unrated' ? '—' : st.replace(/_/g, ' ');
    const kls = st === 'ok' || st === 'monitor' || st === 'immediate' ? st : 'na';
    const mark = st === 'monitor' ? '▲ ' : st === 'immediate' ? '■ ' : '';
    return <span className={`chip ${kls}`} style={{ borderRadius: 8 }}>{mark}{text}</span>;
  };
  return (
    <div className="wide stack" style={{ gap: 16 }}>
      <div>
        <h1 className="display" style={{ margin: 0, fontSize: 36 }}>{vname(v)}</h1>
        <div className="muted">{v.customer} · {visits.length} inspections · {applies.length} parts tracked · showing parts with a measurement or a finding</div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Part</th>{visits.map((i) => <th key={i.id}>{fmtDate(i.date)}<div style={{ fontWeight: 500, textTransform: 'none' }}>{fmtMi(i.odometer)}</div></th>)}</tr></thead>
          <tbody>
            {interesting.map((k) => (
              <tr key={k}>
                <td><a href={`#/history/${v.id}/${enc(k)}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{compLabel(k)}</a></td>
                {visits.map((i) => <td key={i.id}>{cell(i, k)}</td>)}
              </tr>
            ))}
            {interesting.length === 0 && <tr><td colSpan={visits.length + 1} className="muted">Nothing measured or flagged yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="small muted">▲ Monitor · ■ Immediate attention. Each row is one part at one position, compared with itself across visits.</p>
    </div>
  );
}

// ------------------------------------------------------------------ rating rules (owner edits)
const OPS: Op[] = ['<', '<=', '>', '>='];
export function Rules() {
  const s = useStore((x) => x);
  const canEdit = s.mode === 'demo' || s.workspace?.role === 'owner';
  const checks = Object.values(ONTOLOGY.checks).filter((c) => defaultThreshold(c.key));
  const [draft, setDraft] = useState<Record<string, Threshold>>({});
  const [saving, setSaving] = useState(false);
  const current = (key: string): Threshold => draft[key] ?? { checkKey: key, ok: ONTOLOGY.checks[key].auto!.ok, immediate: ONTOLOGY.checks[key].auto!.immediate };
  const changed = Object.keys(draft).length > 0;
  const setPart = (key: string, which: 'ok' | 'immediate', idx: 0 | 1, val: string) => {
    const t = structuredClone(current(key));
    const pair = (t[which] ?? ['<', 0]) as [Op, number];
    if (idx === 0) pair[0] = val as Op; else pair[1] = Number(val);
    t[which] = pair;
    setDraft({ ...draft, [key]: t });
  };
  const save = async () => {
    setSaving(true);
    try {
      // Save every rule that differs from the catalog default.
      const list = checks.map((c) => current(c.key)).filter((t) => {
        const d = defaultThreshold(t.checkKey)!;
        return JSON.stringify([t.ok, t.immediate]) !== JSON.stringify([d.ok, d.immediate]);
      });
      await actions.saveThresholds(list);
      setDraft({});
    } catch (e) { toast(e instanceof Error ? e.message : 'Couldn’t save', 'error'); } finally { setSaving(false); }
  };
  return (
    <div className="wide stack" style={{ gap: 16 }}>
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Rating rules</h1>
          <div className="muted">{s.workspace?.rules ? `Version ${s.workspace.rules.number}. ` : ''}Changes apply to new inspections; past results keep the rules they were rated with.</div>
        </div>
        {canEdit && <button className="btn primary sm" disabled={!changed || saving} onClick={save}>{saving ? 'Saving…' : 'Save as new version'}</button>}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="card pad" style={{ borderTop: '5px solid var(--imm-bar)' }}><strong style={{ color: 'var(--imm)' }}>Immediate attention</strong><p className="small" style={{ margin: '6px 0 0' }}>Needs replacing now: the part no longer meets the minimum legal or manufacturer standard.</p></div>
        <div className="card pad" style={{ borderTop: '5px solid var(--mon-bar)' }}><strong style={{ color: 'var(--mon)' }}>Monitor</strong><p className="small" style={{ margin: '6px 0 0' }}>Worn, degraded or due, but still meets the minimum.</p></div>
        <div className="card pad" style={{ borderTop: '5px solid var(--ok-bar)' }}><strong style={{ color: 'var(--ok)' }}>OK</strong><p className="small" style={{ margin: '6px 0 0' }}>No action needed.</p></div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Part</th><th>Check</th><th>Unit</th><th>OK when value is</th><th>Immediate when value is</th><th>Basis</th></tr></thead>
          <tbody>
            {checks.map((c) => {
              const t = current(c.key);
              const d = defaultThreshold(c.key)!;
              const diff = JSON.stringify([t.ok, t.immediate]) !== JSON.stringify([d.ok, d.immediate]);
              return (
                <tr key={c.key} className={draft[c.key] ? 'sel' : undefined}>
                  <td>{cls(c.classId).label}</td><td>{c.name}{diff && <div className="small" style={{ color: 'var(--blue-text)' }}>Changed from default</div>}</td><td>{c.unit}</td>
                  <td><Pair t={t.ok} edit={canEdit} label={`${c.name} OK`} onOp={(v) => setPart(c.key, 'ok', 0, v)} onVal={(v) => setPart(c.key, 'ok', 1, v)} /></td>
                  <td>{t.immediate ? <Pair t={t.immediate} edit={canEdit} label={`${c.name} immediate`} onOp={(v) => setPart(c.key, 'immediate', 0, v)} onVal={(v) => setPart(c.key, 'immediate', 1, v)} /> : <span className="muted small">Technician decides</span>}</td>
                  <td className="small muted">{c.basis}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">Between OK and Immediate is Monitor. {Object.keys(ONTOLOGY.checks).length} checks in all; the rest are rated by the technician against written descriptions. Ontology v{ONTOLOGY.version}.</p>
    </div>
  );
}

function Pair({ t, edit, label, onOp, onVal }: { t: [Op, number]; edit: boolean; label: string; onOp: (v: string) => void; onVal: (v: string) => void }) {
  if (!edit) return <span className="mono">{t[0]} {t[1]}</span>;
  return (
    <span className="row" style={{ gap: 4 }}>
      <select className="input mono" aria-label={`${label} comparison`} style={{ width: 64, height: 36, padding: '0 4px' }} value={t[0]} onChange={(e) => onOp(e.target.value)}>
        {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <input className="input mono" aria-label={`${label} value`} style={{ width: 80, height: 36 }} inputMode="decimal" defaultValue={t[1]} onBlur={(e) => onVal(e.target.value)} />
    </span>
  );
}

// ------------------------------------------------------------------ customer report
interface ReportProps {
  insp: Inspection; vehicle: Vehicle; shopName: string; shopPhone: string | null;
  approved: CompKey[]; onToggle: ((k: CompKey, on: boolean) => void) | null;
}

/** Demo: the customer view of a local inspection. */
export function DemoReport({ id }: { id: string }) {
  const data = useInspection(id);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  if (insp.status !== 'submitted' && insp.status !== 'sent') return <NotReady />;
  return <Report insp={insp} vehicle={vehicle} shopName="[Shop name]" shopPhone={null} approved={insp.customerApprovals}
    onToggle={(k) => actions.toggleApproval(id, k)} />;
}

type ReportDoc = { inspection: Inspection; vehicle: Vehicle; template: Template; shop: { name: string; phone: string | null } };

/** Live: what the customer opens from their text/email. No sign-in; the link's token is the key. */
export function LiveReport({ token }: { token: string }) {
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [approved, setApproved] = useState<CompKey[]>([]);
  useEffect(() => {
    fn<ReportDoc>(`report?token=${encodeURIComponent(token)}`, undefined, 'GET', false)
      .then((d) => { d.inspection.estimate ??= []; d.inspection.observations ??= []; d.inspection.media = (d.inspection.media ?? []).map((m) => ({ ...m, links: m.links ?? [] })); setTemplate(d.template); setDoc(d); setApproved(d.inspection.customerApprovals); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'This report link isn’t valid'));
  }, [token]);
  if (err) return <div className="phone"><div className="body"><div className="card pad stack"><strong>Report unavailable</strong><span className="muted">{err}</span></div></div></div>;
  if (!doc) return <div className="phone"><div className="body"><p className="muted" role="status">Loading your report…</p></div></div>;
  const canApprove = doc.inspection.status === 'sent';
  return <Report insp={doc.inspection} vehicle={doc.vehicle} shopName={doc.shop.name} shopPhone={doc.shop.phone} approved={approved}
    onToggle={canApprove ? async (k, on) => {
      setApproved((a) => (on ? [...a, k] : a.filter((x) => x !== k)));
      try { await fn('report', { token, key: k, approved: on }, 'POST', false); } catch (e) {
        setApproved((a) => (on ? a.filter((x) => x !== k) : [...a, k]));
        toast(e instanceof Error ? e.message : 'Couldn’t save your choice', 'error');
      }
    } : null} />;
}

function NotReady() {
  return <div className="phone"><div className="body"><div className="card pad stack"><strong>Report not ready</strong><span className="small muted">The technician hasn't finished this inspection. Nothing unconfirmed is ever shown to the customer.</span></div></div></div>;
}

function Report({ insp, vehicle, shopName, shopPhone, approved, onToggle }: ReportProps) {
  const sum = summarize(insp, vehicle);
  const { applies } = vehicleComponents(vehicle.config, insp.extraComponents);
  const flagged = (r: Rating) => applies.filter((k) => componentState(insp, k) === r);
  // Prefer the point where the part is required (the battery belongs to "Battery", not "Engine cranking").
  const pointOf = (k: CompKey) =>
    allPoints().find((p) => pointComponents(p, vehicle.config).some((c) => c.key === k && c.required))
    ?? allPoints().find((p) => pointComponents(p, vehicle.config).some((c) => c.key === k && c.applies));
  const notChecked = applies.filter((k) => ['not_inspected', 'unable_to_assess'].includes(componentState(insp, k)));
  const priceOf = (keys: CompKey[]) => insp.estimate.filter((e) => e.compKey && keys.includes(e.compKey)).reduce((a, e) => a + Number(e.parts) + Number(e.labor), 0);
  const groups = (r: Rating) => {
    const m = new Map<string, CompKey[]>();
    for (const k of flagged(r)) { const p = pointOf(k); const gid = p?.id ?? k; m.set(gid, [...(m.get(gid) ?? []), k]); }
    return [...m.entries()].map(([gid, keys]) => {
      const p = allPoints().find((x) => x.id === gid);
      const note = p ? insp.notes.find((x) => x.pointId === p.id && x.customerText && x.status !== 'ai_suggested')?.customerText ?? null : null;
      return { gid, title: p ? p.name : compLabel(keys[0]), keys, note };
    });
  };
  const approvedTotal = priceOf(approved);
  const Group = ({ g, strong }: { g: ReturnType<typeof groups>[number]; strong?: boolean }) => {
    const photos = insp.media.filter((m) => !m.excluded && m.customerVisible && g.keys.some((k) => linkConfirmed(m, k)));
    const isOn = g.keys.every((k) => approved.includes(k));
    const price = priceOf(g.keys);
    return (
      <div className="card pad stack" style={strong ? { border: '2px solid var(--imm-bar)' } : undefined}>
        <div className="row between" style={{ alignItems: 'flex-start' }}><strong style={{ fontSize: 17 }}>{g.title}</strong><StateChip state={strong ? 'immediate' : 'monitor'} customer /></div>
        {photos.length > 0 && <div className="thumbs">{photos.slice(0, 3).map((m) => <img key={m.id} src={photoSrc(m.url) || m.url} alt={`Photo of ${m.links.filter((l) => g.keys.includes(l.compKey)).map((l) => compLabel(l.compKey)).join(', ') || 'part'}`} className="ph" />)}</div>}
        {g.note && <p style={{ margin: 0, lineHeight: 1.45 }}>{g.note}</p>}
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text2)', lineHeight: 1.5 }}>
          {g.keys.map((k) => <li key={k}><strong>{compLabel(k)}</strong>{plain(insp, k) ? `: ${plain(insp, k)}` : ''}</li>)}
        </ul>
        {price > 0 && <div className="row between"><span className="muted">Estimate</span><strong>{money(price)}</strong></div>}
        {onToggle && (
          <label className="row" style={{ fontWeight: 600, minHeight: 44 }}>
            <input type="checkbox" checked={isOn} onChange={() => g.keys.forEach((k) => { if (approved.includes(k) === isOn) onToggle(k, !isOn); })} style={{ width: 22, height: 22 }} />
            {strong ? 'Approve this repair' : 'Add to today’s visit'}
          </label>
        )}
      </div>
    );
  };
  return (
    <div className="phone">
      <div className="topbar" style={{ top: 0 }}><span style={{ width: 12 }} /><div className="grow"><h1>{shopName}</h1><div className="sub">Vehicle inspection report</div></div></div>
      <div className="body">
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: 32 }}>Your {vname(vehicle)}</h1>
          <div className="small muted">{fmtDate(insp.date)} · {fmtMi(insp.odometer)}{insp.technician ? ` · inspected by ${insp.technician}` : ''}</div>
          <p style={{ margin: '10px 0 0', lineHeight: 1.45 }}>We checked {sum.total - sum.notChecked - sum.unrated} parts. Every finding here was confirmed by your technician.</p>
        </div>
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <Tile kind="immediate" n={sum.immediate} label={CUSTOMER_LABEL.immediate} />
          <Tile kind="monitor" n={sum.monitor} label={CUSTOMER_LABEL.monitor} />
          <Tile kind="ok" n={sum.ok} label={CUSTOMER_LABEL.ok} />
        </div>
        <div className="card pad small stack" style={{ gap: 4 }}>
          <span><strong style={{ color: 'var(--imm)' }}>Replace now:</strong> no longer meets the minimum safety or manufacturer standard.</span>
          <span><strong style={{ color: 'var(--mon)' }}>Plan for:</strong> worn or due, but still meets the minimum. We'll track it.</span>
          <span><strong style={{ color: 'var(--ok)' }}>Good:</strong> no action needed.</span>
        </div>
        {flagged('immediate').length > 0 && <h2 className="h2" style={{ fontSize: 20 }}>Replace now</h2>}
        {groups('immediate').map((g) => <Group key={g.gid} g={g} strong />)}
        {flagged('monitor').length > 0 && <h2 className="h2" style={{ fontSize: 20 }}>Plan for · {flagged('monitor').length} parts</h2>}
        {groups('monitor').map((g) => <Group key={g.gid} g={g} />)}
        <h2 className="h2" style={{ fontSize: 20 }}>Good · {sum.ok}</h2>
        <details className="card pad"><summary style={{ cursor: 'pointer', fontWeight: 700 }}>See all {sum.ok} parts in good shape</summary>
          <p className="small" style={{ lineHeight: 1.6 }}>{applies.filter((k) => componentState(insp, k) === 'ok').map((k) => compLabel(k, true)).join(' · ')}</p>
        </details>
        {notChecked.length > 0 && (
          <>
            <h2 className="h2" style={{ fontSize: 20 }}>Not checked this visit · {notChecked.length}</h2>
            <div className="card list">
              {notChecked.map((k) => { const s = insp.statuses.find((x) => x.compKey === k)?.notInspected; return <div key={k} className="item"><div className="grow"><div className="t">{compLabel(k)}</div><div className="d">{s ? REASON_LABEL[s.reason] : ''}</div></div></div>; })}
            </div>
          </>
        )}
        <p className="small muted">Questions? {shopPhone ? `Call ${shopPhone}.` : 'Call the shop.'} Powered by Wrynch.</p>
      </div>
      {onToggle && (
        <div className="footer"><div className="btn primary block" role="status">
          {approved.length ? `${approved.length} parts approved${approvedTotal ? ` · ${money(approvedTotal)}` : ''} · the shop will confirm` : 'Tick anything you want done today'}
        </div></div>
      )}
    </div>
  );
}
