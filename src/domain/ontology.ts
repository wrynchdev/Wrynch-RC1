import raw from '../data/ontology.json';
import type {
  Check, CompKey, Condition, Ontology, OntologyClass, Op, Template, TemplatePoint, TemplateSection, VehicleConfig,
} from './types';

export const ONTOLOGY = raw as unknown as Ontology;
/** The catalog default, before any shop edits. */
export const DEFAULT_TEMPLATE: Template = structuredClone(ONTOLOGY.template);
const DEFAULT_AUTO = Object.fromEntries(Object.values(ONTOLOGY.checks).map((c) => [c.key, c.auto]));

/** Install the signed-in shop's template (the demo keeps the default). */
export function setTemplate(t: Template) { ONTOLOGY.template = t; }
export function currentTemplate(): Template { return ONTOLOGY.template; }

export interface Threshold { checkKey: string; ok: [Op, number]; immediate: [Op, number] | null }
/** Install the shop's rating-rule overrides on top of the catalog defaults. */
export function setThresholds(list: Threshold[]) {
  for (const [k, auto] of Object.entries(DEFAULT_AUTO)) ONTOLOGY.checks[k].auto = auto;
  for (const t of list) { const c: Check | undefined = ONTOLOGY.checks[t.checkKey]; if (c) c.auto = { ok: t.ok, immediate: t.immediate }; }
}
export function defaultThreshold(checkKey: string) { return DEFAULT_AUTO[checkKey] ?? null; }

// Checks turned off for every shop (by Wrynch staff) and in the inspection's template (by the shop owner, saved with
// the template as `checksOff`). Nothing can be added here: only catalog checks can be turned off, and a part always
// keeps at least one check.
let platformOff = new Set<string>();
let shopOff = new Set<string>(); // shop-wide list from older servers; counts like the template's own
/** Install the checks Wrynch turned off for every shop (and, from older servers, the shop-wide list). */
export function setDisabledChecks(platform: string[], shop: string[] = []) { platformOff = new Set(platform); shopOff = new Set(shop); }
const templateOff = (): readonly string[] => ONTOLOGY.template.checksOff ?? [];
/** 'platform' when Wrynch turned the check off for every shop, 'template' when the template does, else null. */
export function checkOff(checkKey: string, inTemplate: readonly string[] = templateOff()): 'platform' | 'template' | null {
  if (platformOff.has(checkKey)) return 'platform';
  return inTemplate.includes(checkKey) || shopOff.has(checkKey) ? 'template' : null;
}
/** Whether a check can be turned off: some other check on the same part has to stay on. */
export function canTurnOff(checkKey: string, scope: 'platform' | 'template' = 'template', inTemplate: readonly string[] = templateOff()): boolean {
  const c = ONTOLOGY.checks[checkKey];
  if (!c) return false;
  return cls(c.classId).checks.some((k) => k !== checkKey && (scope === 'platform' ? !platformOff.has(k) : !checkOff(k, inTemplate)));
}
/** The part's checks that are on, in catalog order (all of them if every one is off). */
export function enabledChecks(classId: number, inTemplate: readonly string[] = templateOff()): string[] {
  const all = cls(classId).checks;
  const on = all.filter((k) => !checkOff(k, inTemplate));
  return on.length ? on : all;
}
/** Parts a template's list would leave with no check at all (the server refuses such a template). */
export function partsLeftWithoutChecks(list: readonly string[]): number[] {
  const off = new Set(list);
  return ONTOLOGY.classes.filter((c) => c.checks.length > 0 && c.checks.every((k) => off.has(k))).map((c) => c.id);
}

/** Run with another template installed (an inspection's own version), then put the current one back. */
export function withTemplate<T>(t: Template | null | undefined, run: () => T): T {
  if (!t || t === ONTOLOGY.template) return run();
  const before = ONTOLOGY.template;
  ONTOLOGY.template = t;
  try { return run(); } finally { ONTOLOGY.template = before; }
}

const byId = new Map<number, OntologyClass>(ONTOLOGY.classes.map((c) => [c.id, c]));
const byName = new Map<string, OntologyClass>(ONTOLOGY.classes.map((c) => [c.name, c]));

