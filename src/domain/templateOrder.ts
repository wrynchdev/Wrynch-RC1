// Reorders a template so a technician works through the car in one pass instead of walking back and forth.
//
// Each point is placed in the phase where its parts are checked, following how a car moves through the shop:
// paperwork photos → first start → driver's seat → road test → walk-around → hood open → wheels (lift at waist
// height) → underneath (lift raised). Inside a phase the points follow a path: the walk-around and wheel phases go
// clockwise around the car from the driver's door, the underside goes front to back, and under the hood the
// checks go top-side fluids first, then belts and hoses, intake, battery, ignition, fuel and the cabin filter.
// Points stay in their own stage (a stage is where photos are sorted), stages are put in phase order, ties keep
// the shop's existing order, and a point with no parts (a symptom such as "noise noticed") stays right after the
// point it followed.
import { cls } from './ontology';
import type { Template, TemplatePoint } from './types';

export const PHASES = ['Paperwork photos', 'First start', "Driver's seat", 'Road test', 'Walk-around', 'Hood open', 'Wheels', 'Underneath'] as const;

const PHASE_OF: Record<string, number> = {
  identity_context: 0,
  charging_starting: 1,
  controls_context: 2, cabin_controls: 2, cabin: 2, occupant_safety: 2, hvac: 2, adas: 2,
  engine: 3,
  lighting: 4, electrical: 4, body_panel: 4, trim: 4, glass: 4, mirror: 4, closure: 4, fascia: 4, aero: 4, roof: 4,
  washer_wiper: 4, pickup: 4, step_guard: 4, towing: 4, roof_cargo: 4, cargo: 4, commercial: 4, commercial_rv: 4,
  hood_hardware: 5, fluids: 5, engine_oil: 5, brake_hydraulics: 5, power_steering: 5, cooling: 5, hoses_belts: 5,
  air_intake: 5, battery: 5, ignition: 5, timing: 5, fuel_system: 5, cabin_filtration: 5,
  wheels_tires: 6, brakes: 6, wheel_end: 6,
  suspension: 7, steering: 7, driveline: 7, exhaust: 7, powertrain_underbody: 7, transmission: 7, ev_high_voltage: 7, protection: 7,
};
// Categories checked in more than one place (engine: performance on the road and leaks underneath; fluids: under the
// hood or at a differential) only decide the phase when nothing else on the point does.
const NEUTRAL = new Set(['engine', 'fluids']);
const HOOD_STEP: Record<string, number> = {
  hood_hardware: 0, fluids: 1, engine_oil: 1, brake_hydraulics: 1, power_steering: 1, cooling: 1,
  hoses_belts: 2, air_intake: 3, battery: 4, ignition: 5, timing: 5, fuel_system: 6, cabin_filtration: 7,
};
// Clockwise from the driver's door (left side, US).
const AROUND: Record<string, number> = { left: 0, left_mid: 0, left_front: 1, front: 2, right_front: 3, right: 4, right_mid: 4, right_rear: 5, rear: 6, left_rear: 7 };
const CORNERS = new Set(['left_front', 'right_front', 'left_rear', 'right_rear']);
// Front (0) to back (2) under the car; where the position doesn't say, the part type does.
const ALONG: Record<string, number> = { front: 0, left_front: 0, right_front: 0, left_mid: 1, right_mid: 1, rear: 2, left_rear: 2, right_rear: 2 };
const ALONG_DEFAULT: Record<string, number> = { steering: 0.2, engine: 0.3, transmission: 0.8, powertrain_underbody: 0.9, exhaust: 1.3, fuel_system: 1.5 };

const category = (classId: number) => { try { return cls(classId).category; } catch { return ''; } };
const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;

interface Placed { point: TemplatePoint; phase: number; path: number; index: number }

function place(p: TemplatePoint, index: number): Placed | null {
  const comps = p.components.map((c) => ({ cat: category(c.classId), pos: c.position }));
  if (comps.length === 0) return null;
  // Phase: the most common phase among the point's parts (neutral ones only if nothing else); ties go to the first part.
  const voters = comps.filter((c) => c.cat in PHASE_OF && !NEUTRAL.has(c.cat));
  const pool = voters.length ? voters : comps.filter((c) => c.cat in PHASE_OF);
  if (!pool.length) return { point: p, phase: -1, path: 0, index };
  const tally = new Map<number, number>();
  for (const c of pool) tally.set(PHASE_OF[c.cat], (tally.get(PHASE_OF[c.cat]) ?? 0) + 1);
  const top = Math.max(...tally.values());
  const phase = PHASE_OF[pool.find((c) => tally.get(PHASE_OF[c.cat]) === top)!.cat];

  let path = 0;
  if (phase === 4 || phase === 6) {
    // Around the car. A point that covers three or more corners is finished at the end of the lap.
    const spots = comps.map((c) => c.pos).filter((x): x is string => !!x && x in AROUND);
    const corners = new Set(spots.filter((x) => CORNERS.has(x)));
    path = !spots.length || corners.size >= 3 || new Set(spots).size >= 5 ? 10 : Math.min(...spots.map((x) => AROUND[x]));
  } else if (phase === 7) {
    path = avg(comps.map((c) => (c.pos && c.pos in ALONG ? ALONG[c.pos] : ALONG_DEFAULT[c.cat] ?? 1)));
  } else if (phase === 5) {
    path = Math.min(...comps.map((c) => HOOD_STEP[c.cat] ?? 8));
  }
  return { point: p, phase, path, index };
}

export interface OrderResult { template: Template; moved: number; stagesMoved: boolean }

/** The template in working order. Nothing is added, removed or moved between stages. */
export function optimizeOrder(t: Template): OrderResult {
  let moved = 0;
  const stages = t.sections.map((s, si) => {
    // Symptom points (no parts) ride along with the point before them.
    const groups: { lead: Placed; riders: TemplatePoint[] }[] = [];
    const leading: TemplatePoint[] = [];
    s.points.forEach((p, i) => {
      const placed = place(p, i);
      if (placed) groups.push({ lead: placed, riders: [] });
      else if (groups.length) groups[groups.length - 1].riders.push(p);
      else leading.push(p);
    });
    // Points whose phase couldn't be told keep the phase of the point before them.
    let last = groups.find((g) => g.lead.phase >= 0)?.lead.phase ?? 0;
    for (const g of groups) { if (g.lead.phase < 0) g.lead.phase = last; last = g.lead.phase; }
    const sorted = [...groups].sort((a, b) => a.lead.phase - b.lead.phase || a.lead.path - b.lead.path || a.lead.index - b.lead.index);
    const points = [...leading, ...sorted.flatMap((g) => [g.lead.point, ...g.riders])];
    moved += points.filter((p, i) => s.points[i]?.id !== p.id).length;
    const phases = groups.map((g) => g.lead.phase);
    return { section: { ...s, points }, rank: phases.length ? avg(phases) : Infinity, si };
  });
  const ordered = [...stages].sort((a, b) => a.rank - b.rank || a.si - b.si);
  const stagesMoved = ordered.some((x, i) => x.si !== i);
  return { template: { ...t, sections: ordered.map((x) => x.section) }, moved, stagesMoved };
}
