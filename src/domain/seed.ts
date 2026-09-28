// Demo data. The 2011 4Runner and its Sep 26, 2026 inspection follow the shop's real MPI example;
// the three earlier visits are invented so part history has something to show.
import { allPoints, cls, clsByName, compKey, pointComponents, sections, vehicleComponents } from './ontology';
import type {
  CompKey, Inspection, NotInspectedReason, Rating, Severity, Vehicle, VehicleConfig,
} from './types';
import { rateValue } from './rating';
import { ONTOLOGY } from './ontology';

const RUNNER_CONFIG: VehicleConfig = {
  powertrain: 'gasoline', drivetrain: '4wd', transmission: 'automatic', rearBrakes: 'disc', steering: 'rack',
  hydraulicSteering: true, frontSuspension: 'strut', rearSuspension: 'shock', rearSprings: 'coil', frontCvAxles: true,
  independentRearDrive: false, frontDiff: true, rearDiff: true, transferCase: true, twoPieceDriveshaft: false,
  solidAxle: true, timing: 'chain', fogLamps: true, rearWiper: true, cabinFilter: true, fuelFilter: false, chargePort: null,
};
const CRV_CONFIG: VehicleConfig = {
  ...RUNNER_CONFIG, drivetrain: 'awd', steering: 'rack', hydraulicSteering: false, rearSuspension: 'shock',
  frontDiff: false, transferCase: false, rearDiff: true, solidAxle: false, independentRearDrive: true,
  timing: 'chain', fogLamps: false,
};
const TESLA_CONFIG: VehicleConfig = {
  ...CRV_CONFIG, powertrain: 'ev', drivetrain: 'rwd', transmission: 'automatic', rearSuspension: 'shock',
  frontCvAxles: false, independentRearDrive: true, rearDiff: false, timing: 'none', chargePort: 'left_rear', rearWiper: false,
};

export const VEHICLES: Vehicle[] = [
  { id: 'v-4runner', vin: 'JTEBU5JR4B5012345', year: 2011, make: 'Toyota', model: '4Runner', trim: 'SR5',
    engine: '4.0L V6 · 5-speed automatic · part-time 4WD', customer: 'Dana Reyes', config: RUNNER_CONFIG },
  { id: 'v-crv', vin: '7FARW2H85KE000000', year: 2019, make: 'Honda', model: 'CR-V', trim: 'EX',
    engine: '1.5L turbo · CVT · AWD', customer: 'Sam Ortiz', config: CRV_CONFIG },
  { id: 'v-model3', vin: '5YJ3E1EA1MF000000', year: 2021, make: 'Tesla', model: 'Model 3', trim: 'Standard Range Plus',
    engine: 'Single motor · RWD', customer: 'Priya Natarajan', config: TESLA_CONFIG },
];

let n = 0;
const id = (p: string) => `${p}-${++n}`;

function blank(o: Partial<Inspection> & Pick<Inspection, 'id' | 'ro' | 'vehicleId' | 'odometer' | 'date'>): Inspection {
  return {
    technician: 'Marcus T.', status: 'in_progress', concerns: [], dtcs: [], results: [], findings: [], media: [], observations: [],
    statuses: [], notes: [], extraComponents: [], customerApprovals: [], estimate: [], ...o,
  };
}

const key = (name: string, pos: string | null = null): CompKey => compKey(clsByName(name).id, pos);

export function rate(insp: Inspection, name: string, pos: string | null, checkSuffix: string, rating: Rating | null, value: number | null = null) {
  const k = key(name, pos);
  const checkKey = `${name}.${checkSuffix}`;
  const check = ONTOLOGY.checks[checkKey];
  if (!check) throw new Error(`No check ${checkKey}`);
  const r = value !== null ? rateValue(check, value) ?? rating : rating;
  if (!r) throw new Error(`No rating for ${checkKey}`);
  insp.results = insp.results.filter((x) => !(x.compKey === k && x.checkKey === checkKey));
  insp.results.push({ compKey: k, checkKey, value, rating: r, at: insp.date });
}

