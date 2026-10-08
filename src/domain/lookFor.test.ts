// Every visual check says what to look for on that part; parts whose visual check was removed still have a check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ONTOLOGY } from './ontology';

const byName = (name: string) => ONTOLOGY.classes.find((c) => c.name === name)!;

test('no visual check falls back to the generic "look for applicable findings" text', () => {
  const visual = Object.values(ONTOLOGY.checks).filter((c) => c.method === 'visual');
  assert.ok(visual.length > 200);
  for (const c of visual) {
    assert.ok(!/applicable findings/i.test(c.how), `${c.key} has no part-specific look-fors`);
    assert.ok(c.how.length > 12, `${c.key}: "${c.how}"`);
  }
  assert.match(ONTOLOGY.checks['accessory_drive_belt.visual'].how, /ribs/);
});

test('removed visual checks: gone from the catalog, and each part keeps its other checks', () => {
  for (const name of ['automatic_transmission_fluid', 'thermostat', 'wheel_hub_bearing', 'warning_indicator', 'wiper_motor']) {
    const c = byName(name);
    assert.ok(!c.checks.includes(`${name}.visual`), name);
    assert.ok(c.checks.length > 0, `${name} still has a check`);
  }
  for (const c of ONTOLOGY.classes) assert.ok(c.checks.length > 0, `${c.name} has no checks`);
});
