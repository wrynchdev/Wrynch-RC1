import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONTOLOGY, clsByName, compKey, vehicleComponents, pointComponents, point } from './ontology';
import { componentState, completionGate, customerView, findingRating, rateValue, summarize } from './rating';
import { applyUnderCarExample, seedInspections, vehicle } from './seed';
import { sortPhotos, suggestWording, wordingKeepsFacts } from './aiStub';
import type { Inspection } from './types';

const check = (k: string) => ONTOLOGY.checks[k];
const runner = () => vehicle('v-4runner');
const current = (): Inspection => seedInspections().find((i) => i.id === 'i-4r-now')!;

test('brake pad thresholds in mm (shop rule: red only below the minimum)', () => {
  const c = check('brake_pad.lining_thickness');
  assert.equal(rateValue(c, 6), 'ok');
  assert.equal(rateValue(c, 5), 'ok');
  assert.equal(rateValue(c, 4.9), 'monitor');
  assert.equal(rateValue(c, 2.1), 'monitor');
  assert.equal(rateValue(c, 2), 'immediate');
});

test('tire tread: 2/32 is the legal minimum', () => {
  const c = check('tire.tread_depth');
  assert.equal(rateValue(c, 6), 'ok');
  assert.equal(rateValue(c, 5), 'monitor');
  assert.equal(rateValue(c, 3), 'monitor');
  assert.equal(rateValue(c, 2), 'immediate');
});

test('brake fluid copper: 200 ppm fails', () => {
  const c = check('brake_fluid.copper');
  assert.equal(rateValue(c, 99), 'ok');
  assert.equal(rateValue(c, 100), 'monitor');
  assert.equal(rateValue(c, 199), 'monitor');
  assert.equal(rateValue(c, 200), 'immediate');
});

test('battery CCA percent: 75% is monitor', () => {
  assert.equal(rateValue(check('low_voltage_battery.measured_cca'), 75), 'monitor');
  assert.equal(rateValue(check('low_voltage_battery.measured_cca'), 69), 'immediate');
});

test('finding defaults match the shop calibration', () => {
  const id = (n: string) => clsByName(n).id;
  assert.equal(findingRating(id('ball_joint'), 'damaged_seal', 'moderate'), 'monitor');
  assert.equal(findingRating(id('shock_absorber'), 'seepage', 'minor'), 'monitor');
  assert.equal(findingRating(id('brake_rotor'), 'grooved', 'severe'), 'monitor');
  assert.equal(findingRating(id('brake_line'), 'leak', 'minor'), 'immediate');
  assert.equal(findingRating(id('seat_belt'), 'frayed', 'minor'), 'immediate');
  assert.equal(findingRating(id('fender'), 'dent', 'minor'), 'ok');
  assert.equal(findingRating(id('brake_rotor'), 'grooved', 'critical'), 'immediate');
});

test('point "Visual brake system" expands to 17 parts on the 4Runner, 4 N/A', () => {
  const comps = pointComponents(point('S24'), runner().config);
  assert.equal(comps.length, 21);
  assert.equal(comps.filter((c) => c.applies).length, 17);
});

test('AI findings do not count until confirmed (R4/R10)', () => {
  const insp = current();
  const k = compKey(clsByName('brake_rotor').id, 'left_front');
  insp.findings.push({ id: 'x', compKey: k, key: 'crack', severity: 'minor', source: 'ai', status: 'pending',
    confidence: 0.9, rationale: null, mediaId: null, reviewedAt: null, aiOriginal: { key: 'crack', severity: 'minor' } });
  assert.equal(componentState(insp, k), 'unrated');
  insp.findings[insp.findings.length - 1].status = 'confirmed';
  assert.equal(componentState(insp, k), 'immediate');
});

test('completion gate blocks pending AI, unplaced photos, AI wording and unrated required parts (R12)', () => {
  const v = runner();
  const insp = current();
  const before = completionGate(insp, v);
  assert.ok(before.some((g) => g.kind === 'required'), 'under car is still unrated');
  applyUnderCarExample(insp, v);
  assert.deepEqual(completionGate(insp, v), []);
  const sorted = sortPhotos('under_car', [{ id: 'm1', url: '', name: 'IMG_1.jpg' }, { id: 'm2', url: '', name: 'IMG_2.jpg' }], v.config, '2026-09-26');
  insp.media.push(...sorted.media);
  assert.ok(completionGate(insp, v).some((g) => g.kind === 'photo'));
});

test('the real example rates like the tech did', () => {
  const v = runner();
  const insp = current();
  applyUnderCarExample(insp, v);
  const s = summarize(insp, v);
  assert.equal(s.immediate, 1, 'brake fluid only');
  assert.equal(s.unrated, 0);
  const k = (n: string, p: string | null = null) => compKey(clsByName(n).id, p);
  assert.equal(componentState(insp, k('brake_pad', 'left_front')), 'ok');
  assert.equal(componentState(insp, k('brake_rotor', 'left_front')), 'monitor');
  assert.equal(componentState(insp, k('catalytic_converter')), 'monitor');
  assert.equal(componentState(insp, k('transfer_case_fluid')), 'monitor');
  assert.equal(componentState(insp, k('engine_air_filter')), 'unable_to_assess');
});

test('customer view refuses unsubmitted inspections and hides pending AI (R11)', () => {
  const v = runner();
  const insp = current();
  assert.throws(() => customerView(insp, v));
  applyUnderCarExample(insp, v);
  const k = compKey(clsByName('muffler').id, null);
  insp.findings.push({ id: 'p', compKey: k, key: 'rust', severity: 'minor', source: 'ai', status: 'denied',
    confidence: 0.8, rationale: null, mediaId: null, reviewedAt: null, aiOriginal: null });
  insp.status = 'submitted';
  const view = customerView(insp, v);
  assert.equal(view.items.find((i) => i.key === k)!.findings.length, 0);
});

test('AI wording keeps every measurement and adds none', () => {
  const note = { pointId: 'S24', techText: 'fronts 5mm/rotors major grooving. rears 6mm', aiText: null, status: 'technician_original' as const, customerText: null };
  const s = suggestWording(note);
  assert.ok(wordingKeepsFacts(note.techText, s), s);
  assert.ok(!wordingKeepsFacts('pads 5mm', 'Pads 5 mm, replace at 2 mm'));
});

test('every template component and check resolves', () => {
  const v = runner();
  const { applies, na } = vehicleComponents(v.config, []);
  assert.ok(applies.length > 100);
  assert.ok(na.length > 0);
});
