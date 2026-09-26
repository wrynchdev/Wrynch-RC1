import raw from '../data/ontology.json';
import type {
  CompKey, Condition, Ontology, OntologyClass, TemplatePoint, TemplateSection, VehicleConfig,
} from './types';

export const ONTOLOGY = raw as unknown as Ontology;

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
  gasoline: (c) => c.powertrain === 'gasoline' || c.powertrain === 'hybrid',
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
