import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterByCorner, positionFitsCorner } from './corner';
import { stageTargets } from './aiStub';
import { parseKey } from './ontology';
import { VEHICLES } from './seed';

test('a corner keeps its own corner, its side, its end and whole-vehicle parts', () => {
  assert.equal(positionFitsCorner('left_front', 'left_front'), true);
  assert.equal(positionFitsCorner('right_front', 'left_front'), false);
  assert.equal(positionFitsCorner('left_rear', 'left_front'), false);
  assert.equal(positionFitsCorner('left', 'left_front'), true);
  assert.equal(positionFitsCorner('right', 'left_front'), false);
  assert.equal(positionFitsCorner('front', 'left_front'), true);
  assert.equal(positionFitsCorner('rear', 'left_front'), false);
  assert.equal(positionFitsCorner(null, 'right_rear'), true);
});

test('a corner tag narrows the stage to parts that fit, and never to nothing', () => {
  const config = VEHICLES[0].config;
  const all = stageTargets('under_car', config);
  const rf = stageTargets('under_car', config, undefined, null, 'right_front');
  assert.ok(rf.length > 0 && rf.length < all.length);
  assert.ok(rf.every((k) => positionFitsCorner(parseKey(k).position, 'right_front')));
  assert.ok(!rf.some((k) => parseKey(k).position === 'left_front'));
  assert.deepEqual(filterByCorner(['1@left_front'], (k) => k, 'right_rear'), ['1@left_front'], 'falls back to everything rather than nothing');
});
