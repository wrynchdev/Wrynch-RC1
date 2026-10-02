import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTurnOff, checkOff, clsByName, enabledChecks, setDisabledChecks } from './ontology';
import { quickCheck } from './seed';

const tire = clsByName('tire');

test('turned-off checks leave the part, and the quick OK uses a check that is on', () => {
  try {
    setDisabledChecks([], ['tire.structure']);
    assert.equal(checkOff('tire.structure'), 'shop');
    assert.ok(!enabledChecks(tire.id).includes('tire.structure'));
    assert.notEqual(quickCheck(tire.id), 'tire.structure');
    setDisabledChecks(['tire.age'], []);
    assert.equal(checkOff('tire.age'), 'platform', 'Wrynch-wide wins');
  } finally { setDisabledChecks([], []); }
  assert.equal(quickCheck(tire.id), 'tire.structure', 'back to the visual check');
});

test('a part always keeps at least one check', () => {
  try {
    const [last, ...rest] = tire.checks;
    setDisabledChecks([], rest);
    assert.equal(canTurnOff(last), false);
    assert.equal(canTurnOff(last, 'platform'), true, 'shop choices don\'t limit Wrynch-wide ones');
    assert.equal(canTurnOff(rest[0]), true, 'turning one back on is always fine');
    const only = clsByName('vin_label');
    assert.equal(only.checks.length, 1);
    assert.equal(canTurnOff(only.checks[0]), false);
    assert.equal(canTurnOff('tire.made_up'), false);
    setDisabledChecks([], tire.checks);
    assert.deepEqual(enabledChecks(tire.id), tire.checks, 'never an empty list');
  } finally { setDisabledChecks([], []); }
});