export function cls(id: number): OntologyClass {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown class id ${id}`);
  return c;
}
export function clsByName(name: string): OntologyClass {
  const c = byName.get(name);
  if (!c) throw new Error(`Unknown class ${name}`);
  return c;
}

export const compKey = (classId: number, position: string | null): CompKey => `${classId}@${position ?? ''}`;
export function parseKey(key: CompKey): { classId: number; position: string | null } {
  const [id, pos] = key.split('@');
  return { classId: Number(id), position: pos ? pos : null };
}

const POS_LABEL: Record<string, string> = {
  left_front: 'left front', right_front: 'right front', left_rear: 'left rear', right_rear: 'right rear',
  left: 'left', right: 'right', front: 'front', rear: 'rear', center: 'center',
};
const POS_SHORT: Record<string, string> = {
  left_front: 'LF', right_front: 'RF', left_rear: 'LR', right_rear: 'RR', left: 'L', right: 'R', front: 'Front', rear: 'Rear',
};
export const positionLabel = (p: string | null) => (p ? POS_LABEL[p] ?? p.replace(/_/g, ' ') : '');
export const positionShort = (p: string | null) => (p ? POS_SHORT[p] ?? positionLabel(p) : '');

export function compLabel(key: CompKey, short = false): string {
  const { classId, position } = parseKey(key);
  const name = cls(classId).label;
  if (!position) return name;
  return short ? `${name} · ${positionShort(position)}` : `${name} · ${positionLabel(position)}`;
}

/** Vehicle-configuration predicates used by the template's "applies when" column. */
export const CONDITIONS: Record<Condition, (c: VehicleConfig) => boolean> = {
  always: () => true,
  onDemand: () => false,
  combustion: (c) => c.powertrain !== 'ev',
  gasoline: (c) => c.powertrain === 'gasoline' || c.powertrain === 'hybrid' || c.powertrain === 'plug_in_hybrid',
  electrified: (c) => c.powertrain === 'hybrid' || c.powertrain === 'plug_in_hybrid' || c.powertrain === 'ev',
  plugIn: (c) => c.powertrain === 'plug_in_hybrid' || c.powertrain === 'ev',
  evFrontMotor: (c) => c.powertrain === 'ev' && c.drivetrain !== 'rwd',
  evRearMotor: (c) => c.powertrain === 'ev' && c.drivetrain !== 'fwd',
  rearDisc: (c) => c.rearBrakes === 'disc',
  rearDrum: (c) => c.rearBrakes === 'drum',
  rack: (c) => c.steering === 'rack',
  recirc: (c) => c.steering === 'recirc',
  parallelogram: (c) => c.steering === 'parallelogram',
  frontStruts: (c) => c.frontSuspension === 'strut',
  frontShocks: (c) => c.frontSuspension === 'shock',
  rearShocks: (c) => c.rearSuspension === 'shock',
  rearStruts: (c) => c.rearSuspension === 'strut',
  coilSprings: (c) => c.rearSprings === 'coil',
  rearLeaf: (c) => c.rearSprings === 'leaf',
  fwdOrAwd: (c) => c.frontCvAxles,
  independentRearDrive: (c) => c.independentRearDrive,
  rwdAwd4wd: (c) => c.drivetrain !== 'fwd',
  frontDiff: (c) => c.frontDiff,
  rearDiff: (c) => c.rearDiff,
  transferCase: (c) => c.transferCase,
  twoPieceDriveshaft: (c) => c.twoPieceDriveshaft,
  solidAxle: (c) => c.solidAxle,
  automatic: (c) => c.transmission === 'automatic',
  manual: (c) => c.transmission === 'manual',
  hydraulicSteering: (c) => c.hydraulicSteering,
  timingBelt: (c) => c.timing === 'belt',
  timingChain: (c) => c.timing === 'chain',
  fogLamps: (c) => c.fogLamps,
  rearWiper: (c) => c.rearWiper,
  cabinFilter: (c) => c.cabinFilter,
  fuelFilter: (c) => c.fuelFilter,
};

export function applies(when: Condition, config: VehicleConfig): boolean {
  if (when.startsWith('chargePort:')) {
    return (config.powertrain === 'ev' || config.powertrain === 'plug_in_hybrid') && (config.chargePort ?? 'left_front') === when.slice(11);
  }
  const p = CONDITIONS[when];
  if (!p) throw new Error(`Unknown condition ${when}`);
  return p(config);
}

export interface PointComponent { key: CompKey; required: boolean; applies: boolean }

/** Components a point expands to on this vehicle. The same component can belong to several points. */
export function pointComponents(point: TemplatePoint, config: VehicleConfig): PointComponent[] {
  const seen = new Map<CompKey, PointComponent>();
  for (const t of point.components) {
    const key = compKey(t.classId, t.position);
    const a = applies(t.when, config);
    const prev = seen.get(key);
    if (prev) { prev.applies ||= a; prev.required ||= t.required && a; continue; }
    seen.set(key, { key, required: t.required && a, applies: a });
  }
  return [...seen.values()];
}

export function sections(): TemplateSection[] { return ONTOLOGY.template.sections; }
export function allPoints(): TemplatePoint[] { return sections().flatMap((s) => s.points); }
export function point(id: string): TemplatePoint {
  const p = allPoints().find((x) => x.id === id);
  if (!p) throw new Error(`Unknown point ${id}`);
  return p;
}
export function sectionOfPoint(id: string): TemplateSection {
  const s = sections().find((x) => x.points.some((p) => p.id === id));
  if (!s) throw new Error(`No section for ${id}`);
  return s;
}

/** Every distinct component that applies to this vehicle across the whole template. */
export function vehicleComponents(config: VehicleConfig, extra: CompKey[] = []): { applies: CompKey[]; na: CompKey[]; required: Set<CompKey> } {
  const applying = new Set<CompKey>(extra);
  const na = new Set<CompKey>();
  const required = new Set<CompKey>();
  for (const p of allPoints()) {
    for (const c of pointComponents(p, config)) {
      if (c.applies) applying.add(c.key); else na.add(c.key);
      if (c.required) required.add(c.key);
    }
  }
  for (const k of applying) na.delete(k);
  return { applies: [...applying], na: [...na], required };
}

export function findingLabel(key: string): string {
  return ONTOLOGY.findings[key]?.label ?? key.replace(/_/g, ' ');
}
