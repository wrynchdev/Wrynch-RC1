// Drafting a technician note for one inspection point from what has been confirmed on it.
// Only confirmed facts count: the tech's ratings and measurements, findings the tech entered or confirmed,
// photos whose parts the tech confirmed, and parts the tech marked as not checked. Pending AI output is ignored.
// A draft is only a suggestion: it becomes the note when the technician approves it.
import { compLabel, findingLabel, ONTOLOGY, pointComponents } from './ontology';
import { inspectionSteps } from './progress';
import { checkFindings, componentState, countsFinding, linkConfirmed } from './rating';
import type { ComponentState, Inspection, PointNote, TemplatePoint, Vehicle } from './types';

export interface PartFacts {
  key: string; label: string; state: ComponentState;
  measurements: string[]; checks: string[]; findings: string[];
  notChecked: string | null; photos: number;
}
/** partCount: parts that apply at this point on this vehicle; templateParts: parts the point lists at all (0 = symptom-only point). */
export interface PointFacts { point: string; parts: PartFacts[]; photoIds: string[]; partCount: number; templateParts: number }
/** How automatic notes read: plain language for the vehicle owner, or shop terminology for the advisor. Set per shop by the owner. */
export type NoteStyle = 'customer' | 'technical';
export const NOTE_STYLES: Record<NoteStyle, string> = { customer: 'Customer-friendly', technical: 'Technical' };


const REASON: Record<string, string> = {
  not_accessible: 'not accessible', not_performed_this_visit: 'not done this visit', blocked_by_other_condition: 'blocked by another problem',
  vehicle_not_road_tested: 'not road tested', customer_declined: 'customer declined', unsafe_to_inspect: 'unsafe to inspect',
};
export const unitText = (checkKey: string, value: number) => {
  const u = ONTOLOGY.checks[checkKey]?.unit ?? null;
  return u === '/32 in' ? `${value}/32 in` : `${value} ${u ?? ''}`.trim();
};
const RATING: Record<string, string> = { ok: 'OK', monitor: 'monitor', immediate: 'immediate attention' };

export function pointFacts(insp: Inspection, vehicle: Vehicle, point: TemplatePoint): PointFacts {
  const parts: PartFacts[] = [];
  const photoIds = new Set<string>();
  const applying = pointComponents(point, vehicle.config).filter((x) => x.applies);
  for (const c of applying) {
    const key = c.key;
    const state = componentState(insp, key);
    const results = insp.results.filter((r) => r.compKey === key);
    const measurements = results.filter((r) => r.value !== null).map((r) => `${ONTOLOGY.checks[r.checkKey]?.name ?? r.checkKey} ${unitText(r.checkKey, r.value!)}`);
    // Each check with its rating and, when it's Monitor or Immediate, the findings that explain it.
    const why = (checkKey: string) => checkFindings(insp, key, checkKey).map((f) => findingLabel(f.key).toLowerCase());
    const checks = results.filter((r) => r.value === null).map((r) => {
      const w = r.rating === 'ok' ? [] : why(r.checkKey);
      return `${ONTOLOGY.checks[r.checkKey]?.name ?? r.checkKey}: ${RATING[r.rating] ?? r.rating}${w.length ? ` (${w.join(', ')})` : ''}`;
    });
    const measuredWhy = results.filter((r) => r.value !== null && r.rating !== 'ok').flatMap((r) => why(r.checkKey));
    const findings = [
      ...measuredWhy.map((x) => `${x} (${state === 'immediate' ? 'severe' : 'moderate'})`),
      ...insp.findings.filter((f) => f.compKey === key && !f.checkKey && countsFinding(f)).map((f) => `${findingLabel(f.key).toLowerCase()} (${f.severity})`),
    ];
    const st = insp.statuses.find((x) => x.compKey === key)?.notInspected;
    const photos = insp.media.filter((m) => linkConfirmed(m, key));
    photos.forEach((m) => photoIds.add(m.id));
    if (state === 'unrated' && !photos.length) continue;
    parts.push({ key, label: compLabel(key), state, measurements, checks, findings, notChecked: st ? REASON[st.reason] ?? st.reason.replace(/_/g, ' ') : null, photos: photos.length });
  }
  return { point: point.name, parts, photoIds: [...photoIds], partCount: applying.length, templateParts: point.components.length };
}

