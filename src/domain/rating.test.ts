import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONTOLOGY, aiFilingCheck, checkFindingOptions, clsByName, compKey, notedFindingOptions, vehicleComponents, pointComponents, point } from './ontology';
import { checkFindings, componentState, completionGate, customerView, findingRating, rateValue, summarize } from './rating';
import { applyUnderCarExample, seedInspections, vehicle } from './seed';
import { analyzePhotos, applyAnalysis, suggestWording, wordingKeepsFacts } from './aiStub';
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
  for (const id of ['m1', 'm2']) insp.media.push({ id, sectionId: 'under_car', url: '', label: `${id}.jpg`, excluded: false, customerVisible: true, analyzed: false, links: [] });
  applyAnalysis(insp, analyzePhotos('under_car', [{ id: 'm1', name: 'IMG_1.jpg' }, { id: 'm2', name: 'IMG_2.jpg' }], v.config));
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

test('one photo can show several parts; looks-OK suggestions count for nothing until confirmed', () => {
  const v = runner();
  const insp = current();
  insp.media.push({ id: 'p1', sectionId: 'under_car', url: '', label: 'wheel.jpg', excluded: false, customerVisible: true, analyzed: false, links: [] });
  const rotor = compKey(clsByName('brake_rotor').id, 'left_front');
  const caliper = compKey(clsByName('brake_caliper').id, 'left_front');
  applyAnalysis(insp, [{ mediaId: 'p1', parts: [
    { key: rotor, confidence: 0.9, condition: 'concern', note: '', findings: [{ key: 'grooved', severity: 'moderate', confidence: 0.8, rationale: '' }] },
    { key: caliper, confidence: 0.9, condition: 'looks_ok', note: 'dry', findings: [] }] }]);
  assert.equal(insp.media[insp.media.length - 1].links.length, 2);
  assert.equal(insp.observations.length, 1);
  assert.equal(componentState(insp, caliper), 'unrated', 'looks-OK alone rates nothing');
  assert.ok(completionGate(insp, v).some((g) => g.kind === 'photo' && g.id === 'p1'), 'unconfirmed AI links block finishing');
  applyAnalysis(insp, [{ mediaId: 'p1', parts: [{ key: rotor, confidence: 0.9, condition: 'looks_ok', note: '', findings: [] }] }]);
  assert.equal(insp.observations.length, 1, 'a photo is analysed once');
});

test('findings under a check explain its rating and do not rate the part again', () => {
  const i = structuredClone(current());
  const caliper = compKey(clsByName('brake_caliper').id, 'right_front');
  i.results = i.results.filter((r) => r.compKey !== caliper);
  i.findings = i.findings.filter((f) => f.compKey !== caliper);
  i.statuses = i.statuses.filter((s) => s.compKey !== caliper);
  i.results.push({ compKey: caliper, checkKey: 'brake_caliper.visual', value: null, rating: 'monitor', at: i.date });
  // "leak" at severe would be Immediate on its own; under a Monitor check it only says why.
  i.findings.push({ id: 'f-x', compKey: caliper, checkKey: 'brake_caliper.visual', key: 'leak', severity: 'critical', source: 'technician', status: 'confirmed',
    confidence: null, rationale: null, mediaId: null, reviewedAt: i.date, aiOriginal: null });
  assert.equal(componentState(i, caliper), 'monitor');
  assert.deepEqual(checkFindings(i, caliper, 'brake_caliper.visual').map((f) => f.key), ['leak']);
});

test('which findings a check offers: the catalog lists them per check, and every finding a part can have is offered', () => {
  for (const c of ONTOLOGY.classes) {
    const offered = new Set(c.checks.flatMap((k) => checkFindingOptions(k)));
    for (const k of c.checks) for (const f of ONTOLOGY.checks[k].failFindings) assert.ok(f in c.findings, `${k} offers ${f}, which ${c.name} can't have`);
    for (const f of Object.keys(c.findings)) assert.ok(offered.has(f), `${c.name}: no check offers ${f}`);
  }
  assert.deepEqual(checkFindingOptions('brake_pad.lining_thickness'), ONTOLOGY.checks['brake_pad.lining_thickness'].failFindings);
  assert.ok(checkFindingOptions('horn.operation').includes('inoperative'));
  // The general condition check doesn't repeat what a measuring check owns.
  assert.ok(!checkFindingOptions('tire.structure').includes('low_tread'), 'tread depth owns low tread');
  assert.ok(!checkFindingOptions('windshield.visual').includes('chip'), 'the damage check sizes chips');
  assert.ok(checkFindingOptions('wheel.condition').includes('scratch'), 'curb rash can be recorded');
});

test('a confirmed AI finding goes under the first check that offers it', () => {
  const id = (n: string) => clsByName(n).id;
  assert.equal(aiFilingCheck(id('brake_rotor'), 'grooved'), 'brake_rotor.surface', 'same check the database picks');
  assert.equal(aiFilingCheck(id('tire'), 'low_tread'), 'tire.tread_depth');
  assert.equal(aiFilingCheck(id('tire'), 'bulge'), 'tire.structure');
  assert.equal(aiFilingCheck(id('brake_caliper'), 'leak'), 'brake_caliper.function_leak');
  assert.equal(aiFilingCheck(id('brake_caliper'), 'corrosion'), 'brake_caliper.visual');
  assert.equal(aiFilingCheck(id('brake_caliper'), 'dent'), null, 'not a caliper finding');
  assert.equal(aiFilingCheck(id('tire'), 'low_tread', ['tire.tread_depth']), null, 'a check switched off in the template takes nothing');
});

test('a visual check rated OK can note existing cosmetic damage', () => {
  assert.deepEqual(notedFindingOptions('brake_pad.lining_thickness'), [], 'only visual checks');
  const noted = notedFindingOptions('vehicle_exterior.visual');
  assert.ok(noted.includes('scratch') && noted.includes('dent'));
  assert.ok(!noted.includes('crack'), 'a crack is never just noted');
});
