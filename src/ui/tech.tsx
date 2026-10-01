import { useEffect, useRef, useState } from 'react';
import {
  cls, compLabel, findingLabel, ONTOLOGY, parseKey, point as getPoint, pointComponents, positionLabel, sections,
  sectionOfPoint, vehicleComponents,
} from '../domain/ontology';
import { completionGate, componentState, findingRating, isPendingAi, mediaPending, photosOf, summarize } from '../domain/rating';
import type { CompKey, Finding, Inspection, Media, NotInspectedReason, Rating, Severity, Vehicle, VehicleConfig } from '../domain/types';
import { SEVERITIES, SIDE_UNSURE_CONFIDENCE } from '../domain/types';
import { actions, isLive, jobList, noteStyle, photoSrc, toast, useStore, type NoteDraft } from '../state/store';
import { autoNotePoints, NOTE_STYLES } from '../domain/noteDraft';
import { CORNER_LABEL, CORNER_SHORT, CORNERS, type Corner } from '../domain/corner';
import { CameraSheet } from './camera';
import { InspectionClock } from './profile';
import { AiChip, fmtDate, fmtMi, Icon, Sheet, StateChip, Tile, TopBar } from './kit';
import { enc, go, pointStatus, useInspection, useVehicleHistory } from './hooks';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const vname = (v: Vehicle) => `${v.year} ${v.make} ${v.model} ${v.trim}`;
const compHref = (inspId: string, key: CompKey, pointId?: string) => `#/insp/${inspId}/c/${enc(key)}${pointId ? `/${pointId}` : ''}`;

