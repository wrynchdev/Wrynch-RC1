import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKeepsFacts, draftNote, factsText, pointFacts } from './noteDraft';
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
