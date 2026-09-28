// Rating rules (ontology "Rating Scale" sheet, R1–R12).
import { cls, parseKey, vehicleComponents } from './ontology';
import type {
  Check, CompKey, ComponentState, Finding, Inspection, Media, Op, Rating, Severity, Vehicle,
} from './types';
import { SEVERITIES } from './types';

const ORDER: Record<Rating, number> = { ok: 0, monitor: 1, immediate: 2 };
export const worst = (a: Rating | null, b: Rating | null): Rating | null =>
  a === null ? b : b === null ? a : ORDER[a] >= ORDER[b] ? a : b;

function test(op: Op, v: number, limit: number): boolean {
  switch (op) {
    case '<': return v < limit;
    case '<=': return v <= limit;
    case '>': return v > limit;
    case '>=': return v >= limit;
  }
}

/** R3: a typed measurement is rated by the check's thresholds. Null when the check has no automatic rule. */
export function rateValue(check: Check, value: number): Rating | null {
  if (!check.auto || Number.isNaN(value)) return null;
  const imm = check.auto.immediate;
  if (imm && test(imm[0], value, imm[1])) return 'immediate';
  if (test(check.auto.ok[0], value, check.auto.ok[1])) return 'ok';
  return 'monitor';
}

/** R2: default rating of a finding on a class at a severity (critical is always immediate). */
export function findingRating(classId: number, key: string, severity: Severity): Rating {
  const row = cls(classId).findings[key];
  if (!row) return severity === 'critical' ? 'immediate' : 'monitor';
  return row[SEVERITIES.indexOf(severity)];
}

/** R4/R10: only technician findings and confirmed/modified AI findings count. */
export const countsFinding = (f: Finding) =>
  f.source === 'technician' ? f.status !== 'denied' : f.status === 'confirmed' || f.status === 'modified';
export const isPendingAi = (f: Finding) => f.source === 'ai' && f.status === 'pending';

/** R1: a component's state is the worst of its check results and counted findings. */
export function componentState(insp: Inspection, key: CompKey): ComponentState {
  const status = insp.statuses.find((s) => s.compKey === key);
  if (status?.override) return status.override.rating;
  let r: Rating | null = null;
  for (const res of insp.results) if (res.compKey === key) r = worst(r, res.rating);
  const { classId } = parseKey(key);
  for (const f of insp.findings) if (f.compKey === key && countsFinding(f)) r = worst(r, findingRating(classId, f.key, f.severity));
  if (r) return r;
  if (status?.notInspected) return status.notInspected.kind;
  return 'unrated';
}

/** R6: a point shows its worst component (display only; history is per component). */
export function pointState(insp: Inspection, keys: CompKey[]): ComponentState {
  let r: Rating | null = null;
  let anyUnrated = false;
  let anyNotChecked = false;
  for (const k of keys) {
    const s = componentState(insp, k);
    if (s === 'ok' || s === 'monitor' || s === 'immediate') r = worst(r, s);
    else if (s === 'unrated') anyUnrated = true;
    else anyNotChecked = true;
  }
  if (r) return r;
  if (anyUnrated) return 'unrated';
  return anyNotChecked ? 'not_inspected' : 'unrated';
}

/** A photo counts for a part once a technician has confirmed or added that link. */
export const linkConfirmed = (m: Media, key: CompKey) => !m.excluded && m.links.some((l) => l.compKey === key && l.status !== 'ai_proposed');
export const mediaConfirmed = (m: Media) => !m.excluded && m.links.length > 0 && m.links.every((l) => l.status !== 'ai_proposed');
/** Needs the technician: an unconfirmed AI link, or no parts at all. */
export const mediaPending = (m: Media) => !m.excluded && (m.links.length === 0 || m.links.some((l) => l.status === 'ai_proposed'));
export const photosOf = (insp: Inspection, key: CompKey) => insp.media.filter((m) => !m.excluded && m.links.some((l) => l.compKey === key));

export interface GateItem { kind: 'ai_finding' | 'photo' | 'wording' | 'required'; id: string; label: string }

/** R12: everything that blocks completion. Empty list = the inspection can be submitted. */
export function completionGate(insp: Inspection, vehicle: Vehicle): GateItem[] {
  const items: GateItem[] = [];
  for (const f of insp.findings) if (isPendingAi(f)) items.push({ kind: 'ai_finding', id: f.id, label: f.compKey });
  for (const m of insp.media) if (mediaPending(m)) items.push({ kind: 'photo', id: m.id, label: m.label });
  for (const n of insp.notes) if (n.status === 'ai_suggested') items.push({ kind: 'wording', id: n.pointId, label: n.pointId });
  const { required } = vehicleComponents(vehicle.config, insp.extraComponents);
  for (const k of required) if (componentState(insp, k) === 'unrated') items.push({ kind: 'required', id: k, label: k });
  return items;
}

export interface Summary { ok: number; monitor: number; immediate: number; notChecked: number; unrated: number; total: number }
export function summarize(insp: Inspection, vehicle: Vehicle): Summary {
  const { applies } = vehicleComponents(vehicle.config, insp.extraComponents);
  const s: Summary = { ok: 0, monitor: 0, immediate: 0, notChecked: 0, unrated: 0, total: applies.length };
  for (const k of applies) {
    const st = componentState(insp, k);
    if (st === 'ok') s.ok++;
    else if (st === 'monitor') s.monitor++;
    else if (st === 'immediate') s.immediate++;
    else if (st === 'unrated') s.unrated++;
    else s.notChecked++;
  }
  return s;
}

/**
 * R11: the customer-facing view. Only counted findings, confirmed photos the tech marked for the
 * customer, and approved wording. Throws if the inspection has not passed the gate.
 */
export function customerView(insp: Inspection, vehicle: Vehicle) {
  if (insp.status !== 'submitted' && insp.status !== 'sent') throw new Error('Inspection not submitted');
  const { applies } = vehicleComponents(vehicle.config, insp.extraComponents);
  const items = applies.map((key) => ({
    key,
    state: componentState(insp, key),
    findings: insp.findings.filter((f) => f.compKey === key && countsFinding(f)),
    results: insp.results.filter((r) => r.compKey === key),
    photos: insp.media.filter((m) => linkConfirmed(m, key) && m.customerVisible),
    reason: insp.statuses.find((s) => s.compKey === key)?.notInspected ?? null,
  }));
  const notes = insp.notes.filter((n) => n.customerText && n.status !== 'ai_suggested');
  return { items, notes };
}
