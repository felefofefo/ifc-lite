/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { MeshOutlineProvider } from '@/hooks/meshOutlineProvider';
import { readIfcSpaceRooms, roomContourPolygons } from './ifc-space-rooms';

const outer = [0, 0, 10, 0, 10, 10, 0, 10];
const hole = [2, 2, 8, 2, 8, 8, 2, 8];
const island = [3, 3, 4, 3, 4, 4, 3, 4];
const room = { ifcType: 'IfcSpace', expressId: 32, positions: new Float32Array(9), indices: new Uint32Array(3) };
const plan: SectionPlaneConfig = { axis: 'y', position: 1.2, flipped: false };
const outline: MeshOutlineProvider = () => ({ axisMin: 0, axisMax: 3, contours: [new Float32Array(outer), new Float32Array(hole)] });

describe('read-only IFC room footprints', () => {
  it('keeps rooms from the current floor and ignores unrelated meshes', () => {
    const result = readIfcSpaceRooms([room, { ...room, ifcType: 'IfcWall', expressId: 99 }], plan, outline);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 32);
    assert.equal(result[0].polygons[0].holes.length, 1);
  });
  it('does not mistake duplicate mesh fragment outlines for room holes', () => {
    const result = readIfcSpaceRooms([room, { ...room }], plan, outline);
    assert.equal(result.length, 1);
    assert.equal(result[0].polygons.length, 1);
    assert.equal(result[0].polygons[0].holes.length, 1);
    assert.equal(result[0].contours.length, 2);
  });
  it('does not show another storey or manufacture contours without a provider', () => {
    assert.deepEqual(readIfcSpaceRooms([room], { ...plan, position: 10 }, outline), []);
    assert.deepEqual(readIfcSpaceRooms([room], plan, undefined), []);
    assert.deepEqual(readIfcSpaceRooms([room], { ...plan, axis: 'z' }, outline), []);
  });
  it('preserves islands inside voids as separate outer polygons', () => {
    const rings = [outer, hole, island].map(coords => {
      const points = [];
      for (let i = 0; i < coords.length; i += 2) points.push({ x: coords[i], y: coords[i + 1] });
      return points;
    });
    const result = roomContourPolygons(rings);
    assert.equal(result.length, 2);
    assert.equal(result[0].holes.length, 1);
    assert.equal(result[1].holes.length, 0);
  });
});
