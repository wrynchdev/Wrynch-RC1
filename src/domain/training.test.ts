import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBox, labelParts, splitOf, toYoloManifest, validBox } from './training';
import { clsByName, compKey } from './ontology';

test('boxes stay inside the photo and keep a minimum size', () => {
  assert.deepEqual(clampBox({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 }), { x: 0, y: 0.9, w: 0.5, h: 0.1 });
  assert.equal(clampBox({ x: 0.5, y: 0.5, w: 0, h: 0 }).w, 0.005);
  assert.equal(validBox({ classId: 1, x: 0.1, y: 0.1, w: 0.95, h: 0.2 }), false);
  assert.equal(validBox({ classId: 1, x: 0.1, y: 0.1, w: 0.5, h: 0.2 }), true);
});

test('labels come from the confirmed parts; position is metadata, not a class', () => {
  const rotor = clsByName('brake_rotor').id;
  const [l] = labelParts([compKey(rotor, 'left_front')]);
  assert.deepEqual([l.classId, l.position], [rotor, 'left_front']);
  assert.match(l.label, /rotor/i);
});

test('YOLO export: classes by part type, center-based rows, a stable train/val split', () => {
  const rotor = clsByName('brake_rotor').id, pad = clsByName('brake_pad').id;
  const m = toYoloManifest([
    { mediaId: 'a', url: 'u1', width: 800, height: 600, boxes: [{ classId: pad, position: 'left_front', x: 0.1, y: 0.2, w: 0.2, h: 0.4, source: 'human' }] },
    { mediaId: 'b', url: 'u2', width: 800, height: 600, boxes: [{ classId: rotor, position: 'right_front', x: 0.5, y: 0.5, w: 0.2, h: 0.2, source: 'ai' }, { classId: rotor, position: null, x: 0.9, y: 0.1, w: 0.5, h: 0.1, source: 'ai' }] },
  ], new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(m.classes.map((c) => c.classId), [rotor, pad].sort((x, y) => x - y));
  const padIdx = m.classes.find((c) => c.classId === pad)!.index;
  assert.deepEqual(m.images[0].labels, [[padIdx, 0.2, 0.4, 0.2, 0.4]]);
  assert.equal(m.images[1].labels.length, 1, 'boxes outside the photo are dropped');
  assert.equal(splitOf('a'), splitOf('a'));
  const n = Array.from({ length: 1000 }, (_, i) => splitOf(`m${i}`)).filter((s) => s === 'val').length;
  assert.ok(n > 60 && n < 140, `about 10% validation (${n})`);
});
