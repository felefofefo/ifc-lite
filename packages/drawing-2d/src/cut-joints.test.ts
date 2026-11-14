/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { expect, it } from 'vitest';
import type { DrawingPolygon } from './types.js';
import { suppressCutJoints, suppressDrawingCutJoints } from './cut-joints.js';

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

it('clips normal projection at a cut miter without hiding overhead or other owners', () => {
  const a = polygon(1, 1, [[0, 0], [2, 0], [0, 2]]);
  const b = polygon(2, 1, [[0, 2], [2, 0], [2, 2]]);
  const line = {
    entityId: 1, modelIndex: 0, ifcType: 'IfcWall', category: 'projection' as const,
    visibility: 'visible' as const, depth: 0, depthEnd: 4,
    line: { start: {x: -1, y: 3}, end: {x: 3, y: -1} },
  };
  const overhead = { ...line, overhead: true as const };
  const other = { ...line, modelIndex: 1 };
  const result = suppressDrawingCutJoints({ cutPolygons: [a, b], lines: [line, overhead, other] }, p => String(p.materialId));
  expect(result.lines).toHaveLength(4);
  expect(result.lines[0].line.end.x).toBeCloseTo(0);
  expect(result.lines[0].depthEnd).toBeCloseTo(1);
  expect(result.lines[1].line.start.x).toBeCloseTo(2);
  expect(result.lines[1].depth).toBeCloseTo(3);
  expect(result.lines.slice(2)).toEqual([overhead, other]);
  expect(suppressDrawingCutJoints({ cutPolygons: [a, { ...b, materialId: 2 }], lines: [line] }, p => String(p.materialId)).lines).toEqual([line]);
});