export function Missing() {
  const loading = useStore((x) => x.loading > 0);
  if (loading) return <div className="phone"><div className="body"><p className="muted" role="status">Loading…</p></div></div>;
  return <div className="phone"><TopBar title="Not found" back="#/jobs" /><div className="body"><p>That page doesn't exist, or you don't have access to it.</p></div></div>;
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
                <span className={`chip ${j.status === 'in_progress' ? 'na' : 'ok'}`} style={j.status === 'not_started' ? { background: 'var(--blue-tint)', color: 'var(--blue-text)' } : undefined}>
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
      <TopBar title="Set up vehicle" sub="Before the first photo" back="#/jobs" right={insp.ro ? <span className="mono small muted">RO {insp.ro}</span> : undefined} />
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
          <span className="small" style={{ color: 'var(--text2)' }}>{ONTOLOGY.template.name} · {pointCount} points</span>
          <span className="display" style={{ fontSize: 28 }}>{vc.applies.length} parts to rate on this {vehicle.model || 'vehicle'}</span>
          <span className="small" style={{ color: 'var(--text2)' }}>{vc.na.length} don't apply to this configuration</span>
        </div>
      </div>
      <div className="footer">
        <a className="btn primary block" href={`#/insp/${id}`} onClick={() => { if (insp.status === 'not_started') actions.start(id); }}>{insp.status === 'not_started' ? 'Start inspection' : 'Back to inspection'}</a>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Overview
/** The stage a technician is working in, per inspection (the stage of the last point, capture or photo review opened). */
const workingStage = new Map<string, string>();
export const rememberStage = (inspId: string, sectionId: string) => { workingStage.set(inspId, sectionId); };

export function Overview({ id }: { id: string }) {
  const data = useInspection(id);
  // Only one stage is open at a time. Until the tech picks one, it's the stage they were last working in, or the
  // first stage that isn't finished.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
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
  const firstOpen = visible.find((s) => !s.points.every((p) => pointStatus(insp, vehicle, p.id).done))?.id ?? visible[0]?.id ?? null;
  const remembered = workingStage.get(id);
  const openStage = picked !== undefined ? picked : remembered && visible.some((s) => s.id === remembered) ? remembered : firstOpen;
  const toggle = (sid: string) => { const next = openStage === sid ? null : sid; setPicked(next); if (next) rememberStage(id, next); };
  return (
    <div className="phone">
      <TopBar title={`${vehicle.year} ${vehicle.model} ${vehicle.trim}`.trim()} sub={`${insp.ro ? `RO ${insp.ro} · ` : ''}${fmtMi(insp.odometer)}`} back="#/jobs"
        right={<a className="linkbtn" href={`#/setup/${id}`}>Vehicle</a>} />
      <div className="body">
        {locked && <div className="card pad row"><Icon name="lock" /><span className="grow">Submitted. Changes are locked.</span><a href={`#/advisor/${id}`}>Advisor view</a></div>}
        <div className="card pad stack">
          <div className="row between"><strong>{pointsDone} of {allPoints.length} points done</strong><span className="small muted">{insp.media.filter((m) => !m.excluded).length} photos</span></div>
          <InspectionClock startedAt={insp.startedAt} firstSubmittedAt={insp.firstSubmittedAt} />
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
          const open = s.id === openStage;
          const st = s.points.map((p) => ({ p, st: pointStatus(insp, vehicle, p.id) }));
          const done = st.filter((x) => x.st.done).length;
          const sectionKeys = new Set(st.flatMap((x) => x.st.keys));
          const pend = insp.media.filter((m) => m.sectionId === s.id && mediaPending(m)).length
            + insp.findings.filter((f) => isPendingAi(f) && sectionKeys.has(f.compKey)).length
            + insp.observations.filter((o) => o.status === 'pending' && sectionKeys.has(o.compKey) && componentState(insp, o.compKey) === 'unrated').length;
          const photos = insp.media.filter((m) => m.sectionId === s.id && !m.excluded).length;
          const complete = done === s.points.length && pend === 0;
          return (
            <section key={s.id} className={`card stage${open ? ' open' : ''}`} style={complete ? undefined : { borderColor: 'var(--line)' }}>
              <button type="button" className="pad row stage-head" aria-expanded={open} aria-controls={`stage-${s.id}`} onClick={() => toggle(s.id)}>
                <span className={`chip ${complete ? 'ok' : 'na'}`}>{complete ? <Icon name="check" size={14} stroke={2.6} /> : null}{done}/{s.points.length}</span>
                <span className="grow" style={{ textAlign: 'left' }}><span className="t" style={{ fontWeight: 700, display: 'block' }}>{s.name}</span><span className="small muted">{photos} photos{pend > 0 ? ` · ${pend} AI items to review` : ''}</span></span>
                <Icon name="next" size={20} />
              </button>
              {open && <div id={`stage-${s.id}`}>
              {pend > 0 && <div className="ai-box small" style={{ margin: '0 16px 10px' }}>{pend} AI items wait for you in this stage.</div>}
              <div className="list" style={{ borderTop: '1px solid var(--line2)' }}>
                {st.map(({ p, st: ps }) => (
                  <a key={p.id} className="item" href={`#/insp/${id}/point/${p.id}`}>
                    <div className="grow"><div className="t">{p.name}</div><div className="d">{ps.count} parts{ps.photos ? ` · ${ps.photos} photos` : ''}</div></div>
                    {ps.count === 0 ? <span className="chip na">Symptom check</span> : ps.pendingFindings > 0 ? <AiChip>{ps.pendingFindings} to review</AiChip> : ps.pendingOk > 0 && ps.state === 'unrated' ? <AiChip>{ps.pendingOk} look OK</AiChip> : <StateChip state={ps.state} />}
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
              </div>}
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
  const [corner, setCorner] = useState<Corner | null>(null);
  const [shot, setShot] = useState<Partial<Record<Corner | 'none', number>>>({});
  const [camera, setCamera] = useState(false);
  const snapRef = useRef<HTMLInputElement>(null);
  const section = sections().find((s) => s.id === sectionId);
  if (!data || !section) return <Missing />;
  rememberStage(id, sectionId);
  const toFiles = (fs: File[]) => fs.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f }));
  // Library photos: sorted as before (no corner), then off to the sort screen.
  const add = (files: { url: string; name: string; file?: File }[]) => {
    if (!files.length) return;
    go(`/insp/${id}/sort/${sectionId}`);
    void actions.addPhotos(id, sectionId, files);
  };
  // In-app camera: stay here and keep shooting; each photo carries the corner picked above.
  const snap = (fs: File[]) => {
    if (!fs.length) return;
    setShot((x) => ({ ...x, [corner ?? 'none']: (x[corner ?? 'none'] ?? 0) + fs.length }));
    void actions.addPhotos(id, sectionId, toFiles(fs), undefined, corner);
  };
  const total = Object.values(shot).reduce((a, b) => a + (b ?? 0), 0);
  const counted = (c: Corner | null) => setShot((x) => ({ ...x, [c ?? 'none']: (x[c ?? 'none'] ?? 0) + 1 }));
  // No camera access (old browser, permission denied): use the phone's camera app, one photo per launch.
  const noCamera = () => { setCamera(false); toast('Couldn’t open the camera here, so your phone’s camera app opens instead (one photo at a time).'); snapRef.current?.click(); };
  return (
    <div className="phone" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="topbar" style={{ background: 'var(--paper)', borderColor: 'var(--card2)' }}>
        <a className="iconbtn" style={{ color: 'var(--ink)' }} href={`#/insp/${id}`} aria-label="Close"><Icon name="close" size={22} /></a>
        <div className="grow"><h1>{section.name}</h1><div className="sub" style={{ color: 'var(--text2)' }}>Burst capture · shoot in any order</div></div>
      </div>
      <div className="body">
        <section className="card pad stack corner-pick" aria-labelledby="corner-h">
          <div>
            <strong id="corner-h" style={{ fontSize: 16 }}>Where are you shooting?</strong>
            <div className="small" style={{ color: 'var(--text2)' }}>Tap your corner before you shoot. The AI then only looks for parts at that corner. Left is the driver's side. Leave it off for photos of the whole car or the middle.</div>
          </div>
          <div className="corner-grid" role="group" aria-label="Corner of the vehicle">
            {CORNERS.map((c) => (
              <button key={c} type="button" className={`corner-btn c-${c}`} aria-pressed={corner === c} onClick={() => setCorner(corner === c ? null : c)}>
                <b>{CORNER_SHORT[c]}</b><span>{CORNER_LABEL[c]}</span>{shot[c] ? <i>{shot[c]}</i> : null}
              </button>
            ))}
            <div className="corner-car" aria-hidden="true">
              <span>Front</span>
              <svg viewBox="0 0 60 110" width="54" height="99" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
                <rect x="10" y="6" width="40" height="98" rx="14" />
                <path d="M15 34h30l-3-10H18zM15 80h30l-3 10H18z" />
                <rect x="3" y="18" width="7" height="16" rx="2" fill="currentColor" /><rect x="50" y="18" width="7" height="16" rx="2" fill="currentColor" />
                <rect x="3" y="76" width="7" height="16" rx="2" fill="currentColor" /><rect x="50" y="76" width="7" height="16" rx="2" fill="currentColor" />
              </svg>
            </div>
          </div>
          <input ref={snapRef} className="sr" id="snap" type="file" accept="image/*" capture="environment" multiple
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; snap(fs); }} />
          <button className="btn primary block" onClick={() => setCamera(true)}>
            <Icon name="camera" />{corner ? `Open camera · ${CORNER_LABEL[corner]}` : 'Open camera'}
          </button>
          <span className="small" style={{ color: 'var(--text2)', marginTop: -6 }}>Tap the shutter for each photo or hold it for a burst. You can switch corners without leaving the camera.</span>
          {total > 0 && (
            <div className="row between">
              <span className="small" role="status" style={{ color: 'var(--text2)' }}>{total} {total === 1 ? 'photo' : 'photos'} taken{Object.entries(shot).filter(([k, n]) => n && k !== 'none').length ? ` · ${Object.entries(shot).filter(([k, n]) => n && k !== 'none').map(([k, n]) => `${CORNER_SHORT[k as Corner]} ${n}`).join(', ')}` : ''}</span>
              <a className="btn sm secondary" href={`#/insp/${id}/sort/${sectionId}`}>Done · sort photos</a>
            </div>
          )}
        </section>
        {camera && <CameraSheet inspId={id} sectionId={sectionId} stageName={section.name} corner={corner} onCorner={setCorner}
          onShot={counted} onClose={() => setCamera(false)} onUnavailable={noCamera} />}
        <div className="dropzone" style={{ background: 'var(--card)', borderColor: 'var(--line)', color: 'var(--ink)', minHeight: 160, justifyContent: 'center' }}>
          <Icon name="image" size={32} />
          <strong style={{ fontSize: 16 }}>Already took them? Pick from your photos</strong>
          <span className="small" style={{ color: 'var(--text2)', maxWidth: 320 }}>Pick every photo for this stage at once. Wrynch sorts them onto parts; nothing it suggests counts until you confirm.</span>
          <input ref={fileRef} className="sr" id="files" type="file" accept="image/*" multiple
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(toFiles(fs)); }} />
          <label htmlFor="files" className="btn secondary" style={{ cursor: 'pointer' }}>Choose photos</label>
          {!isLive() && <button className="btn sm" style={{ background: 'var(--card2)', color: 'var(--ink)' }} onClick={() => add(actions.samplePhotos(sectionId, 12))}>No photos handy? Use 12 sample photos</button>}
        </div>
        <div className="small" style={{ color: 'var(--text2)' }}>What to capture in {section.name.toLowerCase()}:</div>
        <ul className="small" style={{ color: 'var(--text2)', margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          {section.points.slice(0, 8).map((p) => <li key={p.id}>{p.name}</li>)}
          {section.points.length > 8 && <li>+ {section.points.length - 8} more</li>}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Sort photos
const pct = (n: number | null) => `${Math.round((n ?? 0) * 100)}%`;
const sideUnsure = (l: Media['links'][number]) => l.status === 'ai_proposed' && l.confidence !== null && l.confidence <= SIDE_UNSURE_CONFIDENCE;
function linkSummary(m: Media): string {
  if (!m.links.length) return m.analyzed ? 'AI couldn’t identify a part' : 'Not placed yet';
  const names = m.links.map((l) => compLabel(l.compKey, true));
  return names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more`;
}

export function Sort({ id, sectionId }: { id: string; sectionId: string }) {
  const data = useInspection(id);
  const busy = useStore((x) => x.busy);
  const ai = useStore((x) => x.ai);
  const mode = useStore((x) => x.mode);
  const [placing, setPlacing] = useState<string | null>(null);
  const section = sections().find((s) => s.id === sectionId);
  if (!data || !section) return <Missing />;
  rememberStage(id, sectionId);
  const { insp, vehicle } = data;
  const media = insp.media.filter((m) => m.sectionId === sectionId && !m.excluded);
  const needs = media.filter((m) => m.links.length === 0);
  const unread = needs.filter((m) => !m.analyzed).length;
  const shopAi = useStore((x) => x.shopAi);
  const aiOff = mode === 'live' && ai !== null && !ai.on && !shopAi?.configured;
  const proposedLinks = media.reduce((n, m) => n + m.links.filter((l) => l.status === 'ai_proposed').length, 0);
  const partsSeen = media.reduce((n, m) => n + m.links.length, 0);
  // A photo appears under every point whose parts it shows, including points in other stages.
  const byPoint = visibleSections(vehicle).flatMap((s) => s.points).map((p) => {
    const keys = pointComponents(p, vehicle.config).filter((c) => c.applies).map((c) => c.key);
    return { p, items: media.filter((m) => m.links.some((l) => keys.includes(l.compKey))) };
  }).filter((x) => x.items.length);
  const placingMedia = insp.media.find((m) => m.id === placing) ?? null;
  return (
    <div className="phone">
      <TopBar title="Sort photos" sub={`${section.name} · ${media.length} photos`} back={`#/insp/${id}`} />
      <div className="body">
        {media.length === 0 ? (
          <div className="card pad stack">
            <strong>{busy ? 'Working on your photos…' : 'No photos yet'}</strong>
            {!busy && <a className="btn primary" href={`#/insp/${id}/capture/${sectionId}`}><Icon name="camera" />Capture this stage</a>}
          </div>
        ) : !aiOff && media.every((m) => !m.analyzed && m.links.length === 0) && mode === 'live' ? (
          <div className="ai-box row" style={{ alignItems: 'flex-start' }} role="status">
            <Icon name="ai" />
            <span className="small"><strong>{busy ? 'The AI is reading these photos…' : 'The AI hasn’t read these photos yet.'}</strong>{!busy && ' Tap “Sort with AI” below, or place them by hand.'}</span>
          </div>
        ) : aiOff ? (
          <div className="card pad small" role="status">
            <strong>AI photo sorting isn’t set up for this shop yet.</strong> Tap <em>Place</em> on each photo to pick the parts it shows.
          </div>
        ) : (
          <div className="ai-box row" style={{ alignItems: 'flex-start' }}>
            <Icon name="ai" />
            <span className="small"><strong>AI found {partsSeen} parts in {media.length - needs.length} of {media.length} photos</strong> and noted the condition of each.
              A photo can show several parts and counts for each of their points. Dashed = not confirmed yet; “check side” = right part, side not certain. Tap a photo to change its parts.
              {mode === 'demo' && ' (Demo: suggestions are simulated, not read from the photo.)'}</span>
          </div>
        )}
        {needs.length > 0 && (
          <section className="stack">
            <div className="row between">
              <h2 className="h2">Needs you · {needs.length}</h2>
              {mode === 'live' && !aiOff && unread > 0 && !busy && (
                <button className="btn sm secondary" onClick={() => actions.sortWithAi(id, sectionId)}><Icon name="ai" size={16} />Sort {unread} with AI</button>
              )}
            </div>
            {needs.map((m) => (
              <div key={m.id} className="card row" style={{ padding: 10 }}>
                <img src={photoSrc(m.url)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                <div className="grow"><div className="t" style={{ fontWeight: 600 }}>{m.analyzed ? 'AI couldn’t tell' : 'Not sorted yet'}</div><div className="small muted">Pick the parts it shows</div></div>
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
              {items.map((m) => {
                const pending = m.links.some((l) => l.status === 'ai_proposed');
                const checkSide = m.links.some(sideUnsure);
                return (
                  <button key={m.id} className={`thumb${pending ? ' pending' : ''}`} onClick={() => setPlacing(m.id)} aria-label={`Photo showing ${linkSummary(m)}. Tap to change.`}>
                    <img src={photoSrc(m.url)} alt="" />
                    <span className="t">{linkSummary(m)}</span>
                    <span className="c" style={pending ? undefined : { color: 'var(--ok)' }}>{checkSide ? 'AI · check side' : pending ? `AI · ${pct(Math.max(...m.links.map((l) => l.confidence ?? 0)))} sure` : 'Confirmed'}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {media.length > 0 && (
        <div className="footer">
          <a className="btn quiet" href={`#/insp/${id}/capture/${sectionId}`} aria-label="Add photos"><Icon name="camera" /></a>
          <button className="btn primary grow" disabled={proposedLinks === 0} onClick={() => actions.confirmPlacements(id, sectionId)}>
            {proposedLinks ? `Confirm ${proposedLinks} AI part matches` : 'All matches confirmed'}
          </button>
        </div>
      )}
      {placingMedia && <PlaceSheet insp={insp} vehicle={vehicle} media={placingMedia} onClose={() => setPlacing(null)} />}
    </div>
  );
}

/** Choose every part a photo shows. Parts are grouped by inspection point; a part can sit in several points. */
function PlaceSheet({ insp, vehicle, media, onClose }: { insp: Inspection; vehicle: Vehicle; media: Media; onClose: () => void }) {
  const [picked, setPicked] = useState<CompKey[]>(media.links.map((l) => l.compKey));
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const aiKeys = media.links.filter((l) => l.status === 'ai_proposed').map((l) => l.compKey);
  const stages = visibleSections(vehicle);
  const ordered = [...stages].sort((a, b) => (a.id === media.sectionId ? -1 : b.id === media.sectionId ? 1 : 0));
  const groups = ordered.flatMap((s) => s.points.map((p) => ({
    stage: s.name, p, keys: pointComponents(p, vehicle.config).filter((c) => c.applies).map((c) => c.key),
  }))).filter((g) => g.keys.length);
  const match = (k: CompKey) => !q.trim() || compLabel(k).toLowerCase().includes(q.trim().toLowerCase());
  const visible = groups.map((g) => ({ ...g, keys: g.keys.filter(match) }))
    .filter((g) => g.keys.length && (showAll || q.trim() || g.stage === ordered[0].name || g.keys.some((k) => picked.includes(k))));
  const toggle = (k: CompKey) => setPicked((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const obsFor = (k: CompKey) => insp.observations.find((o) => o.mediaId === media.id && o.compKey === k && o.status === 'pending');
  const findFor = (k: CompKey) => insp.findings.filter((f) => f.mediaId === media.id && f.compKey === k && isPendingAi(f));
  return (
    <Sheet title="Parts in this photo" onClose={onClose}>
      <img src={photoSrc(media.url)} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 12 }} />
      {media.links.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">What the AI saw</span>
          {media.links.map((l) => {
            const o = obsFor(l.compKey);
            const fs = findFor(l.compKey);
            return (
              <div key={l.compKey} className="small row" style={{ alignItems: 'flex-start' }}>
                <Icon name="ai" size={14} />
                <span><strong>{compLabel(l.compKey, true)}</strong> · {fs.length ? fs.map((f) => `${findingLabel(f.key).toLowerCase()} (${f.severity})`).join(', ') : o ? 'looks OK' : 'condition unclear'}
                  {sideUnsure(l) ? ' · side not certain, pick the right one below' : l.status === 'ai_proposed' && l.confidence !== null ? ` · ${pct(l.confidence)} sure it’s this part` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
      <label className="sr" htmlFor="partq">Search parts</label>
      <input id="partq" className="input" placeholder="Search parts (e.g. strut, LF tire)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="stack" style={{ gap: 12, maxHeight: '40vh', overflowY: 'auto' }}>
        {visible.map((g) => (
          <div key={g.p.id} className="stack" style={{ gap: 6 }}>
            <span className="label">{g.p.name}{g.stage !== ordered[0].name ? ` · ${g.stage}` : ''}</span>
            <div className="pills">
              {g.keys.map((k) => (
                <button key={k} className="pill" aria-pressed={picked.includes(k)} style={aiKeys.includes(k) && picked.includes(k) ? { outline: '2px dashed var(--ai-line)', outlineOffset: 2 } : undefined}
                  onClick={() => toggle(k)}>{compLabel(k, true)}</button>
              ))}
            </div>
          </div>
        ))}
        {!showAll && !q.trim() && <button className="linkbtn" style={{ textAlign: 'left' }} onClick={() => setShowAll(true)}>Show parts from other stages</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Removing a part also drops what the AI suggested about it from this photo.</p>
      <div className="row">
        <button className="btn quiet" onClick={() => { actions.excludePhoto(insp.id, media.id); onClose(); }}>Exclude photo</button>
        <button className="btn primary grow" disabled={picked.length === 0} onClick={() => { actions.setPhotoParts(insp.id, media.id, picked); onClose(); }}>
          {picked.length ? `Save ${picked.length} ${picked.length === 1 ? 'part' : 'parts'}` : 'Pick at least one part'}
        </button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Point
export function PointView({ id, pointId }: { id: string; pointId: string }) {
  const data = useInspection(id);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  useEffect(() => { setDraft(null); setNote(null); }, [id, pointId]); // a draft belongs to one point
  const makeDraft = async () => {
    setDrafting(true);
    try { setDraft(await actions.draftNote(id, pointId)); } catch (e) { toast(e instanceof Error ? e.message : 'Couldn’t write a draft', 'error'); } finally { setDrafting(false); }
  };
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  let p;
  try { p = getPoint(pointId); } catch { return <Missing />; }
  const section = sectionOfPoint(pointId);
  rememberStage(id, section.id);
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
  const photos = insp.media.filter((m) => !m.excluded && (m.links.some((l) => st.keys.includes(l.compKey)) || m.pointId === pointId));
  const pendingHere = photos.some((m) => m.links.some((l) => st.keys.includes(l.compKey) && l.status === 'ai_proposed'));
  const addHere = (fs: File[]) => { if (fs.length) void actions.addPhotos(id, section.id, fs.map((f) => ({ url: URL.createObjectURL(f), name: f.name, file: f })), pointId); };
  const okPending = insp.observations.filter((o) => o.status === 'pending' && st.keys.includes(o.compKey) && componentState(insp, o.compKey) === 'unrated');
  const n = insp.notes.find((x) => x.pointId === pointId);
  const noteText = note ?? n?.techText ?? '';
  const idx = section.points.findIndex((x) => x.id === pointId);
  const nextP = section.points[idx + 1];
  const locked = insp.status !== 'in_progress';
  const unrated = comps.filter((c) => componentState(insp, c.key) === 'unrated').length;
  return (
    <div className="phone">
      <TopBar title={p.name} sub={`${section.name} · ${comps.length} parts`} back={`#/insp/${id}`}
        right={!locked && comps.length > 0 ? (
          <label className="iconbtn" htmlFor="point-files" title="Add photos for this point" aria-label={`Add photos for ${p.name}`} style={{ cursor: 'pointer' }}>
            <Icon name="camera" size={22} />
          </label>
        ) : undefined} />
      {!locked && comps.length > 0 && (
        <input id="point-files" className="sr" type="file" accept="image/*" multiple
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; addHere(fs); }} />
      )}
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
                const okAi = state === 'unrated' && okPending.some((o) => o.compKey === c.key);
                const detail = pend.length ? `AI suggests: ${findingLabel(pend[0].key).toLowerCase()}, ${pend[0].severity}`
                  : okAi ? 'AI: looks OK in photo · confirm'
                  : [...res.map((r) => `${r.value} ${ONTOLOGY.checks[r.checkKey].unit ?? ''}`.trim()), ...counted.map((f) => `${findingLabel(f.key)}, ${f.severity}`)].join(' · ')
                  || (state === 'unrated' ? (c.required ? 'Required' : 'Optional') : 'No findings');
                const name = parseKey(c.key).position && g !== 'Whole vehicle' ? cls(parseKey(c.key).classId).label : compLabel(c.key);
                return (
                  <a key={c.key} className={`item${pend.length || okAi ? ' pending' : ''}`} href={compHref(id, c.key, pointId)}>
                    <div className="grow"><div className="t">{name}</div><div className="d" style={pend.length || okAi ? { color: 'var(--ai)' } : undefined}>{detail}</div></div>
                    {pend.length ? <AiChip>Review</AiChip> : okAi ? <AiChip>Looks OK?</AiChip> : <StateChip state={state} />}
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
        {!locked && okPending.length > 0 && (
          <div className="ai-box stack" style={{ gap: 8 }}>
            <span className="small"><Icon name="ai" size={14} /> <strong>AI thinks {okPending.length} {okPending.length === 1 ? 'part looks' : 'parts look'} OK</strong> in the photos:{' '}
              {[...new Set(okPending.map((o) => compLabel(o.compKey, true)))].join(', ')}. Nothing counts until you confirm.</span>
            <div className="row">
              <button className="btn sm primary grow" onClick={() => actions.reviewObservations(id, 'confirm', okPending.map((o) => o.id))}>Confirm looks OK</button>
              <button className="btn sm quiet" onClick={() => actions.reviewObservations(id, 'reject', okPending.map((o) => o.id))}>Dismiss</button>
            </div>
          </div>
        )}
        {!locked && unrated > 0 && (
          <button className="btn quiet" onClick={() => actions.markPointOk(id, pointId)}>
            <Icon name="check" />Nothing found on the other {unrated} {unrated === 1 ? 'part' : 'parts'}
          </button>
        )}
        {(photos.length > 0 || (!locked && comps.length > 0)) && (
          <section className="stack">
            <div className="row between">
              <h2 className="h2">Photos · {photos.length}</h2>
              {!locked && comps.length > 0 && (
                <label htmlFor="point-files" className="btn sm secondary" style={{ cursor: 'pointer' }}><Icon name="camera" size={18} />Add photos</label>
              )}
            </div>
            {!photos.length && <p className="small muted" style={{ margin: 0 }}>Photos added here are matched only to this point's parts.</p>}
            {pendingHere && <a className="small" href={`#/insp/${id}/sort/${section.id}`}>Review the AI's photo matches</a>}
            {photos.length > 0 && <div className="thumbs">
              {photos.map((m) => {
                const here = m.links.filter((l) => st.keys.includes(l.compKey));
                const names = here.map((l) => compLabel(l.compKey, true));
                return (
                  <a key={m.id} className={`thumb${here.some((l) => l.status === 'ai_proposed') ? ' pending' : ''}`} href={here.length ? compHref(id, here[0].compKey, pointId) : `#/insp/${id}/sort/${section.id}`}>
                    <img src={photoSrc(m.url)} alt={names.length ? `Photo of ${names.join(', ')}` : `Photo for ${p.name}, not matched to a part yet`} />
                    <span className="t">{!names.length ? 'Not matched yet' : names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more`}</span>
                    {m.links.length > here.length && <span className="c">Also used in {m.links.length - here.length} other {m.links.length - here.length === 1 ? 'part' : 'parts'}</span>}
                  </a>
                );
              })}
            </div>}
          </section>
        )}
        <section className="card pad stack">
          <label className="label" htmlFor="note">Your note</label>
          <span className="small muted" style={{ marginTop: -6 }}>The customer sees this note as written, unless you approve a reworded version.</span>
          <textarea id="note" className="input" rows={2} value={noteText} disabled={locked}
            onChange={(e) => setNote(e.target.value)} onBlur={() => note !== null && actions.setNote(id, pointId, note)} />
          {!locked && !draft && (
            <button type="button" className="ai-draft" disabled={drafting} onClick={makeDraft}
              aria-label="Write this note with AI from the confirmed ratings and photos">
              <span className="ic"><Icon name="ai" size={18} /></span>
              <span>{drafting ? 'Writing a draft…' : noteText.trim() ? 'Redraft with AI' : 'Draft note with AI'}</span>
              <span className="small muted hide-sm">From your ratings and confirmed photos</span>
            </button>
          )}
          {draft && (
            <div className="ai-card stack" role="region" aria-label="AI draft note">
              <div className="row between">
                <span className="row" style={{ gap: 6, fontWeight: 700, color: 'var(--ai)' }}><Icon name="ai" />{draft.source === 'ai' ? 'AI draft' : 'Draft from your ratings'}</span>
                <span className="chip ai">Not your note yet</span>
              </div>
              <label className="sr" htmlFor="draft">Edit the draft</label>
              <textarea id="draft" className="input" rows={4} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              <span className="small muted">
                Based on {draft.basis.parts} rated {draft.basis.parts === 1 ? 'part' : 'parts'}{draft.basis.photos ? ` and ${draft.basis.photos} confirmed ${draft.basis.photos === 1 ? 'photo' : 'photos'}` : ''}.
                {draft.source === 'rules' && isLive() ? ' The AI wasn’t available, so this was written from your ratings.' : ''} Check it and edit anything before you use it.
              </span>
              <div className="row">
                <button className="btn primary grow" disabled={!draft.text.trim()} onClick={() => {
                  actions.setNote(id, pointId, draft.text.trim()); setNote(draft.text.trim()); setDraft(null);
                }}><Icon name="check" size={18} />{noteText.trim() ? 'Replace my note' : 'Use this note'}</button>
                <button className="btn quiet" onClick={() => setDraft(null)}>Discard</button>
              </div>
            </div>
          )}
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
  const photos = photosOf(insp, key);
  const okObs = state === 'unrated' ? insp.observations.filter((o) => o.compKey === key && o.status === 'pending') : [];
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

        {okObs.length > 0 && (
          <div className="ai-box stack" style={{ gap: 8 }}>
            <span className="small"><Icon name="ai" size={14} /> <strong>AI: looks OK in {okObs.length === 1 ? 'the photo' : `${okObs.length} photos`}</strong>
              {okObs[0].note ? ` · ${okObs[0].note}` : ''}{okObs[0].confidence !== null ? ` · ${Math.round(okObs[0].confidence * 100)}% sure` : ''}</span>
            {!locked && (
              <div className="row">
                <button className="btn sm primary grow" onClick={() => actions.reviewObservations(id, 'confirm', okObs.map((o) => o.id))}>Confirm OK</button>
                <button className="btn sm quiet" onClick={() => actions.reviewObservations(id, 'reject', okObs.map((o) => o.id))}>Not right</button>
              </div>
            )}
          </div>
        )}

        {photos.length > 0 && (
          <div className="thumbs">{photos.map((m) => (
            <figure key={m.id} className={`thumb${m.links.some((l) => l.compKey === key && l.status === 'ai_proposed') ? ' pending' : ''}`} style={{ margin: 0 }}>
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
        <p className="small muted" style={{ margin: 0 }}>AI may only reword your note, or draft one from your confirmed ratings when it's blank. The customer sees nothing until you approve it.</p>
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
  const role = useStore((x) => x.workspace?.role ?? null);
  const style = useStore(() => noteStyle());
  const [tried] = useState(() => new Set<string>());
  const [writing, setWriting] = useState<{ done: number; total: number; failed: number } | null>(null);
  const ready = !!data && data.insp.status === 'in_progress' && !completionGate(data.insp, data.vehicle).some((g) => g.kind === 'required');
  const todo = ready ? autoNotePoints(data!.insp, data!.vehicle, sections().flatMap((s) => s.points)).filter((x) => !tried.has(x.pointId)) : [];
  const todoKey = todo.map((x) => x.pointId).join(',');
  // Once every required part is rated, write the automatic notes: reword the tech's notes, draft the blank ones.
  useEffect(() => {
    if (!todoKey || writing) return;
    const ids = todoKey.split(',');
    ids.forEach((x) => tried.add(x));
    setWriting({ done: 0, total: ids.length, failed: 0 });
    void actions.autoNotes(id, ids, (done) => setWriting((w) => (w ? { ...w, done } : w)))
      .then((failed) => { setWriting(null); if (failed) toast(`${failed} note${failed === 1 ? '' : 's'} couldn’t be written automatically; the technician’s own note stays.`, 'error'); });
  }, [todoKey, writing, id]);
  if (!data) return <Missing />;
  const { insp, vehicle } = data;
  const gate = completionGate(insp, vehicle);
  const sum = summarize(insp, vehicle);
  const ai = gate.filter((g) => g.kind !== 'required' && g.kind !== 'wording');
  const req = gate.filter((g) => g.kind === 'required');
  const notes = insp.notes.filter((n) => n.status === 'ai_suggested' && n.aiText);
  const hrefFor = (g: (typeof gate)[number]) => {
    if (g.kind === 'ai_finding') { const f = insp.findings.find((x) => x.id === g.id)!; return compHref(id, f.compKey); }
    if (g.kind === 'photo') return `#/insp/${id}/sort/${insp.media.find((m) => m.id === g.id)!.sectionId}`;
    if (g.kind === 'wording') return `#/insp/${id}/wording/${g.id}`;
    return compHref(id, g.id);
  };
  const labelFor = (g: (typeof gate)[number]) => {
    if (g.kind === 'ai_finding') { const f = insp.findings.find((x) => x.id === g.id)!; return [`AI finding`, `${compLabel(f.compKey, true)} · ${findingLabel(f.key).toLowerCase()}`]; }
    if (g.kind === 'photo') return ['Photo not confirmed', insp.media.find((m) => m.id === g.id)!.label];
    if (g.kind === 'wording') return ['Note to approve', getPoint(g.id).name];
    return ['Required part not rated', compLabel(g.id, true)];
  };
  const others = [...ai, ...req];
  return (
    <div className="phone">
      <TopBar title="Finish inspection" sub={`${vehicle.year} ${vehicle.model} · RO ${insp.ro}`} back={`#/insp/${id}`} />
      <div className="body">
        {gate.length > 0 ? (
          <div className="dark stack">
            <div className="row" style={{ alignItems: 'flex-start' }}><Icon name="lock" size={22} />
              <div><strong style={{ fontSize: 18 }}>{gate.length} {gate.length === 1 ? 'thing needs' : 'things need'} you first</strong><div className="small" style={{ color: 'var(--text2)' }}>Nothing unconfirmed can reach the advisor or the customer.</div></div>
            </div>
            {notes.length > 0 && <span className="small" style={{ color: 'var(--text2)' }}>{notes.length} automatic note{notes.length === 1 ? '' : 's'} to approve below.</span>}
            {others.slice(0, 30).map((g) => {
              const [a, b] = labelFor(g);
              return (
                <a key={g.kind + g.id} href={hrefFor(g)} className="row" style={{ minHeight: 50, padding: '6px 12px', borderRadius: 10, background: 'var(--card2)', color: 'var(--ink)' }}>
                  <Icon name={g.kind === 'ai_finding' ? 'ai' : g.kind === 'photo' ? 'image' : g.kind === 'wording' ? 'text' : 'na'} />
                  <span className="grow"><span style={{ display: 'block', fontWeight: 600 }}>{a}</span><span className="small" style={{ color: 'var(--text2)' }}>{b}</span></span>
                  <span className="small" style={{ fontWeight: 700, color: 'var(--blue-text)' }}>Open</span>
                </a>
              );
            })}
            {others.length > 30 && <span className="small" style={{ color: 'var(--text2)' }}>+ {others.length - 30} more</span>}
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
          <Tile kind="ai" n={ai.length + notes.length} label="AI to review" />
        </div>
        {(writing || notes.length > 0 || (insp.status === 'in_progress' && ready)) && (
          <section className="card pad stack auto-notes" aria-label="Automatic notes">
            <div className="row between" style={{ flexWrap: 'wrap' }}>
              <h2 className="h2" style={{ margin: 0 }}><Icon name="ai" /> Automatic notes</h2>
              <span className="small muted">Style: <strong>{NOTE_STYLES[style]}</strong>{role === 'owner' && <> · <a href="#/settings">Change</a></>}</span>
            </div>
            {writing ? <p className="small muted" style={{ margin: 0 }} role="status">Writing notes… {writing.done} of {writing.total}</p>
              : notes.length ? <p className="small muted" style={{ margin: 0 }}>Blank notes were drafted from your confirmed ratings and photos; your notes were reworded, keeping every measurement. Nothing reaches the advisor or the customer until you approve it.</p>
              : <p className="small muted" style={{ margin: 0 }}>All notes are reviewed.</p>}
            {!writing && notes.length > 1 && (
              <button className="btn secondary" onClick={() => { for (const n of notes) actions.resolveWording(id, n.pointId, 'accept'); }}>
                <Icon name="check" size={18} />Approve all {notes.length} as written
              </button>
            )}
            {notes.map((n) => <NoteReview key={n.pointId} inspId={id} note={n} />)}
          </section>
        )}
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

function NoteReview({ inspId, note }: { inspId: string; note: Inspection['notes'][number] }) {
  const [text, setText] = useState(note.aiText ?? '');
  useEffect(() => setText(note.aiText ?? ''), [note.aiText]);
  const changed = text.trim() !== (note.aiText ?? '').trim();
  const p = getPoint(note.pointId);
  return (
    <div className="ai-card stack note-review" data-point={note.pointId}>
      <div className="row between"><strong>{p.name}</strong><span className="chip ai">{note.techText.trim() ? 'Reworded' : 'Drafted'} · not approved</span></div>
      {note.techText.trim() && <p className="small muted mono" style={{ margin: 0 }}>Your note: {note.techText}</p>}
      <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Automatic note for ${p.name}`} />
      <div className="row">
        <button className="btn quiet" onClick={() => actions.resolveWording(inspId, note.pointId, 'reject')}>{note.techText.trim() ? 'Keep mine' : 'Skip'}</button>
        <button className="btn primary grow" disabled={!text.trim()} onClick={() => actions.resolveWording(inspId, note.pointId, changed ? { text: text.trim() } : 'accept')}>{changed ? 'Approve edit' : 'Approve'}</button>
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
