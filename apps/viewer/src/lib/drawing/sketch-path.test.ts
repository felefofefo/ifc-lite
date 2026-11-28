/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { sketchPath, sketchRectangle, constrainSketchPoint, sketchMeasures } from './sketch-input.js';
const a = { x: 0, y: 0 }, b = { x: 3, y: 0 }, c = { x: 3, y: 4 };
it('a straight line is open, exact and not a measured area', () => {
  assert.deepEqual(sketchPath([a, b], false), { points: [a, b], area: 0, perimeter: 3, pathClosed: false });
});
it('open polyline omits the closing edge', () => assert.equal(sketchPath([a, b, c], false)?.perimeter, 7));
it('closed path includes the closing edge without becoming an area', () => {
  const path = sketchPath([a, b, c], true)!;
  assert.equal(path.perimeter, 12); assert.equal(path.area, 0); assert.equal(path.pathClosed, true);
});
it('rectangle becomes a closed path with no surface measurement', () => {
  const rect = sketchRectangle(a, c)!;
  assert.equal(sketchPath(rect.points, true)?.perimeter, 14);
  assert.equal(sketchPath(rect.points, true)?.area, 0);
});
it('rejects invalid/collapsed paths', () => {
  for (const points of [[], [a], [a, a], [a, { x: Infinity, y: 1 }]]) assert.equal(sketchPath(points, false), null);
  assert.equal(sketchPath([a, b], true), null);
});
it('does not mutate or retain live source points', () => {
  const points = [{ ...a }, { ...b }]; const path = sketchPath(points, false)!;
  points[1].x = 5; assert.equal(path.points[1].x, 3);
});
it('path tools share the numeric input and exact angular lock', () => {
  for (const shape of ['line', 'polyline'] as const) {
    const result = constrainSketchPoint(shape, a, { x: 1, y: 1 }, null, { first: '2.5', second: '90' });
    assert.deepEqual(result?.point, { x: 0, y: 2.5 });
    assert.equal(sketchMeasures(shape, a, result!.point).first, 2.5);
  }
});
