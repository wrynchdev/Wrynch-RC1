// The iOS rules bundle, run the way JavaScriptCore runs it: a bare context with no Node or browser globals.
// Its answers must match the web app's rules for the same inspection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { completionGate, componentState, summarize } from '../../src/domain/rating';
import { pointStatus, visibleSections } from '../../src/domain/progress';
import type { Inspection, Vehicle } from '../../src/domain/types';

execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ios-domain.mjs'], { stdio: 'ignore' });
const bundle = readFileSync('ios/Wrynch/Resources/wrynch-domain.js', 'utf8');
const { inspection, vehicle } = JSON.parse(readFileSync('ios/WrynchTests/Fixtures/sample.json', 'utf8')) as { inspection: Inspection; vehicle: Vehicle };

function jsc() {
  const ctx = vm.createContext({});
  vm.runInContext('delete globalThis.structuredClone; delete globalThis.console;', ctx);
  vm.runInContext(bundle, ctx);
  return (name: string, ...args: unknown[]) => {
    const out = JSON.parse(vm.runInContext(`WrynchCall(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(args))})`, ctx) as string);
    if (out.error) throw new Error(out.error);
    return out.ok;
  };
}

test('the bundle runs without browser or Node globals and reports errors as data', () => {
  const call = jsc();
  assert.ok(call('configure', null, null, null).points > 30);
  assert.throws(() => call('nope'), /Unknown function nope/);
  assert.throws(() => call('point', inspection, vehicle, 'NOT-A-POINT'), /./);
});

test('overview matches the web app: summary, gate, stages and point progress', () => {
  const call = jsc();
  call('configure', null, null, null);
  const o = call('overview', inspection, vehicle);
  assert.deepEqual(o.summary, summarize(inspection, vehicle));
  assert.equal(o.gateCount, completionGate(inspection, vehicle).length);
  assert.deepEqual(o.stages.map((s: { id: string }) => s.id), visibleSections(vehicle).map((s) => s.id));
  for (const s of o.stages) for (const p of s.points) {
    const st = pointStatus(inspection, vehicle, p.id);
    assert.equal(p.state, st.state, p.id);
    assert.equal(p.done, st.done, p.id);
  }
  assert.ok(o.stages.find((s: { id: string }) => s.id === 'under_car').pending > 0, 'AI items to review in the stage with photos');
});

test('point, part, sort, place and finish give each screen what it shows', () => {
  const call = jsc();
  call('configure', null, null, null);
  const p = call('point', inspection, vehicle, 'S24');
  assert.equal(p.name, 'Visual brake system condition');
  const firstPart = p.groups[0].parts[0];
  assert.equal(firstPart.state, componentState(inspection, firstPart.key));

  const pending = inspection.findings.find((f) => f.source === 'ai' && f.status === 'pending')!;
  const part = call('part', inspection, vehicle, pending.compKey);
  assert.ok(part.pendingFindings.some((f: { id: string }) => f.id === pending.id));
  assert.ok(part.checks.length > 0 && part.findingOptions.length > 0);

  const sorted = call('sort', inspection, vehicle, 'under_car');
  assert.equal(sorted.total, 6);
  assert.ok(sorted.proposedLinks > 0);
  const placed = call('place', inspection, vehicle, 'm-1');
  assert.ok(placed.groups[0].sameStage, 'the photo’s own stage comes first');

  const f = call('finish', inspection, vehicle);
  assert.equal(f.gateCount, completionGate(inspection, vehicle).length);
  assert.ok(f.items.some((i: { kind: string }) => i.kind === 'photo'));
  assert.deepEqual(call('summary', inspection, vehicle), summarize(inspection, vehicle));
});

test('shop settings reach the rules: turned-off checks are hidden on the part screen', () => {
  const call = jsc();
  call('configure', null, null, { platform: [], shop: ['tire.age'] });
  const tire = call('part', { ...inspection, results: [] }, vehicle, '4@left_front');
  assert.ok(!tire.checks.some((c: { key: string }) => c.key === 'tire.age'));
  call('configure', null, null, null);
  assert.ok(call('part', { ...inspection, results: [] }, vehicle, '4@left_front').checks.some((c: { key: string }) => c.key === 'tire.age'));
  const items = call('untouched', inspection, vehicle, 'S22');
  assert.ok(Array.isArray(items));
});
