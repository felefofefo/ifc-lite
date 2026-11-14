/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, it } from 'vitest';
import type { DrawingPolygon } from './types.js';
import { suppressCutJoints } from './cut-joints.js';

function polygon(entityId: number, materialId: number, points: [number, number][]): DrawingPolygon {
  return { entityId, materialId, ifcType: 'IfcWall', modelIndex: 0, isCut: true,
    polygon: { outer: points.map(([x, y]) => ({ x, y })), holes: [] } };
}

it('removes a miter between equal materials while preserving both source polygons', () => {
  const a = polygon(1, 1, [[0, 0], [2, 0], [0, 2]]);
  const b = polygon(2, 1, [[0, 2], [2, 0], [2, 2]]);
  const result = suppressCutJoints([a, b], p => String(p.materialId));
  expect(result.map(p => p.cutOutline?.length)).toEqual([2, 2]);
  expect(result.map(p => p.polygon)).toEqual([a.polygon, b.polygon]);
  expect(result.map(p => p.entityId)).toEqual([1, 2]);
});

it('splits a T joint at both ends without discarding the rest of the wall edge', () => {
  const a = polygon(1, 1, [[0, 0], [4, 0], [4, 1], [0, 1]]);
  const b = polygon(2, 1, [[1, 1], [1, 3], [2, 3], [2, 1]]);
  const result = suppressCutJoints([a, b], p => String(p.materialId));
  const edge = result[0].cutOutline?.filter(l => l.start.y === 1 && l.end.y === 1);
  expect(edge?.map(l => [l.start.x, l.end.x])).toEqual([[4, 2], [1, 0]]);
});

it('preserves different materials, unknown materials and same-side contours', () => {
  const a = polygon(1, 1, [[0, 0], [2, 0], [0, 2]]);
  const b = polygon(2, 2, [[0, 2], [2, 0], [2, 2]]);
  const c = { ...a, entityId: 3 };
  for (const [other, material] of [[b, undefined], [c, 'same']] as const) {
    expect(suppressCutJoints([a, other], p => material ?? String(p.materialId))).toEqual([a, other]);
  }
  expect(suppressCutJoints([a, { ...b, materialId: 1 }], () => undefined).every(p => !p.cutOutline)).toBe(true);
});
