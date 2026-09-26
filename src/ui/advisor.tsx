import { allPoints, cls, compLabel, findingLabel, ONTOLOGY, parseKey, pointComponents, vehicleComponents } from '../domain/ontology';
import { completionGate, componentState, countsFinding, mediaConfirmed, summarize } from '../domain/rating';
import type { CompKey, Inspection, Rating, Vehicle } from '../domain/types';
import { actions, useStore } from '../state/store';
import { CUSTOMER_LABEL, fmtDate, fmtMi, Icon, StateChip, Tile } from './kit';
import { enc, useInspection } from './hooks';
import { Missing, REASON_LABEL } from './tech';

const vname = (v: Vehicle) => `${v.year} ${v.make} ${v.model} ${v.trim}`;

/** Short description of what was recorded on a component: values and counted findings. */
export function describe(insp: Inspection, key: CompKey): string {
  const vals = insp.results.filter((r) => r.compKey === key && r.value !== null)
    .map((r) => `${ONTOLOGY.checks[r.checkKey].name}: ${r.value}${ONTOLOGY.checks[r.checkKey].unit === '/32 in' ? '/32 in' : ` ${ONTOLOGY.checks[r.checkKey].unit ?? ''}`}`.trim());
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
  return v ? `${v.value}${ONTOLOGY.checks[v.checkKey].unit === '/32 in' ? '/32' : ` ${ONTOLOGY.checks[v.checkKey].unit ?? ''}`} · ${label}` : label;
}

