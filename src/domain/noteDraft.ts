// Drafting a technician note for one inspection point from what has been confirmed on it.
// Only confirmed facts count: the tech's ratings and measurements, findings the tech entered or confirmed,
// photos whose parts the tech confirmed, and parts the tech marked as not checked. Pending AI output is ignored.
// A draft is only a suggestion: it becomes the note when the technician approves it.
import { compLabel, findingLabel, ONTOLOGY, pointComponents } from './ontology';
import { componentState, countsFinding, linkConfirmed } from './rating';
import type { ComponentState, Inspection, TemplatePoint, Vehicle } from './types';

export interface PartFacts {
  key: string; label: string; state: ComponentState;
  measurements: string[]; checks: string[]; findings: string[];
  notChecked: string | null; photos: number;
}
export interface PointFacts { point: string; parts: PartFacts[]; photoIds: string[] }

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
  for (const c of pointComponents(point, vehicle.config).filter((x) => x.applies)) {
    const key = c.key;
    const state = componentState(insp, key);
    const results = insp.results.filter((r) => r.compKey === key);
    const measurements = results.filter((r) => r.value !== null).map((r) => `${ONTOLOGY.checks[r.checkKey]?.name ?? r.checkKey} ${unitText(r.checkKey, r.value!)}`);
    const checks = results.filter((r) => r.value === null).map((r) => `${ONTOLOGY.checks[r.checkKey]?.name ?? r.checkKey}: ${RATING[r.rating] ?? r.rating}`);
    const findings = insp.findings.filter((f) => f.compKey === key && countsFinding(f)).map((f) => `${findingLabel(f.key).toLowerCase()} (${f.severity})`);
    const st = insp.statuses.find((x) => x.compKey === key)?.notInspected;
    const photos = insp.media.filter((m) => linkConfirmed(m, key));
    photos.forEach((m) => photoIds.add(m.id));
    if (state === 'unrated' && !photos.length) continue;
    parts.push({ key, label: compLabel(key), state, measurements, checks, findings, notChecked: st ? REASON[st.reason] ?? st.reason.replace(/_/g, ' ') : null, photos: photos.length });
  }
  return { point: point.name, parts, photoIds: [...photoIds] };
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
export function draftNote(f: PointFacts): string {
  const out: string[] = [];
  for (const state of ['immediate', 'monitor'] as const) {
    for (const p of f.parts.filter((x) => x.state === state)) {
      const detail = [...p.findings, ...p.measurements.map((m) => tidy(p.label, m))].join(', ');
      out.push(`${p.label}: ${detail || 'needs attention'}${state === 'immediate' ? '. Needs attention now' : '. Monitor'}.`);
    }
  }
  const ok = f.parts.filter((p) => p.state === 'ok');
  const problems = out.length;
  for (const p of ok.filter((x) => x.measurements.length)) out.push(`${p.label}: ${p.measurements.map((m) => tidy(p.label, m)).join(', ')}, OK.`);
  const plain = ok.filter((p) => !p.measurements.length);
  if (plain.length) {
    const names = plain.map((p, k) => (k === 0 && !problems ? p.label : lower(p.label)));
    if (plain.length <= 3) out.push(`${list(names)} checked OK.`);
    else out.push(problems || out.length ? `${plain.length} other parts checked OK.` : `All ${plain.length} parts checked OK.`);
  }
  for (const p of f.parts.filter((x) => x.state === 'not_inspected' || x.state === 'unable_to_assess')) out.push(`${p.label} not checked${p.notChecked ? ` (${p.notChecked})` : ''}.`);
  return out.map(cap).join(' ');
}

const nums = (s: string) => s.match(/\d+(?:[.,/]\d+)*/g) ?? [];
/** Guardrail for AI drafts: every number in the draft must come from the confirmed facts. */
export function draftKeepsFacts(facts: PointFacts, draft: string): boolean {
  const allowed = new Set(nums(`${factsText(facts)} ${facts.point}`));
  return nums(draft).every((n) => allowed.has(n));
}