export function find(insp: Inspection, name: string, pos: string | null, finding: string, severity: Severity) {
  const k = key(name, pos);
  if (!cls(clsByName(name).id).findings[finding]) throw new Error(`${finding} not allowed on ${name}`);
  insp.findings.push({ id: id('f'), compKey: k, key: finding, severity, source: 'technician', status: 'confirmed',
    confidence: null, rationale: null, mediaId: null, reviewedAt: insp.date, aiOriginal: null });
}

function notChecked(insp: Inspection, name: string, pos: string | null, kind: 'not_inspected' | 'unable_to_assess', reason: NotInspectedReason) {
  insp.statuses.push({ compKey: key(name, pos), notInspected: { kind, reason }, override: null });
}

/** The check a tech uses to say "looked at it, fine": the first visual/functional check. */
export function quickCheck(classId: number): string {
  const c = cls(classId);
  const pick = c.checks.find((k) => ONTOLOGY.checks[k].valueType !== 'numeric') ?? c.checks[0];
  return pick;
}

/** Mark every still-unrated component in the given sections OK (a "nothing found" pass). */
export function fillOk(insp: Inspection, vehicle: Vehicle, sectionIds: string[]) {
  const touched = new Set<CompKey>([
    ...insp.results.map((r) => r.compKey), ...insp.findings.map((f) => f.compKey), ...insp.statuses.map((s) => s.compKey),
  ]);
  for (const s of sections()) {
    if (!sectionIds.includes(s.id)) continue;
    for (const p of s.points) {
      for (const c of pointComponents(p, vehicle.config)) {
        if (!c.applies || touched.has(c.key)) continue;
        touched.add(c.key);
        insp.results.push({ compKey: c.key, checkKey: quickCheck(Number(c.key.split('@')[0])), value: null, rating: 'ok', at: insp.date });
      }
    }
  }
}

const CORNERS = ['left_front', 'right_front', 'left_rear', 'right_rear'];

function pastVisit(i: number, date: string, odo: number, ro: string, tech: string): Inspection {
  const v = VEHICLES[0];
  const insp = blank({ id: `i-4r-${i}`, ro, vehicleId: v.id, odometer: odo, date, status: 'sent', technician: tech });
  const tread = [9, 7, 6][i];
  for (const c of CORNERS) rate(insp, 'tire', c, 'tread_depth', null, tread);
  for (const c of ['left_front', 'right_front']) rate(insp, 'brake_pad', c, 'lining_thickness', null, [9.5, 8.0, 6.5][i]);
  for (const c of ['left_rear', 'right_rear']) rate(insp, 'brake_pad', c, 'lining_thickness', null, [9.0, 8.0, 7.0][i]);
  rate(insp, 'brake_fluid', null, 'copper', null, [60, 120, 170][i]);
  rate(insp, 'low_voltage_battery', null, 'measured_cca', null, [96, 90, 84][i]);
  if (i === 2) for (const c of ['left_front', 'right_front']) find(insp, 'brake_rotor', c, 'scored', 'minor');
  fillOk(insp, v, sections().map((s) => s.id));
  return insp;
}