// ------------------------------------------------------------------ list
export function AdvisorList() {
  const s = useStore((x) => x);
  const list = [...s.inspections].filter((i) => i.status !== 'not_started').sort((a, b) => b.date.localeCompare(a.date) || a.ro.localeCompare(b.ro));
  return (
    <div className="wide stack" style={{ gap: 18 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Inspections</h1>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Date</th><th>RO</th><th>Vehicle</th><th>Customer</th><th>Status</th><th>Immediate</th><th>Monitor</th><th /></tr></thead>
          <tbody>
            {list.map((i) => {
              const v = s.vehicles.find((x) => x.id === i.vehicleId)!;
              const sum = summarize(i, v);
              return (
                <tr key={i.id}>
                  <td>{fmtDate(i.date)}</td><td className="mono">{i.ro}</td><td>{vname(v)}</td><td>{v.customer}</td>
                  <td>{i.status === 'in_progress' ? 'Tech working' : i.status === 'submitted' ? 'Ready to send' : 'Sent'}</td>
                  <td>{sum.immediate}</td><td>{sum.monitor}</td>
                  <td><a href={`#/advisor/${i.id}`} style={{ fontWeight: 700 }}>Open</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row"><a href="#/rules" style={{ fontWeight: 700 }}>Rating rules</a></div>
    </div>
  );
}

// ------------------------------------------------------------------ results
export function AdvisorResults({ id }: { id: string }) {
  const data = useInspection(id);
  const all = useStore((x) => x.inspections);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const sum = summarize(insp, vehicle);
  const prev = previous(all, insp);
  const { applies } = vehicleComponents(vehicle.config, insp.extraComponents);
  const by = (r: Rating) => applies.filter((k) => componentState(insp, k) === r);
  const notChecked = applies.filter((k) => ['not_inspected', 'unable_to_assess'].includes(componentState(insp, k)));
  const gate = completionGate(insp, vehicle);
  const approvedWords = insp.notes.filter((n) => n.customerText && n.status !== 'ai_suggested').length;
  return (
    <div className="wide" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 24 }}>
      <aside className="stack" style={{ gap: 16 }}>
        <div className="card pad stack">
          <span className="mono small muted">RO {insp.ro}</span>
          <strong style={{ fontSize: 22, lineHeight: 1.2 }}>{vname(vehicle)}</strong>
          <span className="mono small">{vehicle.vin}</span>
          <span className="small" style={{ color: 'var(--text2)' }}>{fmtMi(insp.odometer)} · {vehicle.engine}</span>
          <div className="row between small"><span className="muted">Customer</span><strong>{vehicle.customer}</strong></div>
          <div className="row between small"><span className="muted">Technician</span><strong>{insp.technician}</strong></div>
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
      </aside>
      <main className="stack" style={{ gap: 18, minWidth: 0 }}>
        <div className="row between" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Inspection results</h1>
            <div className="muted">{fmtDate(insp.date)} · {ONTOLOGY.template.name} · {sum.total - sum.notChecked - sum.unrated} of {sum.total} parts checked</div>
          </div>
          <div className="row">
            {insp.status === 'in_progress' ? <span className="chip na">Tech still working</span> : <a className="btn secondary sm" href={`#/report/${id}`}>Preview customer report</a>}
            {insp.status === 'submitted' && <button className="btn primary sm" onClick={() => actions.sendToCustomer(id)}>Send to customer</button>}
            {insp.status === 'sent' && <span className="chip ok"><Icon name="check" size={14} />Sent to customer</span>}
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
                <thead><tr><th>Part</th><th>Finding / measurement</th><th>Last visit</th><th>Photos</th><th>Customer</th></tr></thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k}>
                      <td><a href={`#/history/${vehicle.id}/${enc(k)}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{compLabel(k)}</a></td>
                      <td>{describe(insp, k)}</td>
                      <td className="muted">{lastVisitText(prev, k)}</td>
                      <td>{insp.media.filter((m) => m.compKey === k && mediaConfirmed(m)).length}</td>
                      <td>{insp.customerApprovals.includes(k) ? <span className="chip ok">Approved</span> : <span className="muted small">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
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
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return <div className="row small" style={{ color: ok ? 'var(--ok)' : 'var(--imm)' }}><Icon name={ok ? 'check' : 'na'} size={16} stroke={2.6} /><span style={{ color: 'var(--ink)' }}>{text}</span></div>;
}

// ------------------------------------------------------------------ vehicle history grid
export function VehicleHistory({ vehicleId }: { vehicleId: string }) {
  const s = useStore((x) => x);
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
    const text = val ? `${val.value}${ONTOLOGY.checks[val.checkKey].unit === '/32 in' ? '/32' : ` ${ONTOLOGY.checks[val.checkKey].unit ?? ''}`}` : f ? findingLabel(f.key) : st === 'ok' ? 'OK' : st === 'unrated' ? '—' : st.replace(/_/g, ' ');
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
          </tbody>
        </table>
      </div>
      <p className="small muted">▲ Monitor · ■ Immediate attention. Each row is one part at one position, compared with itself across visits.</p>
    </div>
  );
}

// ------------------------------------------------------------------ rules
export function Rules() {
  const checks = Object.values(ONTOLOGY.checks).filter((c) => c.auto);
  return (
    <div className="wide stack" style={{ gap: 16 }}>
      <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Rating rules</h1>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="card pad" style={{ borderTop: '5px solid var(--imm-bar)' }}><strong style={{ color: 'var(--imm)' }}>Immediate attention</strong><p className="small" style={{ margin: '6px 0 0' }}>Needs replacing now: the part no longer meets the minimum legal or manufacturer standard.</p></div>
        <div className="card pad" style={{ borderTop: '5px solid var(--mon-bar)' }}><strong style={{ color: 'var(--mon)' }}>Monitor</strong><p className="small" style={{ margin: '6px 0 0' }}>Worn, degraded or due, but still meets the minimum.</p></div>
        <div className="card pad" style={{ borderTop: '5px solid var(--ok-bar)' }}><strong style={{ color: 'var(--ok)' }}>OK</strong><p className="small" style={{ margin: '6px 0 0' }}>No action needed.</p></div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Part</th><th>Check</th><th>Unit</th><th>OK</th><th>Monitor</th><th>Immediate</th><th>Basis</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.key}>
                <td>{cls(c.classId).label}</td><td>{c.name}</td><td>{c.unit}</td>
                <td>{c.bands.ok}</td><td>{c.bands.monitor ?? '—'}</td><td>{c.bands.immediate ?? '—'}</td>
                <td className="small muted">{c.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">Read-only in this demo. {Object.keys(ONTOLOGY.checks).length} checks in all; the rest are rated by the technician against the written bands. Ontology v{ONTOLOGY.version}.</p>
    </div>
  );
}

// ------------------------------------------------------------------ customer report
export function Report({ id }: { id: string }) {
  const data = useInspection(id);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  if (insp.status !== 'submitted' && insp.status !== 'sent') {
    return <div className="phone"><div className="body"><div className="card pad stack"><strong>Report not ready</strong><span className="small muted">The technician hasn't finished this inspection. Nothing unconfirmed is ever shown to the customer.</span></div></div></div>;
  }
  const sum = summarize(insp, vehicle);
  const { applies } = vehicleComponents(vehicle.config, insp.extraComponents);
  const flagged = (r: Rating) => applies.filter((k) => componentState(insp, k) === r);
  // Prefer the point where the part is required (the battery belongs to "Battery", not "Engine cranking").
  const pointOf = (k: CompKey) =>
    allPoints().find((p) => pointComponents(p, vehicle.config).some((c) => c.key === k && c.required))
    ?? allPoints().find((p) => pointComponents(p, vehicle.config).some((c) => c.key === k && c.applies));
  const notChecked = applies.filter((k) => ['not_inspected', 'unable_to_assess'].includes(componentState(insp, k)));
  /** Group flagged parts by the shop's point so the customer reads "Tires", not 20 rows. */
  const groups = (r: Rating) => {
    const m = new Map<string, CompKey[]>();
    for (const k of flagged(r)) { const p = pointOf(k); const gid = p?.id ?? k; m.set(gid, [...(m.get(gid) ?? []), k]); }
    return [...m.entries()].map(([gid, keys]) => {
      const p = allPoints().find((x) => x.id === gid);
      const note = p ? insp.notes.find((x) => x.pointId === p.id && x.customerText && x.status !== 'ai_suggested')?.customerText ?? null : null;
      return { gid, title: p ? p.name : compLabel(keys[0]), keys, note };
    });
  };
  const Group = ({ g, strong }: { g: ReturnType<typeof groups>[number]; strong?: boolean }) => {
    const photos = insp.media.filter((m) => m.compKey && g.keys.includes(m.compKey) && mediaConfirmed(m) && m.customerVisible);
    const approved = g.keys.every((k) => insp.customerApprovals.includes(k));
    const toggle = () => g.keys.forEach((k) => { if (insp.customerApprovals.includes(k) === approved) actions.toggleApproval(id, k); });
    return (
      <div className="card pad stack" style={strong ? { border: '2px solid var(--imm-bar)' } : undefined}>
        <div className="row between" style={{ alignItems: 'flex-start' }}><strong style={{ fontSize: 17 }}>{g.title}</strong><StateChip state={strong ? 'immediate' : 'monitor'} customer /></div>
        {photos.length > 0 && <div className="thumbs">{photos.slice(0, 3).map((m) => <img key={m.id} src={m.url} alt={`Photo of ${m.compKey ? compLabel(m.compKey) : 'part'}`} className="ph" />)}</div>}
        {g.note && <p style={{ margin: 0, lineHeight: 1.45 }}>{g.note}</p>}
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: 'var(--text2)', lineHeight: 1.5 }}>
          {g.keys.map((k) => <li key={k}><strong>{compLabel(k)}</strong>{plain(insp, k) ? `: ${plain(insp, k)}` : ''}</li>)}
        </ul>
        <label className="row" style={{ fontWeight: 600, minHeight: 44 }}>
          <input type="checkbox" checked={approved} onChange={toggle} style={{ width: 22, height: 22 }} />
          {strong ? 'Approve this repair' : 'Add to today’s visit'}
        </label>
      </div>
    );
  };
  return (
    <div className="phone">
      <div className="topbar"><span style={{ width: 12 }} /><div className="grow"><h1>[Shop name]</h1><div className="sub">Vehicle inspection report</div></div></div>
      <div className="body">
        <div>
          <h1 className="display" style={{ margin: 0, fontSize: 32 }}>Your {vehicle.year} {vehicle.make} {vehicle.model}</h1>
          <div className="small muted">{fmtDate(insp.date)} · {fmtMi(insp.odometer)} · inspected by {insp.technician}</div>
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
        <p className="small muted">Questions? Call [SHOP PHONE]. Powered by Wrynch.</p>
      </div>
      <div className="footer"><div className="btn primary block" role="status">{insp.customerApprovals.length ? `${insp.customerApprovals.length} selected · the shop will confirm the estimate` : 'Select items to approve'}</div></div>
    </div>
  );
}

export { parseKey };
