/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { it } from 'node:test';
import { clickDimension, dimensionLine, finishDimensionPoints } from './dimension-line';

it('centers ticks on the snapped ends and puts the label above the line', () => {
  const start = { x: 2, y: 4 };
  const end = { x: 12, y: 4 };
  const dimension = dimensionLine(start, end, 2, 3);
  assert.ok(dimension);
  assert.deepEqual(dimension.ticks, [
    [{ x: 1, y: 5 }, { x: 3, y: 3 }],
    [{ x: 11, y: 5 }, { x: 13, y: 3 }],
  ]);
  assert.deepEqual(dimension.label, { x: 7, y: 1 });
  assert.deepEqual(dimensionLine(end, start, 2, 3)?.ticks, [...dimension.ticks].reverse());
});

it('keeps the tick legible on a vertical dimension and skips a zero-length preview', () => {
  const start = { x: 4, y: 2 };
  const end = { x: 4, y: 12 };
  const dimension = dimensionLine(start, end, 2, 3);
  assert.ok(dimension);
  assert.deepEqual(dimension.ticks[0], [{ x: 3, y: 1 }, { x: 5, y: 3 }]);
  assert.deepEqual(dimension.label, { x: 7, y: 7 });
  assert.equal(dimensionLine(start, start, 2, 3), null);
});

it('collects snapped points after the second point and places a continuous offset with a final click', () => {
  let draft = { points: [], placing: false } as ReturnType<typeof clickDimension>['draft'];
  for (const point of [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 5, y: 1 }]) {
    const result = clickDimension(draft, 'aligned', point, true);
    assert.deepEqual(result.segments, []);
    draft = result.draft;
  }
  const finish = clickDimension(draft, 'aligned', { x: 2, y: 8 }, false);
  assert.equal(finish.draft.placing, true);
  assert.deepEqual(finish.segments, []);
  const placed = clickDimension(finish.draft, 'aligned', { x: 7, y: -2 }, false);
  assert.deepEqual(placed.segments, [
    { start: { x: 0, y: -2 }, end: { x: 3, y: -2 }, distance: 3, anchors: [{ x: 0, y: 0 }, { x: 3, y: 0 }] },
    { start: { x: 3, y: -2 }, end: { x: 5, y: -2 }, distance: 2, anchors: [{ x: 3, y: 0 }, { x: 5, y: 1 }] },
  ]);
});

it('Escape can enter placement only after two valid points', () => {
  const first = { x: 1, y: 2 };
  assert.equal(finishDimensionPoints({ points: [first], placing: false }), null);
  const draft = { points: [first, { x: 4, y: 7 }], placing: false };
  const finish = finishDimensionPoints(draft);
  assert.ok(finish);
  assert.equal(finish.placing, true);
  assert.equal(finishDimensionPoints(finish), null);
  const { segments } = clickDimension(finish, 'vertical', { x: -3, y: 5 }, false);
  assert.equal(segments[0].distance, 5);
  assert.deepEqual(segments[0].start, { x: -3, y: 2 });
  assert.deepEqual(segments[0].end, { x: -3, y: 7 });
});

it('ignores coincident projected stations and orders a continuous chain along its axis', () => {
  const initial = { points: [{ x: 3, y: 1 }], placing: false };
  assert.equal(clickDimension(initial, 'horizontal', { x: 3, y: 9 }, true).draft, initial);
  const second = clickDimension(initial, 'horizontal', { x: 6, y: 9 }, false).draft;
  const third = clickDimension(second, 'horizontal', { x: 0, y: 3 }, true).draft;
  const { segments } = clickDimension(finishDimensionPoints(third)!, 'horizontal', { x: 5, y: 8 }, false);
  assert.deepEqual(segments.map((segment) => segment.start), [{ x: 0, y: 8 }, { x: 3, y: 8 }]);
  assert.deepEqual(segments.map((segment) => segment.distance), [3, 3]);
});
