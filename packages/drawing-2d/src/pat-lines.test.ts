/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { expect, it } from 'vitest';
import { patternSegments } from './pat-lines.js';

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
