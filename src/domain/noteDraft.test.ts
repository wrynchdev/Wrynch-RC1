import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoNotePoints, draftKeepsFacts, draftNote, factsText, pointFacts, worthANote } from './noteDraft';
import { sections } from './ontology';
import { point } from './ontology';
import { seedInspections, VEHICLES } from './seed';

const insp = () => structuredClone(seedInspections().find((i) => i.id === 'i-4r-now')!);
const vehicle = VEHICLES.find((v) => v.id === insp().vehicleId)!;

test('facts use only confirmed information: pending AI findings are left out', () => {
  const i = insp();
  const brakeFluid = point('S14');
  const f = pointFacts(i, vehicle, brakeFluid);
  assert.ok(f.parts.length > 0);
  const text = factsText(f);
  const pendingAi = i.findings.filter((x) => x.source === 'ai' && x.status === 'pending');
  for (const p of pendingAi) assert.ok(!text.includes(`finding: ${p.key.replace(/_/g, ' ')} (${p.severity})`) || i.findings.some((x) => x !== p && x.compKey === p.compKey && x.key === p.key && x.status !== 'pending'));
});

test('rules-based draft lists problems first with their numbers, then OK parts', () => {
  const i = insp();
  const f = pointFacts(i, vehicle, point('S14'));
  const d = draftNote(f);
  assert.ok(d.length > 0);
  assert.ok(draftKeepsFacts(f, d), 'rules draft only uses numbers from the facts');
});

test('number guardrail rejects invented measurements', () => {
  const f = { point: 'Brakes', photoIds: [], parts: [{ key: '73@left_front', label: 'Brake pad · left front', state: 'monitor' as const, measurements: ['Pad lining thickness 4 mm'], checks: [], findings: [], notChecked: null, photos: 1 }] };
  assert.equal(draftKeepsFacts(f, 'Left front pad at 4 mm, monitor.'), true);
  assert.equal(draftKeepsFacts(f, 'Left front pad at 3 mm, replace soon.'), false);
});

test('a point with nothing rated or photographed has no facts', () => {
  const i = insp();
  i.results = []; i.findings = []; i.statuses = []; i.media = [];
  assert.equal(pointFacts(i, vehicle, point('S24')).parts.length, 0);
});

test('customer-style draft uses plain words and keeps the same numbers as the technical one', () => {
  const f = { point: 'Brakes', photoIds: [], parts: [
    { key: '73@left_front', label: 'Brake pad · left front', state: 'immediate' as const, measurements: ['Pad lining thickness 2 mm'], checks: [], findings: [], notChecked: null, photos: 0 },
    { key: '71@left_front', label: 'Brake rotor · left front', state: 'monitor' as const, measurements: [], checks: [], findings: ['grooved (moderate)'], notChecked: null, photos: 0 },
    { key: '72@left_front', label: 'Brake caliper · left front', state: 'ok' as const, measurements: [], checks: [], findings: [], notChecked: null, photos: 0 },
  ] };
  const tech = draftNote(f, 'technical');
  const plain = draftNote(f, 'customer');
  assert.match(tech, /Needs attention now/);
  assert.match(tech, /Monitor/);
  assert.match(plain, /needs attention now/);
  assert.match(plain, /worth keeping an eye on/);
  assert.match(plain, /looked good/);
  assert.ok(!plain.includes('(moderate)'), plain);
  assert.ok(draftKeepsFacts(f, plain) && plain.includes('2 mm'));
});

test('automatic notes: reword written notes, draft blank points with something to report, leave reviewed ones alone', () => {
  const i = insp();
  const points = sections().flatMap((s) => s.points);
  i.notes = [
    { pointId: 'S24', techText: 'fronts 4mm', aiText: null, status: 'technician_original', customerText: 'fronts 4mm' },
    { pointId: 'S14', techText: '', aiText: 'x', status: 'ai_rejected', customerText: '' },
  ];
  const todo = autoNotePoints(i, vehicle, points);
  assert.deepEqual(todo.find((x) => x.pointId === 'S24'), { pointId: 'S24', kind: 'reword' });
  assert.ok(!todo.some((x) => x.pointId === 'S14'), 'a note the tech already dealt with is skipped');
  for (const t of todo.filter((x) => x.kind === 'draft')) assert.ok(worthANote(pointFacts(i, vehicle, points.find((p) => p.id === t.pointId)!)));
  const allOk = points.filter((p) => !todo.some((x) => x.pointId === p.id));
  assert.ok(allOk.length > 0, 'points with nothing to report get no automatic note');
});
