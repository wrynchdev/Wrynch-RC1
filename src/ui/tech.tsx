import { useRef, useState } from 'react';
import {
  cls, compLabel, findingLabel, ONTOLOGY, parseKey, point as getPoint, pointComponents, positionLabel, sections,
  sectionOfPoint, vehicleComponents,
} from '../domain/ontology';
import { completionGate, componentState, findingRating, isPendingAi, summarize } from '../domain/rating';
import type { CompKey, Finding, Inspection, Media, NotInspectedReason, Rating, Severity, Vehicle, VehicleConfig } from '../domain/types';
import { SEVERITIES } from '../domain/types';
import { actions, isLive, jobList, photoSrc, useStore } from '../state/store';
import { AiChip, fmtDate, fmtMi, Icon, Sheet, StateChip, Tile, TopBar } from './kit';
import { enc, go, pointStatus, useInspection, useVehicleHistory } from './hooks';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const vname = (v: Vehicle) => `${v.year} ${v.make} ${v.model} ${v.trim}`;
const compHref = (inspId: string, key: CompKey, pointId?: string) => `#/insp/${inspId}/c/${enc(key)}${pointId ? `/${pointId}` : ''}`;

export function Missing() {
  const loading = useStore((x) => x.loading > 0);
  if (loading) return <div className="phone"><div className="body"><p className="muted" role="status">Loading…</p></div></div>;
  return <div className="phone"><TopBar title="Not found" back="#/" /><div className="body"><p>That page doesn't exist, or you don't have access to it.</p></div></div>;
}

/** Stages with something to do on this vehicle (the EV stage disappears on a gas car). */
export function visibleSections(vehicle: Vehicle) {
  return sections().filter((s) => s.points.some((p) => p.components.length === 0 || pointComponents(p, vehicle.config).some((c) => c.applies)));
}

