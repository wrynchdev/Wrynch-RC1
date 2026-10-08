// The iOS app's rules, from the same code as the web app. Bundled into ios/Wrynch/Resources/wrynch-domain.js and run
// in JavaScriptCore; Swift calls WrynchCall(name, argsJson) and gets JSON back. Each function returns what one screen
// shows, already worked out (states, labels, counts), so the phone and the web can never rate a part differently.
// Nothing here talks to the network or keeps state beyond the shop's template, rating rules and turned-off checks.
import {
  checkFindingOptions, checkOff, notedFindingOptions, cls, compLabel, findingLabel, ONTOLOGY, parseKey, point as getPoint, pointComponents, positionLabel, sectionOfPoint,
  sections, setDisabledChecks, setTemplate, setThresholds, vehicleComponents, DEFAULT_TEMPLATE, type Threshold,
} from '../../src/domain/ontology';
import { checkFindings, completionGate, componentState, findingRating, isPendingAi, mediaPending, photosOf, summarize } from '../../src/domain/rating';
import { inspectionSteps, nextUnfinished, pointStatus, visibleSections } from '../../src/domain/progress';
import { pointFindingLines } from '../../src/domain/noteDraft';
import { BLANK_CONFIG, quickCheck } from '../../src/domain/seed';
import { SEVERITIES, SIDE_UNSURE_CONFIDENCE } from '../../src/domain/types';
import type { CompKey, ComponentState, Inspection, Media, Rating, Severity, Template, Vehicle, VehicleConfig } from '../../src/domain/types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CORNER_POS = ['left_front', 'right_front', 'left_rear', 'right_rear'];
const photoNames = (m: Media, keys?: CompKey[]) => {
  const links = keys ? m.links.filter((l) => keys.includes(l.compKey)) : m.links;
  const names = links.map((l) => compLabel(l.compKey, true));
  return !names.length ? '' : names.length <= 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} more`;
};

/** Install the shop's template, rating rules and turned-off checks (null template = the standard one). */
export function configure(template: Template | null, thresholds: Threshold[] | null, disabled: { platform: string[]; shop: string[] } | null) {
  setTemplate(template ?? structuredClone(DEFAULT_TEMPLATE));
  setThresholds(thresholds ?? []);
  setDisabledChecks(disabled?.platform ?? [], disabled?.shop ?? []);
  return { points: sections().reduce((a, s) => a + s.points.length, 0), version: ONTOLOGY.version };
}

// ------------------------------------------------------------------ vehicle setup
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

export function setup(insp: Inspection, vehicle: Vehicle) {
  const c = vehicle.config;
  const vc = vehicleComponents(c, insp.extraComponents);
  return {
    rows: CONFIG_ROWS.filter((r) => !r.show || r.show(c)).map((r) => ({
      key: r.key, label: r.label, options: r.options.map(([value, label]) => ({ value, label })), value: String(c[r.key] ?? 'left_front'),
    })),
    flags: CONFIG_FLAGS.map(([key, label]) => ({ key, label, on: !!c[key] })),
    templateName: ONTOLOGY.template.name,
    points: sections().reduce((a, s) => a + s.points.length, 0),
    applies: vc.applies.length,
    na: vc.na.length,
  };
}

// ------------------------------------------------------------------ overview
export function overview(insp: Inspection, vehicle: Vehicle) {
  const sum = summarize(insp, vehicle);
  const gate = completionGate(insp, vehicle);
  const visible = visibleSections(vehicle);
  const all = visible.flatMap((s) => s.points);
  const pointsDone = all.filter((p) => pointStatus(insp, vehicle, p.id).done).length;
  const stages = visible.map((s) => {
    const st = s.points.map((p) => ({ p, st: pointStatus(insp, vehicle, p.id) }));
    const done = st.filter((x) => x.st.done).length;
    const keys = new Set(st.flatMap((x) => x.st.keys));
    const pending = insp.media.filter((m) => m.sectionId === s.id && mediaPending(m)).length
      + insp.findings.filter((f) => isPendingAi(f) && keys.has(f.compKey)).length
      + insp.observations.filter((o) => o.status === 'pending' && keys.has(o.compKey) && componentState(insp, o.compKey) === 'unrated').length;
    return {
      id: s.id, name: s.name, done, total: s.points.length, pending,
      photos: insp.media.filter((m) => m.sectionId === s.id && !m.excluded).length,
      complete: done === s.points.length && pending === 0,
      points: st.map(({ p, st: ps }) => ({
        id: p.id, name: p.name, parts: ps.count, photos: ps.photos, done: ps.done, state: ps.state as string,
        badge: ps.count === 0 ? 'Symptom check' : ps.pendingFindings > 0 ? `${ps.pendingFindings} to review` : ps.pendingOk > 0 && ps.state === 'unrated' ? `${ps.pendingOk} look OK` : null,
        ai: ps.count > 0 && (ps.pendingFindings > 0 || (ps.pendingOk > 0 && ps.state === 'unrated')),
      })),
    };
  });
  return {
    title: `${vehicle.year || ''} ${vehicle.model} ${vehicle.trim}`.trim(),
    subtitle: [insp.ro ? `RO ${insp.ro}` : '', insp.odometer ? `${insp.odometer.toLocaleString('en-US')} mi` : ''].filter(Boolean).join(' · '),
    status: insp.status, locked: insp.status !== 'in_progress',
    summary: sum, aiItems: gate.filter((g) => g.kind !== 'required').length, gateCount: gate.length,
    pointsDone, pointsTotal: all.length, photos: insp.media.filter((m) => !m.excluded).length,
    firstOpenStage: visible.find((s) => !s.points.every((p) => pointStatus(insp, vehicle, p.id).done))?.id ?? visible[0]?.id ?? null,
    // Where Continue inspection goes: the next point not finished yet (or the first point).
    resumePointId: nextUnfinished(insp, vehicle) ?? inspectionSteps(vehicle)[0]?.pointId ?? null,
    stages, dtcs: insp.dtcs.map((d) => d.code),
  };
}

// ------------------------------------------------------------------ point
export function point(insp: Inspection, vehicle: Vehicle, pointId: string) {
  const p = getPoint(pointId);
  const section = sectionOfPoint(pointId);
  const all = pointComponents(p, vehicle.config);
  const comps = all.filter((c) => c.applies);
  const na = all.filter((c) => !c.applies);
  const st = pointStatus(insp, vehicle, pointId);
  const okPending = insp.observations.filter((o) => o.status === 'pending' && st.keys.includes(o.compKey) && componentState(insp, o.compKey) === 'unrated');
  const groups = new Map<string, typeof comps>();
  for (const c of comps) {
    const pos = parseKey(c.key).position;
    const g = pos && CORNER_POS.includes(pos) ? cap(positionLabel(pos)) : 'Whole vehicle';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const photos = insp.media.filter((m) => !m.excluded && (m.links.some((l) => st.keys.includes(l.compKey)) || m.pointId === pointId));
  const n = insp.notes.find((x) => x.pointId === pointId);
  // Wizard order runs across stages, the same as the web app.
  const steps = inspectionSteps(vehicle);
  const idx = steps.findIndex((x) => x.pointId === pointId);
  const prev = idx > 0 ? steps[idx - 1] : null;
  const next = idx >= 0 ? steps[idx + 1] ?? null : null;
  const firstOfStage = idx >= 0 && (idx === 0 || steps[idx - 1].stageId !== section.id);
  return {
    id: p.id, name: p.name, stageId: section.id, stageName: section.name, note: p.note, state: st.state as string,
    partCount: comps.length,
    groups: [...groups.entries()].map(([title, list]) => ({
      title,
      parts: list.map((c) => {
        const pend = insp.findings.filter((f) => f.compKey === c.key && isPendingAi(f));
        const state = componentState(insp, c.key);
        const res = insp.results.filter((r) => r.compKey === c.key && r.value !== null);
        const counted = insp.findings.filter((f) => f.compKey === c.key && !isPendingAi(f) && f.status !== 'denied');
        const okAi = state === 'unrated' && okPending.some((o) => o.compKey === c.key);
        const detail = pend.length ? `AI suggests: ${findingLabel(pend[0].key).toLowerCase()}, ${pend[0].severity}`
          : okAi ? 'AI: looks OK in photo · confirm'
          : [...res.map((r) => `${r.value} ${ONTOLOGY.checks[r.checkKey].unit ?? ''}`.trim()), ...counted.map((f) => `${findingLabel(f.key)}, ${f.severity}`)].join(' · ')
          || (state === 'unrated' ? (c.required ? 'Required' : 'Optional') : 'No findings');
        const name = parseKey(c.key).position && title !== 'Whole vehicle' ? cls(parseKey(c.key).classId).label : compLabel(c.key);
        return { key: c.key, name, detail, state: state as string, badge: pend.length ? 'Review' : okAi ? 'Looks OK?' : null };
      }),
    })),
    notApplicable: { count: na.length, labels: [...new Set(na.map((c) => cls(parseKey(c.key).classId).label))] },
    looksOk: { ids: okPending.map((o) => o.id), parts: [...new Set(okPending.map((o) => compLabel(o.compKey, true)))] },
    unrated: comps.filter((c) => componentState(insp, c.key) === 'unrated').length,
    photos: photos.map((m) => ({
      id: m.id, path: m.url, caption: photoNames(m, st.keys) || 'Not matched yet',
      pending: m.links.some((l) => st.keys.includes(l.compKey) && l.status === 'ai_proposed'),
      firstPart: m.links.find((l) => st.keys.includes(l.compKey))?.compKey ?? null,
    })),
    findingLines: pointFindingLines(insp, vehicle, p).map((x) => ({ id: x.key, text: x.text, rating: x.rating })),
    noteText: n?.techText ?? '', noteStatus: n?.status ?? null,
    nextPoint: next ? { id: next.pointId, name: next.pointName } : null,
    prevPoint: prev ? { id: prev.pointId, name: prev.pointName } : null,
    step: idx + 1, steps: steps.length,
    stagePhotosFirst: firstOfStage && insp.media.every((m) => m.sectionId !== section.id),
    locked: insp.status !== 'in_progress',
  };
}

// ------------------------------------------------------------------ part
export function part(insp: Inspection, _vehicle: Vehicle, key: CompKey) {
  const c = cls(parseKey(key).classId);
  const state = componentState(insp, key);
  const status = insp.statuses.find((s) => s.compKey === key)?.notInspected ?? null;
  const okObs = state === 'unrated' ? insp.observations.filter((o) => o.compKey === key && o.status === 'pending') : [];
  const media = (id: string | null) => insp.media.find((m) => m.id === id)?.url ?? null;
  return {
    key, title: compLabel(key), subtitle: `${cap(c.category.replace(/_/g, ' '))}${c.safety ? ' · safety part' : ''}`,
    state: state as string, notInspected: status, capture: c.capture,
    pendingFindings: insp.findings.filter((f) => f.compKey === key && isPendingAi(f)).map((f) => ({
      id: f.id, key: f.key, label: findingLabel(f.key), severity: f.severity, confidence: f.confidence, rationale: f.rationale,
      photoPath: media(f.mediaId), rating: findingRating(c.id, f.key, f.severity) as string,
    })),
    looksOk: okObs.length ? { ids: okObs.map((o) => o.id), note: okObs[0].note, confidence: okObs[0].confidence } : null,
    // Checks the shop turned off are hidden, unless this inspection already has a result for one.
    checks: c.checks.filter((k) => !checkOff(k) || insp.results.some((r) => r.compKey === key && r.checkKey === k)).map((k) => {
      const ch = ONTOLOGY.checks[k];
      const res = insp.results.find((r) => r.compKey === key && r.checkKey === k);
      return {
        key: k, name: ch.name, how: ch.how, unit: ch.unit, measured: !!ch.auto, basis: ch.basis,
        bands: { ok: ch.bands.ok, monitor: ch.bands.monitor, immediate: ch.bands.immediate },
        ratings: (['ok', 'monitor', 'immediate'] as Rating[]).filter((r) => r === 'ok' || ch.bands[r as 'monitor' | 'immediate']),
        result: res ? { rating: res.rating as string, value: res.value } : null,
        // Rated Monitor or Immediate: the findings that can explain it, with the ones picked (AI ones the tech confirmed can't be unpicked here).
        // A visual check rated OK: cosmetic findings that can be noted without changing the rating.
        findingChoices: res ? (() => {
          const here = checkFindings(insp, key, k);
          const offer = res.rating === 'ok' ? notedFindingOptions(k) : checkFindingOptions(k);
          if (res.rating === 'ok' && !offer.length && !here.length) return [];
          return [...new Set([...offer, ...here.map((f) => f.key)])].map((fk) => {
            const ai = here.some((f) => f.key === fk && f.source === 'ai');
            return { key: fk, label: findingLabel(fk), on: ai || here.some((f) => f.key === fk), ai };
          });
        })() : [],
      };
    }),
    // Part-level findings (older inspections, or an AI finding with no visual check to go under).
    findings: insp.findings.filter((f) => f.compKey === key && !f.checkKey && !isPendingAi(f) && f.status !== 'denied').map((f) => ({
      id: f.id, label: findingLabel(f.key), severity: f.severity, rating: findingRating(c.id, f.key, f.severity) as string,
      source: f.source, status: f.status, removable: f.source === 'technician',
    })),
    findingOptions: Object.keys(c.findings).map((k) => ({
      key: k, label: findingLabel(k), ratings: Object.fromEntries(SEVERITIES.map((s) => [s, findingRating(c.id, k, s)])),
    })),
    photos: photosOf(insp, key).map((m) => ({ id: m.id, path: m.url, pending: m.links.some((l) => l.compKey === key && l.status === 'ai_proposed') })),
    locked: insp.status !== 'in_progress',
  };
}

// ------------------------------------------------------------------ photos: sort and place
const sideUnsure = (l: Media['links'][number]) => l.status === 'ai_proposed' && l.confidence !== null && l.confidence <= SIDE_UNSURE_CONFIDENCE;

export function sort(insp: Inspection, vehicle: Vehicle, sectionId: string) {
  const section = sections().find((s) => s.id === sectionId);
  const media = insp.media.filter((m) => m.sectionId === sectionId && !m.excluded);
  const needs = media.filter((m) => m.links.length === 0);
  const byPoint = visibleSections(vehicle).flatMap((s) => s.points).map((p) => {
    const keys = pointComponents(p, vehicle.config).filter((c) => c.applies).map((c) => c.key);
    return { p, items: media.filter((m) => m.links.some((l) => keys.includes(l.compKey))) };
  }).filter((x) => x.items.length);
  return {
    stageName: section?.name ?? sectionId, total: media.length,
    unread: needs.filter((m) => !m.analyzed).length,
    noneRead: media.length > 0 && media.every((m) => !m.analyzed && m.links.length === 0),
    partsSeen: media.reduce((n, m) => n + m.links.length, 0),
    proposedLinks: media.reduce((n, m) => n + m.links.filter((l) => l.status === 'ai_proposed').length, 0),
    needs: needs.map((m) => ({ id: m.id, path: m.url, analyzed: m.analyzed })),
    points: byPoint.map(({ p, items }) => ({
      id: p.id, name: p.name,
      photos: items.map((m) => {
        const pending = m.links.some((l) => l.status === 'ai_proposed');
        return {
          id: m.id, path: m.url, caption: photoNames(m), pending,
          status: m.links.some(sideUnsure) ? 'AI · check side' : pending ? `AI · ${Math.round(Math.max(...m.links.map((l) => l.confidence ?? 0)) * 100)}% sure` : 'Confirmed',
        };
      }),
    })),
    locked: insp.status !== 'in_progress',
  };
}

export function place(insp: Inspection, vehicle: Vehicle, mediaId: string) {
  const media = insp.media.find((m) => m.id === mediaId)!;
  const stages = visibleSections(vehicle);
  const ordered = [...stages].sort((a, b) => (a.id === media.sectionId ? -1 : b.id === media.sectionId ? 1 : 0));
  const aiKeys = media.links.filter((l) => l.status === 'ai_proposed').map((l) => l.compKey);
  return {
    path: media.url,
    picked: media.links.map((l) => l.compKey),
    aiSaw: media.links.map((l) => {
      const fs = insp.findings.filter((f) => f.mediaId === media.id && f.compKey === l.compKey && isPendingAi(f));
      const o = insp.observations.find((x) => x.mediaId === media.id && x.compKey === l.compKey && x.status === 'pending');
      const what = fs.length ? fs.map((f) => `${findingLabel(f.key).toLowerCase()} (${f.severity})`).join(', ') : o ? 'looks OK' : 'condition unclear';
      const sure = sideUnsure(l) ? ' · side not certain, pick the right one below' : l.status === 'ai_proposed' && l.confidence !== null ? ` · ${Math.round(l.confidence * 100)}% sure it’s this part` : '';
      return { part: compLabel(l.compKey, true), detail: what + sure };
    }),
    groups: ordered.flatMap((s) => s.points.map((p) => ({
      stage: s.name, sameStage: s.id === media.sectionId, point: p.name,
      parts: pointComponents(p, vehicle.config).filter((c) => c.applies).map((c) => ({ key: c.key, label: compLabel(c.key, true), ai: aiKeys.includes(c.key) })),
    }))).filter((g) => g.parts.length),
  };
}

// ------------------------------------------------------------------ finish
export function finish(insp: Inspection, vehicle: Vehicle) {
  const gate = completionGate(insp, vehicle);
  const ready = insp.status === 'in_progress' && !gate.some((g) => g.kind === 'required');
  const items = gate.map((g) => {
    if (g.kind === 'ai_finding') {
      const f = insp.findings.find((x) => x.id === g.id)!;
      return { kind: g.kind, id: g.id, title: 'AI finding', detail: `${compLabel(f.compKey, true)} · ${findingLabel(f.key).toLowerCase()}`, partKey: f.compKey, stageId: null as string | null };
    }
    if (g.kind === 'photo') {
      const m = insp.media.find((x) => x.id === g.id)!;
      return { kind: g.kind, id: g.id, title: 'Photo not confirmed', detail: m.label, partKey: null, stageId: m.sectionId };
    }
    return { kind: g.kind, id: g.id, title: 'Required part not rated', detail: compLabel(g.id, true), partKey: g.id, stageId: null };
  });
  const steps = inspectionSteps(vehicle);
  return {
    gateCount: gate.length, items, summary: summarize(insp, vehicle), aiToReview: gate.filter((g) => g.kind !== 'required').length, ready,
    pointCount: steps.length,
    pointsWithNote: steps.filter((x) => insp.notes.find((n) => n.pointId === x.pointId)?.techText.trim()).length,
    status: insp.status,
  };
}

/** What "Send to advisor" stores with the inspection. */
// The points listed are the ones the service advisor must approve a report note for before sending.
export const summary = (insp: Inspection, vehicle: Vehicle) => ({ ...summarize(insp, vehicle), points: inspectionSteps(vehicle).map((x) => x.pointId) });

/** Parts of a point nobody has rated, flagged or skipped, with the check a "nothing found" OK goes on. */
export function untouched(insp: Inspection, vehicle: Vehicle, pointId: string) {
  return pointComponents(getPoint(pointId), vehicle.config).filter((c) => c.applies
    && !insp.results.some((r) => r.compKey === c.key) && !insp.findings.some((f) => f.compKey === c.key && f.status !== 'denied')
    && !insp.statuses.some((s) => s.compKey === c.key))
    .map((c) => ({ key: c.key, check: quickCheck(parseKey(c.key).classId) }));
}

/** The check a confirmed AI "looks OK" is recorded on, for each observation. */
export function observationChecks(insp: Inspection, ids: string[]) {
  return ids.map((id) => ({ id, check: quickCheck(parseKey(insp.observations.find((o) => o.id === id)!.compKey).classId) }));
}

export const ratingOf = (classId: number, key: string, severity: Severity): ComponentState => findingRating(classId, key, severity);
export const severities = () => SEVERITIES;

/** A new vehicle's setup before the VIN is decoded. */
export const blankConfig = () => BLANK_CONFIG;