/** Today's 4Runner inspection: road test and under hood done (per the shop example), under car to do. */
function currentRunner(): Inspection {
  const v = VEHICLES[0];
  const insp = blank({ id: 'i-4r-now', ro: '48213', vehicleId: v.id, odometer: 164210, date: '2026-09-26', concerns: ['Check engine light on'] });
  insp.extraComponents = [key('warning_indicator'), key('thermostat')];
  insp.dtcs = [
    { code: 'P0128', description: 'Coolant temperature below thermostat regulating temperature', compKey: key('thermostat') },
    { code: 'P0420', description: 'Catalyst system efficiency below threshold (bank 1)', compKey: key('catalytic_converter') },
  ];
  // Road test
  rate(insp, 'warning_indicator', null, 'status', 'monitor');
  find(insp, 'warning_indicator', null, 'warning_indicator_on', 'minor');
  rate(insp, 'cabin_air_vent', 'center', 'ac_performance', 'monitor');
  find(insp, 'ac_compressor', null, 'inoperative', 'moderate');
  find(insp, 'ac_compressor', null, 'heat_damage', 'moderate');
  notChecked(insp, 'engine_assembly', null, 'not_inspected', 'vehicle_not_road_tested');
  // Under hood
  rate(insp, 'engine_oil', null, 'level', 'monitor');
  find(insp, 'engine_oil', null, 'overfilled', 'minor');
  find(insp, 'engine_coolant', null, 'degraded_fluid', 'minor');
  find(insp, 'thermostat', null, 'failed_test', 'minor');
  rate(insp, 'brake_fluid', null, 'copper', null, 210);
  find(insp, 'engine_air_filter_housing', null, 'broken', 'moderate');
  notChecked(insp, 'engine_air_filter', null, 'unable_to_assess', 'blocked_by_other_condition');
  rate(insp, 'low_voltage_battery', null, 'measured_cca', null, 75);
  notChecked(insp, 'timing_chain', null, 'not_inspected', 'not_accessible');
  notChecked(insp, 'cabin_air_filter', null, 'not_inspected', 'not_performed_this_visit');
  fillOk(insp, v, ['road_test', 'under_hood']);
  insp.notes.push(
    { pointId: 'S14', techText: 'recommend flush. copper 210 ppm', aiText: null, status: 'technician_original', customerText: 'Brake fluid tested at 210 ppm copper. Replace at 200 ppm or more.' },
  );
  return insp;
}

/** Demo shortcut: enter the under-car results from the shop's real example, as a tech would. */
export function applyUnderCarExample(insp: Inspection, vehicle: Vehicle) {
  for (const c of CORNERS) rate(insp, 'tire', c, 'tread_depth', null, 5);
  find(insp, 'tire', 'right_rear', 'dry_rot', 'moderate');
  for (const c of ['left_front', 'right_front']) rate(insp, 'brake_pad', c, 'lining_thickness', null, 5.0);
  for (const c of ['left_rear', 'right_rear']) rate(insp, 'brake_pad', c, 'lining_thickness', null, 6.0);
  for (const c of ['left_front', 'right_front']) if (!insp.findings.some((f) => f.compKey === key('brake_rotor', c))) find(insp, 'brake_rotor', c, 'grooved', 'moderate');
  find(insp, 'ball_joint', 'left_front', 'damaged_seal', 'moderate');
  for (const c of ['left_rear', 'right_rear']) find(insp, 'shock_absorber', c, 'seepage', 'minor');
  for (const c of ['left', 'right']) find(insp, 'outer_tie_rod_end', c, 'damaged_seal', 'minor');
  find(insp, 'catalytic_converter', null, 'failed_test', 'moderate');
  find(insp, 'transfer_case_fluid', null, 'service_due', 'minor');
  fillOk(insp, vehicle, ['under_car']);
  const note = insp.notes.find((x) => x.pointId === 'S24');
  if (!note) insp.notes.push({ pointId: 'S24', techText: 'fronts 5mm/rotors major grooving. rears 6mm', aiText: null, status: 'technician_original', customerText: null });
}

export function seedInspections(): Inspection[] {
  n = 0;
  return [
    pastVisit(0, '2025-03-12', 148902, '41877', 'Ray K.'),
    pastVisit(1, '2025-10-03', 155410, '44109', 'Ray K.'),
    pastVisit(2, '2026-03-14', 160292, '46350', 'Marcus T.'),
    currentRunner(),
    blank({ id: 'i-crv-now', ro: '48219', vehicleId: 'v-crv', odometer: 61230, date: '2026-09-26', status: 'not_started', concerns: ['Oil change + MPI'] }),
    blank({ id: 'i-m3-now', ro: '48222', vehicleId: 'v-model3', odometer: 38410, date: '2026-09-26', status: 'not_started', concerns: ['Tires + MPI'] }),
  ];
}

export function vehicle(idv: string): Vehicle {
  const v = VEHICLES.find((x) => x.id === idv);
  if (!v) throw new Error(`Unknown vehicle ${idv}`);
  return v;
}

export { allPoints, vehicleComponents };
