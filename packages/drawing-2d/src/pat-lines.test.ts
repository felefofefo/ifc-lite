/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { expect, it } from 'vitest';
import type { DrawingPolygon } from './types.js';
import { patternSegments, surfacePatternSegments } from './pat-lines.js';

it('clips continuous PAT families around openings', () => {
  const polygon = { outer: [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],
    holes: [[{x:3,y:3},{x:7,y:3},{x:7,y:7},{x:3,y:7}]] };
  const lines = patternSegments(polygon, [{ angle:0,x:0,y:1,dx:0,dy:4,dash:[] }], 1);
  expect(lines.filter(l => l.start.y === 5).map(l => [l.start.x,l.end.x])).toEqual([[0,3],[7,10]]);
});

it('shifts dashes along the second row', () => {
  const polygon = { outer: [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}], holes: [] };
  const lines = patternSegments(polygon, [{ angle:0,x:0,y:1,dx:1,dy:4,dash:[2,-2] }], 1);
  expect(lines.filter(l => l.start.y === 5).map(l => [l.start.x,l.end.x])).toEqual([[1,3],[5,7],[9,10]]);
});

it('projects standard and custom strokes from face metres into a foreshortened drawing', () => {
  const polygon: DrawingPolygon = {
    entityId: 1, ifcType: 'IfcRoof', modelIndex: 0, isCut: false,
    polygon: { outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }], holes: [] },
    surfacePatternTransform: [1, 0, 0, 2, 0, 0],
  };
  const custom = surfacePatternSegments(polygon, {
    pattern: 'custom', spacing: 1, families: [{ angle: 0, x: 0, y: 0, dx: 0, dy: 2, dash: [] }],
  });
  expect(custom.some(({ start, end }) => start.y === 1 && end.y === 1)).toBe(true);
  const diagonal = surfacePatternSegments(polygon, { pattern: 'diagonal', spacing: 1 });
  expect(diagonal.some(({ start, end }) => {
    const dx = end.x - start.x;
    return Math.abs(dx) > 0.1 && Math.abs(Math.abs((end.y - start.y) / dx) - 0.5) < 1e-8;
  })).toBe(true);
});