/** Plain-text summary of the facts, for the AI prompt and for checking its numbers. */
export function factsText(f: PointFacts): string {
  return f.parts.map((p) => {
    const bits = [p.state === 'unrated' ? 'not rated yet' : p.notChecked ? `not checked (${p.notChecked})` : `rated ${RATING[p.state] ?? p.state}`,
      ...p.measurements, ...p.checks, ...p.findings.map((x) => `finding: ${x}`), p.photos ? `${p.photos} confirmed photo${p.photos === 1 ? '' : 's'}` : ''];
    return `- ${p.label}: ${bits.filter(Boolean).join('; ')}`;
  }).join('\n');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** "Brake fluid copper content 210 ppm" on the part "Brake fluid" reads as "copper content 210 ppm". */
const tidy = (label: string, m: string) => {
  const base = label.split(' · ')[0];
  return m.toLowerCase().startsWith(base.toLowerCase() + ' ') ? m.slice(base.length + 1) : lower(m);
};

/** Rules-based draft (used without an AI key, in the demo, and when an AI draft fails the number check). */
export function draftNote(f: PointFacts, style: NoteStyle = 'technical'): string {
  const plain = style === 'customer';
  // Nothing rated: a symptom-only point with no note means nothing was noticed; otherwise it wasn't checked.
  if (!f.parts.length) {
    if (f.templateParts === 0) return plain ? 'No concerns were noticed here.' : 'No concerns noted.';
    if (f.partCount === 0) return plain ? 'This doesn\'t apply to your vehicle.' : 'Not applicable to this vehicle.';
    return plain ? 'We didn\'t check this on this visit.' : 'Not checked this visit.';
  }
  const out: string[] = [];
  for (const state of ['immediate', 'monitor'] as const) {
    for (const p of f.parts.filter((x) => x.state === state)) {
      const fromChecks = p.checks.filter((c) => !/: OK$/.test(c)).map((c) => (plain ? c.replace(/^.*?: (monitor|immediate attention)(?: \((.*)\))?$/, '$2') : c)).filter(Boolean);
      const detail = [...fromChecks, ...p.findings.map((x) => (plain ? x.replace(/ \((minor|moderate|severe)\)$/, '') : x)), ...p.measurements.map((m) => tidy(p.label, m))].join(', ');
      if (plain) out.push(`${p.label}${detail ? ` (${detail})` : ''} ${state === 'immediate' ? 'needs attention now' : 'is worth keeping an eye on'}.`);
      else out.push(`${p.label}: ${detail || 'needs attention'}${state === 'immediate' ? '. Needs attention now' : '. Monitor'}.`);
    }
  }
  const ok = f.parts.filter((p) => p.state === 'ok');
  const problems = out.length;
  for (const p of ok.filter((x) => x.measurements.length)) {
    const m = p.measurements.map((x) => tidy(p.label, x)).join(', ');
    out.push(plain ? `${p.label} (${m}) looks good.` : `${p.label}: ${m}, OK.`);
  }
  const rest = ok.filter((p) => !p.measurements.length);
  const good = plain ? 'looked good' : 'checked OK';
  if (rest.length) {
    const names = rest.map((p, k) => (k === 0 && !problems ? p.label : lower(p.label)));
    if (rest.length <= 3) out.push(`${list(names)} ${good}.`);
    else out.push(problems || out.length ? `${rest.length} other parts ${good}.` : `All ${rest.length} parts ${good}.`);
  }
  for (const p of f.parts.filter((x) => x.state === 'not_inspected' || x.state === 'unable_to_assess')) {
    out.push(plain ? `We didn't check the ${lower(p.label)}${p.notChecked ? ` (${p.notChecked})` : ''}.` : `${p.label} not checked${p.notChecked ? ` (${p.notChecked})` : ''}.`);
  }
  return out.map(cap).join(' ');
}

/**
 * Points that get an automatic note for the report: a technician note still in the technician's own words is reworded,
 * and a blank note is drafted from the point's findings (every point gets one, so no point reaches the report blank).
 * Notes already suggested, approved by the advisor, edited or kept as written are left alone.
 */
export function autoNotePoints(insp: Inspection, _vehicle: Vehicle, points: TemplatePoint[]): { pointId: string; kind: 'reword' | 'draft' }[] {
  const out: { pointId: string; kind: 'reword' | 'draft' }[] = [];
  for (const p of points) {
    const n = insp.notes.find((x) => x.pointId === p.id);
    if (n?.approved || (n && n.status !== 'technician_original' && proposedNote(n).trim())) continue;
    out.push({ pointId: p.id, kind: n?.techText.trim() ? 'reword' : 'draft' });
  }
  return out;
}

/**
 * What was found at a point, one line per check rated Monitor or Immediate (with the findings that explain it), then
 * part-level findings and parts that weren't checked. Empty when nothing needs mentioning.
 */
export function pointFindingLines(insp: Inspection, vehicle: Vehicle, point: TemplatePoint): { key: string; text: string; rating: 'monitor' | 'immediate' | null }[] {
  const out: { key: string; text: string; rating: 'monitor' | 'immediate' | null }[] = [];
  for (const c of pointComponents(point, vehicle.config).filter((x) => x.applies)) {
    for (const r of insp.results.filter((x) => x.compKey === c.key && x.rating !== 'ok')) {
      const ck = ONTOLOGY.checks[r.checkKey];
      const why = checkFindings(insp, c.key, r.checkKey).map((f) => findingLabel(f.key).toLowerCase());
      const value = r.value !== null ? ` ${unitText(r.checkKey, r.value)}` : '';
      out.push({ key: `${c.key}|${r.checkKey}`, rating: r.rating as 'monitor' | 'immediate',
        text: `${compLabel(c.key)}: ${ck?.name ?? 'check'}${value}${why.length ? ` (${why.join(', ')})` : ''}` });
    }
    for (const f of insp.findings.filter((x) => x.compKey === c.key && !x.checkKey && countsFinding(x))) {
      out.push({ key: f.id, rating: null, text: `${compLabel(c.key)}: ${findingLabel(f.key).toLowerCase()} (${f.severity})` });
    }
    const st = insp.statuses.find((x) => x.compKey === c.key)?.notInspected;
    if (st) out.push({ key: `${c.key}|skip`, rating: null, text: `${compLabel(c.key)}: not checked (${REASON[st.reason] ?? st.reason.replace(/_/g, ' ')})` });
  }
  return out;
}

/** The note the advisor is offered for a point: the AI suggestion, else the text already chosen, else the technician's. */
export const proposedNote = (n: PointNote | undefined) => (n?.status === 'ai_suggested' ? n.aiText : null) ?? n?.customerText ?? n?.techText ?? '';

/** Points on this vehicle whose report note the service advisor still has to approve (the report can't go out until none). */
export function notesToApprove(insp: Inspection, vehicle: Vehicle): string[] {
  return inspectionSteps(vehicle).map((s) => s.pointId).filter((id) => {
    const n = insp.notes.find((x) => x.pointId === id);
    return !(n?.approved && n.customerText?.trim());
  });
}

const nums = (s: string) => s.match(/\d+(?:[.,/]\d+)*/g) ?? [];
/** Guardrail for AI drafts: every number in the draft must come from the confirmed facts. */
export function draftKeepsFacts(facts: PointFacts, draft: string): boolean {
  const allowed = new Set(nums(`${factsText(facts)} ${facts.point}`));
  return nums(draft).every((n) => allowed.has(n));
}
