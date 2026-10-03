import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTurnOff, checkOff, clsByName, currentTemplate, DEFAULT_TEMPLATE, enabledChecks, partsLeftWithoutChecks, setDisabledChecks, setTemplate, withTemplate,
} from './ontology';
import { quickCheck } from './seed';
import type { Template } from './types';

const tire = clsByName('tire');
const pad = clsByName('brake_pad');
const courtesy = (): Template => ({ ...structuredClone(DEFAULT_TEMPLATE), id: 'courtesy', name: 'Courtesy check', checksOff: ['brake_pad.lining_thickness', 'brake_pad.wear_pattern'] });

test('a template turns checks off for its inspections; the quick OK uses a check that is on', () => {
  try {
    setTemplate(courtesy());
    assert.equal(checkOff('brake_pad.lining_thickness'), 'template');
    assert.deepEqual(enabledChecks(pad.id), ['brake_pad.visual']);
    assert.equal(quickCheck(pad.id), 'brake_pad.visual');
    setDisabledChecks(['brake_pad.lining_thickness'], []);
    assert.equal(checkOff('brake_pad.lining_thickness'), 'platform', 'Wrynch-wide wins');
  } finally { setDisabledChecks([], []); setTemplate(structuredClone(DEFAULT_TEMPLATE)); }
  assert.equal(checkOff('brake_pad.lining_thickness'), null, 'the standard template measures pads');
  assert.ok(enabledChecks(pad.id).includes('brake_pad.lining_thickness'));
});

test('another template can be installed for one piece of work', () => {
  const before = currentTemplate();
  const seen = withTemplate(courtesy(), () => enabledChecks(pad.id));
  assert.deepEqual(seen, ['brake_pad.visual']);
  assert.equal(currentTemplate(), before, 'the current template is put back');
  assert.equal(withTemplate(null, () => 7), 7);
});

test('a list can be checked before it is saved', () => {
  const draft = ['tire.age'];
  assert.equal(checkOff('tire.age', draft), 'template');
  assert.equal(checkOff('tire.age'), null, 'the installed template is unchanged');
  assert.ok(!enabledChecks(tire.id, draft).includes('tire.age'));
  assert.deepEqual(partsLeftWithoutChecks(draft), []);
  assert.deepEqual(partsLeftWithoutChecks(pad.checks), [pad.id], 'every pad check off leaves the pad without one');
});

test('older servers: a shop-wide list still counts', () => {
  try {
    setDisabledChecks([], ['tire.structure']);
    assert.equal(checkOff('tire.structure'), 'template');
    assert.notEqual(quickCheck(tire.id), 'tire.structure');
  } finally { setDisabledChecks([], []); }
  assert.equal(quickCheck(tire.id), 'tire.structure', 'back to the visual check');
});

test('a part always keeps at least one check', () => {
  const [last, ...rest] = tire.checks;
  assert.equal(canTurnOff(last, 'template', rest), false);
  assert.equal(canTurnOff(rest[0], 'template', rest), true, 'turning one back on is always fine');
  try {
    setDisabledChecks(rest, []);
    assert.equal(canTurnOff(last, 'platform'), false);
    assert.equal(canTurnOff(last, 'template', []), false, 'what Wrynch turned off counts too');
  } finally { setDisabledChecks([], []); }
  assert.equal(canTurnOff(last, 'platform', rest), true, 'template choices don\'t limit Wrynch-wide ones');
  const only = clsByName('vin_label');
  assert.equal(only.checks.length, 1);
  assert.equal(canTurnOff(only.checks[0]), false);
  assert.equal(canTurnOff('tire.made_up'), false);
  assert.deepEqual(enabledChecks(tire.id, tire.checks), tire.checks, 'never an empty list');
});