// ------------------------------------------------------------------ Jobs
const STATUS_LABEL = { not_started: 'Ready to inspect', in_progress: 'In progress', submitted: 'With advisor', sent: 'Sent to customer' } as const;
export function Jobs() {
  const s = useStore((x) => x);
  const today = new Date().toISOString().slice(0, 10);
  const all = jobList(s);
  const jobs = s.mode === 'demo'
    ? all.filter((j) => j.date === '2026-09-26' || j.date === today)
    : all.filter((j) => j.status !== 'sent' || j.date === today);
  const name = s.workspace?.me?.name ?? 'Marcus T.';
  return (
    <div className="phone">
      <div className="body">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h1 className="display" style={{ margin: 0, fontSize: 36 }}>Today</h1>
          <span className="muted">{name}</span>
        </div>
        <a className="btn primary" href="#/new"><Icon name="plus" />New inspection</a>
        {jobs.length === 0 && <div className="card pad muted">No open inspections. Start one with the button above.</div>}
        {jobs.map((j) => {
          const v = j.vehicle;
          const href = j.status === 'not_started' ? `#/setup/${j.id}` : j.status === 'in_progress' ? `#/insp/${j.id}` : `#/advisor/${j.id}`;
          return (
            <a key={j.id} className="card pad stack" href={href} style={{ color: 'inherit' }}>
              <div className="row between">
                <span className="mono small muted">{j.ro ? `RO ${j.ro}` : fmtDate(j.date)}</span>
                <span className={`chip ${j.status === 'in_progress' ? 'na' : 'ok'}`} style={j.status === 'not_started' ? { background: 'var(--blue-tint)', color: 'var(--blue)' } : undefined}>
                  {STATUS_LABEL[j.status]}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{vname(v)}</div>
                <div className="small muted">{fmtMi(j.odometer)}{v.customer ? ` · ${v.customer}` : ''}{j.technician ? ` · ${j.technician}` : ''}</div>
              </div>
              {j.concerns.length > 0 && <div className="small">Concern: {j.concerns.join(', ')}</div>}
              {j.summary && j.status !== 'not_started' && (
                <div className="row small" style={{ gap: 12 }}>
                  <span style={{ color: 'var(--imm)', fontWeight: 700 }}>{j.summary.immediate} immediate</span>
                  <span style={{ color: 'var(--mon)', fontWeight: 700 }}>{j.summary.monitor} monitor</span>
                  {s.mode === 'demo' && j.status === 'in_progress' && <span className="muted">{j.summary.total - j.summary.unrated} of {j.summary.total} parts rated</span>}
                </div>
              )}
              {j.pendingAi > 0 && <AiChip>{j.pendingAi} AI items to review</AiChip>}
            </a>
          );
        })}
        <p className="small muted">Earlier visits live in each vehicle's history.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Setup
const CONFIG_ROWS: { key: keyof VehicleConfig; label: string; options: [string, string][]; show?: (c: VehicleConfig) => boolean }[] = [
  { key: 'powertrain', label: 'Powertrain', options: [['gasoline', 'Gas'], ['diesel', 'Diesel'], ['hybrid', 'Hybrid'], ['plug_in_hybrid', 'Plug-in'], ['ev', 'EV']] },
  { key: 'chargePort', label: 'Charge port', options: [['left_front', 'LF'], ['right_front', 'RF'], ['left_rear', 'LR'], ['right_rear', 'RR'], ['front', 'Front'], ['rear', 'Rear']],
    show: (c) => c.powertrain === 'ev' || c.powertrain === 'plug_in_hybrid' },
  { key: 'drivetrain', label: 'Drivetrain', options: [['fwd', 'FWD'], ['rwd', 'RWD'], ['awd', 'AWD'], ['4wd', '4WD']] },
  { key: 'transmission', label: 'Transmission', options: [['automatic', 'Auto'], ['manual', 'Manual']], show: (c) => c.powertrain !== 'ev' },
  { key: 'rearBrakes', label: 'Rear brakes', options: [['disc', 'Disc'], ['drum', 'Drum']] },
  { key: 'steering', label: 'Steering', options: [['rack', 'Rack'], ['recirc', 'Gearbox'], ['parallelogram', 'Linkage']] },
  { key: 'frontSuspension', label: 'Front suspension', options: [['strut', 'Struts'], ['shock', 'Shocks']] },
  { key: 'rearSuspension', label: 'Rear suspension', options: [['shock', 'Shocks'], ['strut', 'Struts']] },
  { key: 'rearSprings', label: 'Rear springs', options: [['coil', 'Coil'], ['leaf', 'Leaf']] },
  { key: 'timing', label: 'Timing', options: [['belt', 'Belt'], ['chain', 'Chain'], ['none', 'None']], show: (c) => c.powertrain !== 'ev' },
];
const CONFIG_FLAGS: [keyof VehicleConfig, string][] = [
  ['frontCvAxles', 'Front CV axles'], ['independentRearDrive', 'Rear CV axles'], ['frontDiff', 'Front differential'], ['rearDiff', 'Rear differential'],
  ['transferCase', 'Transfer case'], ['twoPieceDriveshaft', 'Two-piece driveshaft'], ['solidAxle', 'Solid rear axle'],
  ['hydraulicSteering', 'Hydraulic power steering'], ['fogLamps', 'Fog lamps'], ['rearWiper', 'Rear wiper'], ['cabinFilter', 'Cabin air filter'],
  ['fuelFilter', 'Serviceable fuel filter'],
];

export function Setup({ id }: { id: string }) {
  const data = useInspection(id);
  const [odo, setOdo] = useState<string | null>(null);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const vc = vehicleComponents(vehicle.config, insp.extraComponents);
  const locked = insp.status === 'submitted' || insp.status === 'sent';
  const setCfg = (patch: Partial<VehicleConfig>) => actions.setConfig(id, vehicle.id, patch);
  const pointCount = sections().reduce((a, x) => a + x.points.length, 0);
  return (
    <div className="phone">
      <TopBar title="Set up vehicle" sub="Before the first photo" back="#/" right={insp.ro ? <span className="mono small muted">RO {insp.ro}</span> : undefined} />
      <div className="body">
        <div className="card pad stack">
          <span className="small muted">VIN</span>
          <span className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{vehicle.vin}</span>
          <strong style={{ fontSize: 18 }}>{vname(vehicle)}</strong>
          <span className="small muted">{vehicle.engine}</span>
        </div>
        <div className="card pad field">
          <label htmlFor="odo">Odometer (mi)</label>
          <div className="row">
            <input id="odo" className="input mono" inputMode="numeric" value={odo ?? String(insp.odometer || '')} disabled={locked}
              onChange={(e) => setOdo(e.target.value.replace(/[^\d]/g, ''))} />
            <button className="btn sm secondary" disabled={locked || odo === null} onClick={() => { actions.setOdometer(id, Number(odo) || 0); setOdo(null); }}>Save</button>
          </div>
        </div>
        <div>
          <h2 className="h2">What this vehicle has</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>Decides which parts each point checks. Parts that aren't on this car become N/A, never "missed". Check anything the VIN couldn't tell us.</p>
        </div>
        <div className="card list">
          {CONFIG_ROWS.filter((r) => !r.show || r.show(vehicle.config)).map((r) => (
            <div key={r.key} className="item" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span className="t">{r.label}</span>
              <div className="seg" role="group" aria-label={r.label}>
                {r.options.map(([val, lab]) => (
                  <button key={val} aria-pressed={(vehicle.config[r.key] ?? 'left_front') === val} disabled={locked} onClick={() => setCfg({ [r.key]: val } as Partial<VehicleConfig>)}>{lab}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <fieldset className="card pad" style={{ margin: 0 }}>
          <legend className="h2" style={{ fontSize: 15, padding: '0 4px' }}>Also on this vehicle</legend>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4 }}>
            {CONFIG_FLAGS.map(([k, label]) => (
              <label key={k} className="row" style={{ minHeight: 44, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!vehicle.config[k]} disabled={locked} onChange={(e) => setCfg({ [k]: e.target.checked } as Partial<VehicleConfig>)} style={{ width: 20, height: 20 }} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="dark stack" style={{ gap: 4 }}>
          <span className="small" style={{ color: '#B9BDC3' }}>{ONTOLOGY.template.name} · {pointCount} points</span>
          <span className="display" style={{ fontSize: 28 }}>{vc.applies.length} parts to rate on this {vehicle.model || 'vehicle'}</span>
          <span className="small" style={{ color: '#D6D9DD' }}>{vc.na.length} don't apply to this configuration</span>
        </div>
      </div>
      <div className="footer">
        <a className="btn primary block" href={`#/insp/${id}`} onClick={() => { if (insp.status === 'not_started') actions.start(id); }}>{insp.status === 'not_started' ? 'Start inspection' : 'Back to inspection'}</a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Overview
export function Overview({ id }: { id: string }) {
  const data = useInspection(id);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const sum = summarize(insp, vehicle);
  const gate = completionGate(insp, vehicle);
  const aiItems = gate.filter((g) => g.kind !== 'required').length;
  const visible = visibleSections(vehicle);
  const allPoints = visible.flatMap((s) => s.points);
  const pointsDone = allPoints.filter((p) => pointStatus(insp, vehicle, p.id).done).length;
  const locked = insp.status !== 'in_progress';
  const isDemo = !isLive();
  return (
    <div className="phone">
      <TopBar title={`${vehicle.year} ${vehicle.model} ${vehicle.trim}`.trim()} sub={`${insp.ro ? `RO ${insp.ro} · ` : ''}${fmtMi(insp.odometer)}`} back="#/"
        right={<a className="linkbtn" href={`#/setup/${id}`}>Vehicle</a>} />
      <div className="body">
        {locked && <div className="card pad row"><Icon name="lock" /><span className="grow">Submitted. Changes are locked.</span><a href={`#/advisor/${id}`}>Advisor view</a></div>}
        <div className="card pad stack">
          <div className="row between"><strong>{pointsDone} of {allPoints.length} points done</strong><span className="small muted">{insp.media.filter((m) => m.status !== 'excluded').length} photos</span></div>
          <div className="bar"><div style={{ width: `${(pointsDone / allPoints.length) * 100}%` }} /></div>
          <div className="tiles">
            <Tile kind="immediate" n={sum.immediate} label="Immediate" />
            <Tile kind="monitor" n={sum.monitor} label="Monitor" />
            <Tile kind="ok" n={sum.ok} label="OK" />
            <Tile kind="ai" n={aiItems} label="AI to review" />
          </div>
          {insp.dtcs.length > 0 && <div className="small muted">Codes read: <span className="mono" style={{ color: 'var(--ink)' }}>{insp.dtcs.map((d) => d.code).join(' · ')}</span></div>}
        </div>

        {visible.map((s) => {
          const st = s.points.map((p) => ({ p, st: pointStatus(insp, vehicle, p.id) }));
          const done = st.filter((x) => x.st.done).length;
          const pend = st.reduce((a, x) => a + x.st.pendingFindings + x.st.pendingPhotos, 0)
            + insp.media.filter((m) => m.sectionId === s.id && m.status === 'unassigned').length;
          const photos = insp.media.filter((m) => m.sectionId === s.id && m.status !== 'excluded').length;
          const complete = done === s.points.length && pend === 0;
          return (
            <section key={s.id} className="card" style={complete ? undefined : { borderColor: 'var(--ink)' }}>
              <div className="pad row">
                <span className={`chip ${complete ? 'ok' : 'na'}`}>{complete ? <Icon name="check" size={14} stroke={2.6} /> : null}{done}/{s.points.length}</span>
                <div className="grow"><div className="t" style={{ fontWeight: 700 }}>{s.name}</div><div className="small muted">{photos} photos</div></div>
              </div>
              {pend > 0 && <div className="ai-box small" style={{ margin: '0 16px 10px' }}>{pend} AI items wait for you in this stage.</div>}
              <div className="list" style={{ borderTop: '1px solid var(--line2)' }}>
                {st.map(({ p, st: ps }) => (
                  <a key={p.id} className="item" href={`#/insp/${id}/point/${p.id}`}>
                    <div className="grow"><div className="t">{p.name}</div><div className="d">{ps.count} parts{ps.photos ? ` · ${ps.photos} photos` : ''}</div></div>
                    {ps.count === 0 ? <span className="chip na">Symptom check</span> : ps.pendingFindings > 0 ? <AiChip>{ps.pendingFindings}</AiChip> : <StateChip state={ps.state} />}
                  </a>
                ))}
              </div>
              {!locked && (
                <div className="row" style={{ padding: 12 }}>
                  <a className="btn secondary grow" href={`#/insp/${id}/capture/${s.id}`}><Icon name="camera" />Capture</a>
                  <a className="btn primary grow" href={`#/insp/${id}/sort/${s.id}`}>Review photos</a>
                </div>
              )}
              {!locked && isDemo && s.id === 'under_car' && !complete && vehicle.id === 'v-4runner' && (
                <div style={{ padding: '0 12px 12px' }}>
                  <button className="btn quiet block sm" onClick={() => actions.demoFillUnderCar(id)}>Demo: enter the shop's real under-car results</button>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!locked && (
        <div className="footer">
          <a className={`btn block ${gate.length ? 'locked' : 'primary'}`} href={`#/insp/${id}/finish`}>
            {gate.length ? <><Icon name="lock" />Finish · {gate.length} items left</> : 'Finish inspection'}
          </a>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Capture
export function Capture({ id, sectionId }: { id: string; sectionId: string }) {
  const data = useInspection(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const section = sections().find((s) => s.id === sectionId);
  if (!data || !section) return <Missing />;
  const add = (files: { url: string; name: string; file?: File }[]) => {
    if (!files.length) return;
    go(`/insp/${id}/sort/${sectionId}`);
    void actions.addPhotos(id, sectionId, files);
  };
  return (
    <div className="phone" style={{ background: '#0E0F11', color: 'var(--paper)' }}>
      <div className="topbar" style={{ background: '#0E0F11', borderColor: '#26292E' }}>
        <a className="iconbtn" style={{ color: 'var(--paper)' }} href={`#/insp/${id}`} aria-label="Close"><Icon name="close" size={22} /></a>
        <div className="grow"><h1>{section.name}</h1><div className="sub" style={{ color: '#B9BDC3' }}>Burst capture · shoot in any order</div></div>
      </div>
      <div className="body">
        <div className="dropzone" style={{ background: '#1A1C1F', borderColor: '#4A4E55', color: 'var(--paper)', minHeight: 300, justifyContent: 'center' }}>
          <Icon name="camera" size={40} />
          <strong style={{ fontSize: 18 }}>Shoot or pick every photo for this stage</strong>
          <span className="small" style={{ color: '#B9BDC3', maxWidth: 320 }}>Shoot with your camera app, then pick them all here at once. Wrynch sorts them onto parts; nothing it suggests counts until you confirm.</span>
          <input ref={fileRef} className="sr" id="files" type="file" accept="image/*" multiple
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(fs.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f }))); }} />
          <label htmlFor="files" className="btn primary" style={{ cursor: 'pointer' }}>Take or choose photos</label>
          {!isLive() && <button className="btn sm" style={{ background: '#26292E', color: 'var(--paper)' }} onClick={() => add(actions.samplePhotos(sectionId, 12))}>No photos handy? Use 12 sample photos</button>}
        </div>
        <div className="small" style={{ color: '#B9BDC3' }}>What to capture in {section.name.toLowerCase()}:</div>
        <ul className="small" style={{ color: '#D6D9DD', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          {section.points.slice(0, 8).map((p) => <li key={p.id}>{p.name}</li>)}
          {section.points.length > 8 && <li>+ {section.points.length - 8} more</li>}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Sort photos
export function Sort({ id, sectionId }: { id: string; sectionId: string }) {
  const data = useInspection(id);
  const [placing, setPlacing] = useState<string | null>(null);
  const section = sections().find((s) => s.id === sectionId);
  if (!data || !section) return <Missing />;
  const { insp, vehicle } = data;
  const media = insp.media.filter((m) => m.sectionId === sectionId && m.status !== 'excluded');
  const needs = media.filter((m) => m.status === 'unassigned');
  const proposed = media.filter((m) => m.status === 'ai_proposed');
  const byPoint = section.points.map((p) => ({ p, items: media.filter((m) => m.pointId === p.id && m.status !== 'unassigned') })).filter((x) => x.items.length);
  const placingMedia = media.find((m) => m.id === placing) ?? null;
  return (
    <div className="phone">
      <TopBar title="Sort photos" sub={`${section.name} · ${media.length} photos`} back={`#/insp/${id}`} />
      <div className="body">
        {media.length === 0 ? (
          <div className="card pad stack">
            <strong>No photos yet</strong>
            <a className="btn primary" href={`#/insp/${id}/capture/${sectionId}`}><Icon name="camera" />Capture this stage</a>
          </div>
        ) : (
          <div className="ai-box row" style={{ alignItems: 'flex-start' }}>
            <Icon name="ai" />
            <span className="small"><strong>AI placed {media.length - needs.length} of {media.length} photos</strong> on a part. Dashed = not confirmed yet. Tap any photo to move it.</span>
          </div>
        )}
        {needs.length > 0 && (
          <section className="stack">
            <h2 className="h2">Needs you · {needs.length}</h2>
            {needs.map((m) => (
              <div key={m.id} className="card row" style={{ padding: 10 }}>
                <img src={photoSrc(m.url)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                <div className="grow"><div className="t" style={{ fontWeight: 600 }}>AI unsure</div><div className="small muted">{m.aiGuess ? `Best guess: ${compLabel(m.aiGuess.compKey, true)} (${Math.round((m.confidence ?? 0) * 100)}%)` : 'No part found'}</div></div>
                <button className="btn sm secondary" onClick={() => setPlacing(m.id)}>Place</button>
                <button className="btn sm quiet" onClick={() => actions.excludePhoto(id, m.id)}>Exclude</button>
              </div>
            ))}
          </section>
        )}
        {byPoint.map(({ p, items }) => (
          <section key={p.id} className="stack">
            <div className="row between"><h2 className="h2">{p.name} · {items.length}</h2><a className="small" style={{ fontWeight: 700 }} href={`#/insp/${id}/point/${p.id}`}>Open point</a></div>
            <div className="thumbs">
              {items.map((m) => (
                <button key={m.id} className={`thumb${m.status === 'ai_proposed' ? ' pending' : ''}`} onClick={() => setPlacing(m.id)} aria-label={`Photo on ${m.compKey ? compLabel(m.compKey) : 'no part'}. Tap to move.`}>
                  <img src={photoSrc(m.url)} alt="" />
                  <span className="t">{m.compKey ? compLabel(m.compKey, true) : '—'}</span>
                  <span className="c" style={m.status === 'ai_proposed' ? undefined : { color: 'var(--ok)' }}>
                    {m.status === 'ai_proposed' ? `${Math.round((m.confidence ?? 0) * 100)}% sure` : m.status === 'reassigned' ? 'Moved by you' : 'Confirmed'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {media.length > 0 && (
        <div className="footer">
          <a className="btn quiet" href={`#/insp/${id}/capture/${sectionId}`}><Icon name="camera" /></a>
          <button className="btn primary grow" disabled={proposed.length === 0} onClick={() => actions.confirmPlacements(id, sectionId)}>
            {proposed.length ? `Confirm ${proposed.length} placements` : 'All placements confirmed'}
          </button>
        </div>
      )}
      {placingMedia && <PlaceSheet insp={insp} vehicle={vehicle} media={placingMedia} sectionId={sectionId} onClose={() => setPlacing(null)} />}
    </div>
  );
}

function PlaceSheet({ insp, vehicle, media, sectionId, onClose }: { insp: Inspection; vehicle: Vehicle; media: Media; sectionId: string; onClose: () => void }) {
  const section = sections().find((s) => s.id === sectionId)!;
  const [pointId, setPointId] = useState(media.pointId ?? media.aiGuess?.pointId ?? section.points[0].id);
  const [key, setKey] = useState<CompKey | null>(media.compKey ?? media.aiGuess?.compKey ?? null);
  const comps = pointComponents(getPoint(pointId), vehicle.config).filter((c) => c.applies);
  const keyInPoint = key && comps.some((c) => c.key === key) ? key : null;
  return (
    <Sheet title="Place photo" onClose={onClose}>
      <img src={photoSrc(media.url)} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12 }} />
      {media.aiGuess && <AiChip>AI guessed: {compLabel(media.aiGuess.compKey, true)} · {Math.round((media.confidence ?? 0) * 100)}%</AiChip>}
      <div className="field">
        <label htmlFor="pt">Point</label>
        <select id="pt" className="input" value={pointId} onChange={(e) => { setPointId(e.target.value); setKey(null); }}>
          {section.points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <span className="label">Part and position</span>
        <div className="pills">
          {comps.map((c) => (
            <button key={c.key} className="pill" aria-pressed={keyInPoint === c.key} onClick={() => setKey(c.key)}>{compLabel(c.key, true)}</button>
          ))}
          {comps.length === 0 && <span className="small muted">This point has no parts on this vehicle.</span>}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>The AI guess and your change are both kept in the photo's history.</p>
      <div className="row">
        <button className="btn quiet" onClick={() => { actions.excludePhoto(insp.id, media.id); onClose(); }}>Exclude</button>
        <button className="btn primary grow" disabled={!keyInPoint} onClick={() => { actions.placePhoto(insp.id, media.id, pointId, keyInPoint!); onClose(); }}>
          {keyInPoint ? `Place on ${compLabel(keyInPoint, true)}` : 'Pick a part'}
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Point
export function PointView({ id, pointId }: { id: string; pointId: string }) {
  const data = useInspection(id);
  const [note, setNote] = useState<string | null>(null);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  let p;
  try { p = getPoint(pointId); } catch { return <Missing />; }
  const section = sectionOfPoint(pointId);
  const all = pointComponents(p, vehicle.config);
  const comps = all.filter((c) => c.applies);
  const na = all.filter((c) => !c.applies);
  const st = pointStatus(insp, vehicle, pointId);
  const groups = new Map<string, typeof comps>();
  for (const c of comps) {
    const pos = parseKey(c.key).position;
    const g = pos && ['left_front', 'right_front', 'left_rear', 'right_rear'].includes(pos) ? positionLabel(pos) : 'Whole vehicle';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const photos = insp.media.filter((m) => m.pointId === pointId && m.status !== 'excluded');
  const n = insp.notes.find((x) => x.pointId === pointId);
  const noteText = note ?? n?.techText ?? '';
  const idx = section.points.findIndex((x) => x.id === pointId);
  const nextP = section.points[idx + 1];
  const locked = insp.status !== 'in_progress';
  const unrated = comps.filter((c) => componentState(insp, c.key) === 'unrated').length;
  return (
    <div className="phone">
      <TopBar title={p.name} sub={`${section.name} · ${comps.length} parts`} back={`#/insp/${id}`} />
      <div className="body">
        {comps.length === 0 && (
          <div className="card pad small">{p.note ?? 'This point has no parts on this vehicle.'}</div>
        )}
        {comps.length > 0 && (
          <div className="card pad row">
            <StateChip state={st.state} large />
            <span className="small" style={{ color: 'var(--text2)' }}>The point shows its worst part. Each part keeps its own rating and history.</span>
          </div>
        )}
        {[...groups.entries()].map(([g, list]) => (
          <section key={g} className="card">
            <h2 className="group-h">{g}</h2>
            <div className="list">
              {list.map((c) => {
                const pend = insp.findings.filter((f) => f.compKey === c.key && isPendingAi(f));
                const state = componentState(insp, c.key);
                const res = insp.results.filter((r) => r.compKey === c.key && r.value !== null);
                const counted = insp.findings.filter((f) => f.compKey === c.key && !isPendingAi(f) && f.status !== 'denied');
                const detail = pend.length ? `AI suggests: ${findingLabel(pend[0].key).toLowerCase()}, ${pend[0].severity}`
                  : [...res.map((r) => `${r.value} ${ONTOLOGY.checks[r.checkKey].unit ?? ''}`.trim()), ...counted.map((f) => `${findingLabel(f.key)}, ${f.severity}`)].join(' · ')
                  || (state === 'unrated' ? (c.required ? 'Required' : 'Optional') : 'No findings');
                const name = parseKey(c.key).position && g !== 'Whole vehicle' ? cls(parseKey(c.key).classId).label : compLabel(c.key);
                return (
                  <a key={c.key} className={`item${pend.length ? ' pending' : ''}`} href={compHref(id, c.key, pointId)}>
                    <div className="grow"><div className="t">{name}</div><div className="d" style={pend.length ? { color: 'var(--ai)' } : undefined}>{detail}</div></div>
                    {pend.length ? <AiChip>Review</AiChip> : <StateChip state={state} />}
                    <Icon name="next" />
                  </a>
                );
              })}
            </div>
          </section>
        ))}
        {na.length > 0 && (
          <div className="card item" style={{ color: 'var(--muted)' }}>
            <div className="grow"><div className="t">{na.length} parts don't apply</div><div className="d">{[...new Set(na.map((c) => cls(parseKey(c.key).classId).label))].join(', ')}</div></div>
            <span className="chip na"><Icon name="na" size={14} />N/A</span>
          </div>
        )}
        {!locked && unrated > 0 && (
          <button className="btn quiet" onClick={() => actions.markPointOk(id, pointId)}>
            <Icon name="check" />Nothing found on the other {unrated} {unrated === 1 ? 'part' : 'parts'}
          </button>
        )}
        {photos.length > 0 && (
          <section className="stack">
            <h2 className="h2">Photos · {photos.length}</h2>
            <div className="thumbs">
              {photos.map((m) => (
                <a key={m.id} className={`thumb${m.status === 'ai_proposed' ? ' pending' : ''}`} href={m.compKey ? compHref(id, m.compKey, pointId) : `#/insp/${id}/sort/${section.id}`}>
                  <img src={photoSrc(m.url)} alt={m.compKey ? compLabel(m.compKey) : 'Unplaced photo'} />
                  <span className="t">{m.compKey ? compLabel(m.compKey, true) : '—'}</span>
                </a>
              ))}
            </div>
          </section>
        )}
        <section className="card pad stack">
          <label className="label" htmlFor="note">Your note</label>
          <span className="small muted" style={{ marginTop: -6 }}>The customer sees this note as written, unless you approve a reworded version.</span>
          <textarea id="note" className="input" rows={2} value={noteText} disabled={locked}
            onChange={(e) => setNote(e.target.value)} onBlur={() => note !== null && actions.setNote(id, pointId, note)} />
          {!locked && noteText.trim() && (
            <a className="row small" style={{ fontWeight: 700, color: 'var(--ai)' }} href={`#/insp/${id}/wording/${pointId}`}
              onClick={() => { if (note !== null) actions.setNote(id, pointId, note); }}>
              <Icon name="ai" size={16} />{n?.status === 'ai_suggested' ? 'Customer wording suggested · review' : 'Customer wording'}
            </a>
          )}
        </section>
      </div>
      <div className="footer">
        {nextP ? <a className="btn primary block" href={`#/insp/${id}/point/${nextP.id}`}>Next: {nextP.name}<Icon name="next" /></a>
          : <a className="btn primary block" href={`#/insp/${id}`}>Back to overview</a>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Component
const REASONS: [NotInspectedReason, string][] = [
  ['not_accessible', 'Not accessible'], ['not_performed_this_visit', 'Not done this visit'],
  ['blocked_by_other_condition', 'Blocked by another problem'], ['vehicle_not_road_tested', 'Not road tested'],
  ['customer_declined', 'Customer declined'], ['unsafe_to_inspect', 'Unsafe to inspect'],
];
export const REASON_LABEL = Object.fromEntries(REASONS) as Record<NotInspectedReason, string>;

export function ComponentView({ id, compKeyEnc, pointId }: { id: string; compKeyEnc: string; pointId?: string }) {
  const data = useInspection(id);
  const [adding, setAdding] = useState(false);
  const [skip, setSkip] = useState(false);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const key = decodeURIComponent(compKeyEnc);
  let c;
  try { c = cls(parseKey(key).classId); } catch { return <Missing />; }
  const state = componentState(insp, key);
  const pending = insp.findings.filter((f) => f.compKey === key && isPendingAi(f));
  const counted = insp.findings.filter((f) => f.compKey === key && !isPendingAi(f) && f.status !== 'denied');
  const photos = insp.media.filter((m) => m.compKey === key && m.status !== 'excluded');
  const status = insp.statuses.find((s) => s.compKey === key)?.notInspected;
  const locked = insp.status !== 'in_progress';
  const back = pointId ? `#/insp/${id}/point/${pointId}` : `#/insp/${id}`;
  return (
    <div className="phone">
      <TopBar title={compLabel(key)} sub={`${cap(c.category.replace(/_/g, ' '))}${c.safety ? ' · safety part' : ''}`} back={back}
        right={<a className="linkbtn" href={`#/history/${vehicle.id}/${enc(key)}`}>History</a>} />
      <div className="body">
        <div className="row between">
          <StateChip state={state} large />
          {status && <span className="small muted">{REASON_LABEL[status.reason]}</span>}
        </div>

        {pending.map((f) => <AiFindingCard key={f.id} insp={insp} f={f} locked={locked} />)}

        {photos.length > 0 && (
          <div className="thumbs">{photos.map((m) => (
            <figure key={m.id} className={`thumb${m.status === 'ai_proposed' ? ' pending' : ''}`} style={{ margin: 0 }}>
              <img src={photoSrc(m.url)} alt={`Photo of ${compLabel(key)}`} />
              <label className="small row" style={{ gap: 6 }}>
                <input type="checkbox" checked={m.customerVisible} disabled={locked} onChange={(e) => actions.setPhotoCustomerVisible(id, m.id, e.target.checked)} />Customer sees
              </label>
            </figure>
          ))}</div>
        )}

        <h2 className="h2">Checks</h2>
        {c.checks.map((k) => <CheckCard key={k} insp={insp} compKey={key} checkKey={k} locked={locked} />)}

        <div className="row between"><h2 className="h2">Findings</h2>{!locked && <button className="linkbtn" onClick={() => setAdding(true)}>+ Add finding</button>}</div>
        {counted.length === 0 && <div className="small muted">None recorded.</div>}
        {counted.map((f) => (
          <div key={f.id} className="card item">
            <div className="grow"><div className="t">{findingLabel(f.key)}</div><div className="d">{cap(f.severity)} · {f.source === 'ai' ? `AI, ${f.status === 'modified' ? 'edited' : 'confirmed'} by you` : 'Entered by you'}</div></div>
            <StateChip state={findingRating(c.id, f.key, f.severity)} />
            {!locked && f.source === 'technician' && <button className="iconbtn" aria-label={`Remove ${findingLabel(f.key)}`} onClick={() => actions.removeFinding(id, f.id)}><Icon name="trash" /></button>}
          </div>
        ))}

        <div className="card pad small" style={{ color: 'var(--text2)' }}><strong>Capture tip:</strong> {c.capture}</div>
        {!locked && <button className="btn quiet" onClick={() => setSkip(true)}>Couldn't check this part</button>}
      </div>
      {adding && <AddFinding insp={insp} compKey={key} onClose={() => setAdding(false)} />}
      {skip && <SkipSheet insp={insp} compKey={key} onClose={() => setSkip(false)} />}
    </div>
  );
}

function CheckCard({ insp, compKey, checkKey, locked }: { insp: Inspection; compKey: CompKey; checkKey: string; locked: boolean }) {
  const check = ONTOLOGY.checks[checkKey];
  const res = insp.results.find((r) => r.compKey === compKey && r.checkKey === checkKey);
  const [val, setVal] = useState(res?.value !== null && res?.value !== undefined ? String(res.value) : '');
  const auto = !!check.auto;
  const save = () => { const v = parseFloat(val); if (!Number.isNaN(v)) actions.setCheck(insp.id, compKey, checkKey, v, null); };
  return (
    <div className="card pad stack">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow"><div style={{ fontWeight: 700 }}>{check.name}</div><div className="small muted">{check.how}</div></div>
        {res && <StateChip state={res.rating} />}
      </div>
      {auto ? (
        <div className="row">
          <label className="sr" htmlFor={`v-${checkKey}`}>{check.name} ({check.unit})</label>
          <input id={`v-${checkKey}`} className="input mono" inputMode="decimal" value={val} disabled={locked} placeholder="Value"
            onChange={(e) => setVal(e.target.value.replace(/[^\d.-]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} style={{ maxWidth: 140 }} />
          <span className="muted">{check.unit}</span>
          <button className="btn sm primary" disabled={locked || val === ''} onClick={save}>Save</button>
        </div>
      ) : (
        <div className="seg rate" role="group" aria-label={`Rate ${check.name}`}>
          {(['ok', 'monitor', 'immediate'] as Rating[]).filter((r) => r === 'ok' || check.bands[r as 'monitor' | 'immediate']).map((r) => (
            <button key={r} className={r} aria-pressed={res?.rating === r} disabled={locked}
              onClick={() => (res?.rating === r ? actions.clearCheck(insp.id, compKey, checkKey) : actions.setCheck(insp.id, compKey, checkKey, null, r))}>
              {r === 'ok' ? 'OK' : r === 'monitor' ? 'Monitor' : 'Immediate'}
            </button>
          ))}
        </div>
      )}
      <details className="small">
        <summary className="muted" style={{ cursor: 'pointer' }}>What counts as OK / Monitor / Immediate</summary>
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          <span><strong style={{ color: 'var(--ok)' }}>OK:</strong> {check.bands.ok}</span>
          {check.bands.monitor && <span><strong style={{ color: 'var(--mon)' }}>Monitor:</strong> {check.bands.monitor}</span>}
          {check.bands.immediate && <span><strong style={{ color: 'var(--imm)' }}>Immediate:</strong> {check.bands.immediate}</span>}
          <span className="muted">Basis: {check.basis}</span>
        </div>
      </details>
    </div>
  );
}

function AiFindingCard({ insp, f, locked }: { insp: Inspection; f: Finding; locked: boolean }) {
  const c = cls(parseKey(f.compKey).classId);
  const [edit, setEdit] = useState(false);
  const [key, setKey] = useState(f.key);
  const [sev, setSev] = useState<Severity>(f.severity);
  const media = insp.media.find((m) => m.id === f.mediaId);
  return (
    <div className="ai-card stack">
      <div className="row between"><span className="row" style={{ gap: 6, fontWeight: 700, color: 'var(--ai)' }}><Icon name="ai" />AI suggests</span>{f.confidence !== null && <span className="small muted">{Math.round(f.confidence * 100)}% sure</span>}</div>
      {media && <img src={photoSrc(media.url)} alt="Photo the suggestion came from" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10 }} />}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div><div className="small muted">Finding</div><strong>{findingLabel(edit ? key : f.key)}</strong></div>
        <div><div className="small muted">Severity</div><strong>{cap(edit ? sev : f.severity)}</strong></div>
        <div><div className="small muted">Rating</div><StateChip state={findingRating(c.id, edit ? key : f.key, edit ? sev : f.severity)} /></div>
      </div>
      {f.rationale && <p className="small" style={{ margin: 0, color: 'var(--text2)' }}>{f.rationale}</p>}
      {edit && (
        <>
          <span className="label">Finding (allowed for {c.label.toLowerCase()})</span>
          <div className="pills">{Object.keys(c.findings).map((k) => <button key={k} className="pill" aria-pressed={k === key} onClick={() => setKey(k)}>{findingLabel(k)}</button>)}</div>
          <span className="label">Severity</span>
          <div className="seg" role="group" aria-label="Severity">{SEVERITIES.map((s) => <button key={s} aria-pressed={s === sev} onClick={() => setSev(s)}>{cap(s)}</button>)}</div>
        </>
      )}
      {!locked && (
        <>
          <p className="small muted" style={{ margin: 0 }}>Until you confirm, this doesn't count and the customer can't see it.</p>
          <div className="row">
            <button className="btn sm danger" onClick={() => actions.reviewFinding(insp.id, f.id, 'reject')}>Reject</button>
            {edit ? (
              <button className="btn sm primary grow" onClick={() => actions.reviewFinding(insp.id, f.id, key === f.key && sev === f.severity ? 'confirm' : { key, severity: sev })}>Save and confirm</button>
            ) : (
              <>
                <button className="btn sm secondary" onClick={() => setEdit(true)}>Edit</button>
                <button className="btn sm primary grow" onClick={() => actions.reviewFinding(insp.id, f.id, 'confirm')}>Confirm</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AddFinding({ insp, compKey, onClose }: { insp: Inspection; compKey: CompKey; onClose: () => void }) {
  const c = cls(parseKey(compKey).classId);
  const [key, setKey] = useState<string | null>(null);
  const [sev, setSev] = useState<Severity>('moderate');
  return (
    <Sheet title={`Add finding · ${compLabel(compKey, true)}`} onClose={onClose}>
      <span className="label">Finding</span>
      <div className="pills">{Object.keys(c.findings).map((k) => <button key={k} className="pill" aria-pressed={k === key} onClick={() => setKey(k)}>{findingLabel(k)}</button>)}</div>
      <span className="label">Severity</span>
      <div className="seg" role="group" aria-label="Severity">{SEVERITIES.map((s) => <button key={s} aria-pressed={s === sev} onClick={() => setSev(s)}>{cap(s)}</button>)}</div>
      {key && <div className="row"><span className="small muted">Default rating:</span><StateChip state={findingRating(c.id, key, sev)} /></div>}
      <button className="btn primary" disabled={!key} onClick={() => { actions.addFinding(insp.id, compKey, key!, sev); onClose(); }}>Add finding</button>
    </Sheet>
  );
}

function SkipSheet({ insp, compKey, onClose }: { insp: Inspection; compKey: CompKey; onClose: () => void }) {
  const cur = insp.statuses.find((s) => s.compKey === compKey)?.notInspected;
  const [reason, setReason] = useState<NotInspectedReason | null>(cur?.reason ?? null);
  const [kind, setKind] = useState<'not_inspected' | 'unable_to_assess'>(cur?.kind ?? 'not_inspected');
  return (
    <Sheet title="Why couldn't you check it?" onClose={onClose}>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }} className="list">
        <legend className="sr">Reason</legend>
        {REASONS.map(([r, label]) => (
          <label key={r} className="item" style={{ cursor: 'pointer' }}>
            <input type="radio" name="why" checked={reason === r} onChange={() => setReason(r)} style={{ width: 20, height: 20 }} />
            <span className="t">{label}</span>
          </label>
        ))}
      </fieldset>
      <div className="seg" role="group" aria-label="Record as">
        <button aria-pressed={kind === 'not_inspected'} onClick={() => setKind('not_inspected')}>Not inspected</button>
        <button aria-pressed={kind === 'unable_to_assess'} onClick={() => setKind('unable_to_assess')}>Unable to assess</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>The customer sees the reason, not a blank. Any ratings on this part are cleared.</p>
      <div className="row">
        {cur && <button className="btn quiet" onClick={() => { actions.setNotInspected(insp.id, compKey, null, null); onClose(); }}>Clear</button>}
        <button className="btn primary grow" disabled={!reason} onClick={() => { actions.setNotInspected(insp.id, compKey, kind, reason); onClose(); }}>Save</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Wording
export function Wording({ id, pointId }: { id: string; pointId: string }) {
  const data = useInspection(id);
  const [editing, setEditing] = useState<string | null>(null);
  if (!data) return <Missing />;
  const { insp } = data;
  const n = insp.notes.find((x) => x.pointId === pointId);
  const p = getPoint(pointId);
  const back = `#/insp/${id}/point/${pointId}`;
  return (
    <div className="phone">
      <TopBar title="Customer wording" sub={p.name} back={back} />
      <div className="body">
        <div className="card pad stack">
          <span className="small muted">Your note · always kept</span>
          <p className="mono" style={{ margin: 0 }}>{n?.techText || '—'}</p>
        </div>
        {n && n.status === 'ai_suggested' && n.aiText && (
          <div className="ai-card stack">
            <div className="row between"><span className="row" style={{ gap: 6, fontWeight: 700, color: 'var(--ai)' }}><Icon name="ai" />Suggested for the customer</span><span className="chip ai">Not approved</span></div>
            {editing === null ? <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{n.aiText}</p>
              : <textarea className="input" rows={4} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Edit wording" />}
            <div className="small" style={{ color: 'var(--ok)' }}><Icon name="check" size={14} /> Keeps every measurement, adds no findings or repairs</div>
          </div>
        )}
        {n && n.status !== 'ai_suggested' && n.customerText && (
          <div className="card pad stack"><span className="small muted">Customer sees ({n.status.replace(/_/g, ' ')})</span><p style={{ margin: 0 }}>{n.customerText}</p></div>
        )}
        {n && n.status !== 'ai_suggested' && insp.status === 'in_progress' && (
          <button className="btn secondary" onClick={() => actions.requestWording(id, pointId)}><Icon name="ai" />Suggest customer wording</button>
        )}
        <p className="small muted" style={{ margin: 0 }}>AI (demo stub) may only reword your note. The customer sees nothing until you approve it.</p>
      </div>
      {n?.status === 'ai_suggested' && (
        <div className="footer">
          <button className="btn quiet" onClick={() => actions.resolveWording(id, pointId, 'reject')}>Keep mine</button>
          {editing === null ? <button className="btn secondary" onClick={() => setEditing(n.aiText ?? '')}>Edit</button>
            : <button className="btn secondary" onClick={() => { actions.resolveWording(id, pointId, { text: editing }); setEditing(null); }}>Save edit</button>}
          <button className="btn primary grow" onClick={() => actions.resolveWording(id, pointId, 'accept')}>Approve</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Finish
export function Finish({ id }: { id: string }) {
  const data = useInspection(id);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const gate = completionGate(insp, vehicle);
  const sum = summarize(insp, vehicle);
  const ai = gate.filter((g) => g.kind !== 'required');
  const req = gate.filter((g) => g.kind === 'required');
  const hrefFor = (g: (typeof gate)[number]) => {
    if (g.kind === 'ai_finding') { const f = insp.findings.find((x) => x.id === g.id)!; return compHref(id, f.compKey); }
    if (g.kind === 'photo') return `#/insp/${id}/sort/${insp.media.find((m) => m.id === g.id)!.sectionId}`;
    if (g.kind === 'wording') return `#/insp/${id}/wording/${g.id}`;
    return compHref(id, g.id);
  };
  const labelFor = (g: (typeof gate)[number]) => {
    if (g.kind === 'ai_finding') { const f = insp.findings.find((x) => x.id === g.id)!; return [`AI finding`, `${compLabel(f.compKey, true)} · ${findingLabel(f.key).toLowerCase()}`]; }
    if (g.kind === 'photo') return ['Photo not confirmed', insp.media.find((m) => m.id === g.id)!.label];
    if (g.kind === 'wording') return ['Wording suggestion', getPoint(g.id).name];
    return ['Required part not rated', compLabel(g.id, true)];
  };
  return (
    <div className="phone">
      <TopBar title="Finish inspection" sub={`${vehicle.year} ${vehicle.model} · RO ${insp.ro}`} back={`#/insp/${id}`} />
      <div className="body">
        {gate.length > 0 ? (
          <div className="dark stack">
            <div className="row" style={{ alignItems: 'flex-start' }}><Icon name="lock" size={22} />
              <div><strong style={{ fontSize: 18 }}>{gate.length} {gate.length === 1 ? 'thing needs' : 'things need'} you first</strong><div className="small" style={{ color: '#C9CDD3' }}>Nothing unconfirmed can reach the advisor or the customer.</div></div>
            </div>
            {[...ai, ...req].slice(0, 30).map((g) => {
              const [a, b] = labelFor(g);
              return (
                <a key={g.kind + g.id} href={hrefFor(g)} className="row" style={{ minHeight: 50, padding: '6px 12px', borderRadius: 10, background: '#26292E', color: 'var(--paper)' }}>
                  <Icon name={g.kind === 'ai_finding' ? 'ai' : g.kind === 'photo' ? 'image' : g.kind === 'wording' ? 'text' : 'na'} />
                  <span className="grow"><span style={{ display: 'block', fontWeight: 600 }}>{a}</span><span className="small" style={{ color: '#B9BDC3' }}>{b}</span></span>
                  <span className="small" style={{ fontWeight: 700, color: '#A9BCF5' }}>Open</span>
                </a>
              );
            })}
            {gate.length > 30 && <span className="small" style={{ color: '#C9CDD3' }}>+ {gate.length - 30} more</span>}
          </div>
        ) : (
          <div className="card pad row"><span className="chip ok"><Icon name="check" size={14} />Ready</span><span>Every required part is rated and every AI item is resolved.</span></div>
        )}
        <h2 className="h2">{sum.total} parts on this car</h2>
        <div className="tiles" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <Tile kind="immediate" n={sum.immediate} label="Immediate" />
          <Tile kind="monitor" n={sum.monitor} label="Monitor" />
          <Tile kind="ok" n={sum.ok} label="OK" />
          <Tile kind="na" n={sum.notChecked} label="Not checked" />
          <Tile kind="na" n={sum.unrated} label="Not rated yet" />
          <Tile kind="ai" n={ai.length} label="AI to review" />
        </div>
      </div>
      <div className="footer">
        {insp.status === 'in_progress' ? (
          <button className="btn primary block" disabled={gate.length > 0} onClick={async () => { if (await actions.submit(id)) go(`/advisor/${id}`); }}>
            {gate.length ? <><Icon name="lock" />Send to advisor</> : 'Send to advisor'}
          </button>
        ) : <a className="btn primary block" href={`#/advisor/${id}`}>Open advisor view</a>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Part history
export function History({ vehicleId, compKeyEnc }: { vehicleId: string; compKeyEnc: string }) {
  const s = useStore((x) => x);
  useVehicleHistory(vehicleId);
  const key = decodeURIComponent(compKeyEnc);
  const v = s.vehicles.find((x) => x.id === vehicleId);
  if (!v) return <Missing />;
  const visits = s.inspections.filter((i) => i.vehicleId === vehicleId && i.status !== 'not_started').sort((a, b) => b.date.localeCompare(a.date));
  const numeric = visits.flatMap((i) => i.results.filter((r) => r.compKey === key && r.value !== null).map((r) => ({ i, r })));
  const unit = numeric[0] ? ONTOLOGY.checks[numeric[0].r.checkKey].unit : null;
  const series = [...numeric].reverse();
  return (
    <div className="phone">
      <TopBar title={compLabel(key)} sub={`${vname(v)} · ${visits.length} visits`} back={`#/vehicle/${vehicleId}`} />
      <div className="body">
        {series.length > 1 && <MiniChart points={series.map(({ i, r }) => ({ label: fmtDate(i.date).replace(/ \d+,/, ''), value: r.value!, rating: r.rating }))} unit={unit} />}
        <section className="card">
          <h2 className="group-h">Visits</h2>
          <div className="list">
            {visits.map((i) => {
              const st = componentState(i, key);
              const vals = i.results.filter((r) => r.compKey === key && r.value !== null).map((r) => `${r.value} ${ONTOLOGY.checks[r.checkKey].unit ?? ''}`);
              const fs = i.findings.filter((f) => f.compKey === key && !isPendingAi(f) && f.status !== 'denied').map((f) => findingLabel(f.key));
              return (
                <div key={i.id} className="item">
                  <div className="grow"><div className="t">{fmtDate(i.date)}</div><div className="d">{fmtMi(i.odometer)} · {i.technician}{[...vals, ...fs].length ? ` · ${[...vals, ...fs].join(', ')}` : ''}</div></div>
                  <StateChip state={st} />
                </div>
              );
            })}
          </div>
        </section>
        <p className="small muted">A later OK never means a repair was done unless a service record says so.</p>
      </div>
    </div>
  );
}

export function MiniChart({ points, unit }: { points: { label: string; value: number; rating: Rating }[]; unit: string | null }) {
  const W = 320, H = 160, pad = 28;
  const max = Math.max(...points.map((p) => p.value)) * 1.15 || 1;
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - 24 - (v / max) * (H - 44);
  const color = { ok: 'var(--ok-bar)', monitor: 'var(--mon-bar)', immediate: 'var(--imm-bar)' };
  return (
    <figure className="card pad" style={{ margin: 0 }}>
      <figcaption className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Measured {unit ? `(${unit})` : ''}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={points.map((p) => `${p.label}: ${p.value}`).join(', ')}>
        <polyline fill="none" stroke="var(--ink)" strokeWidth="2.5" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r="6" fill={color[p.rating]} stroke="var(--ink)" strokeWidth="1.5" />
            <text x={x(i)} y={y(p.value) - 11} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">{p.value}</text>
            <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.label}</text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
