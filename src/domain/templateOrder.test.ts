import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TEMPLATE } from './ontology';
import { optimizeOrder } from './templateOrder';
import type { Template } from './types';

const names = (t: Template, stage: string) => t.sections.find((s) => s.id === stage)!.points.map((p) => p.name);

test('under the car: a lap of the wheels clockwise from the driver side, then front to back underneath', () => {
  const { template, stagesMoved } = optimizeOrder(DEFAULT_TEMPLATE);
  const under = names(template, 'under_car');
  assert.deepEqual(under.slice(0, 5), ['LF tire', 'RF tire', 'RR tire', 'LR tire', 'Visual brake system condition']);
  assert.equal(under[5], 'Front differential');
  assert.equal(under.at(-1), 'Rear differential');
  assert.ok(under.indexOf('Steering components (tie rods, steering gear, etc.)') < under.indexOf('Exhaust system'));
  assert.equal(stagesMoved, false, 'the standard stages are already in shop order');
});

test('stages that are already in working order stay as they are', () => {
  const { template } = optimizeOrder(DEFAULT_TEMPLATE);
  assert.deepEqual(names(template, 'road_test'), names(DEFAULT_TEMPLATE, 'road_test'));
  const hood = names(template, 'under_hood');
  assert.equal(hood[0], 'Hood latch and cables');
  assert.ok(hood.indexOf('Engine oil') < hood.indexOf('Hoses and belts'));
});

test('nothing is added, dropped or moved to another stage, and a second run changes nothing', () => {
  const once = optimizeOrder(DEFAULT_TEMPLATE).template;
  for (const s of DEFAULT_TEMPLATE.sections) {
    const after = once.sections.find((x) => x.id === s.id)!;
    assert.deepEqual(after.points.map((p) => p.id).sort(), s.points.map((p) => p.id).sort());
  }
  assert.equal(optimizeOrder(once).moved, 0);
});

test('a point with no parts stays right after the point it followed', () => {
  const under = DEFAULT_TEMPLATE.sections.find((s) => s.id === 'under_car')!;
  const lr = under.points.find((p) => p.name === 'LR tire')!;
  const lf = under.points.find((p) => p.name === 'LF tire')!;
  const t: Template = { id: 't', name: 'T', sections: [{ id: 'x', name: 'X', points: [lr, { id: 'n', name: 'Noise noticed', note: null, components: [] }, lf] }] };
  assert.deepEqual(optimizeOrder(t).template.sections[0].points.map((p) => p.name), ['LF tire', 'LR tire', 'Noise noticed']);
});

test('stages go in shop order: under the hood before the car goes up', () => {
  const [road, hood, under, ev] = DEFAULT_TEMPLATE.sections;
  const t: Template = { ...DEFAULT_TEMPLATE, sections: [under, hood, road, ev] };
  const r = optimizeOrder(t);
  assert.deepEqual(r.template.sections.map((s) => s.id), ['road_test', 'under_hood', 'under_car', ev.id]);
  assert.equal(r.stagesMoved, true);
});
