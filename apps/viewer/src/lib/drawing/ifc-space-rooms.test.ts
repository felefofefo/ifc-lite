/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { MeshOutlineProvider } from '@/hooks/meshOutlineProvider';
import { readIfcSpaceRooms, roomContourPolygons, roomFootprintArea, pickRoomInterior } from './ifc-space-rooms';

const outer = [0, 0, 10, 0, 10, 10, 0, 10];
const hole = [2, 2, 8, 2, 8, 8, 2, 8];
const island = [3, 3, 4, 3, 4, 4, 3, 4];
const room = { ifcType: 'IfcSpace', expressId: 32, positions: new Float32Array(9), indices: new Uint32Array(3) };
const plan: SectionPlaneConfig = { axis: 'y', position: 1.2, flipped: false };
const outline: MeshOutlineProvider = () => ({ axisMin: 0, axisMax: 3, contours: [new Float32Array(outer), new Float32Array(hole)] });

const ring = (x: number, y: number, width: number, height: number) => [
  { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height },
];
const box = (x: number, y: number, width: number, height: number) => ({ outer: ring(x, y, width, height), holes: [] });

describe('IFC space tag area and interior', () => {
  it('subtracts holes and reports disjoint component areas in square metres', () => {
    const a = { outer: ring(0, 0, 10, 10), holes: [ring(2, 2, 6, 6)] };
    assert.equal(roomFootprintArea([a]), 64);
    assert.equal(roomFootprintArea([a, box(12, 0, 2, 3)]), 70);
  });
  it('does not report a misleading area for overlapping fragments', () => {
    const polygons = roomContourPolygons([ring(0, 0, 10, 10), ring(8, 8, 4, 4)]);
    assert.equal(polygons.length, 2);
    assert.equal(roomFootprintArea(polygons), undefined);
  });
  it('rejects potentially overlapping holes and empty geometry', () => {
    assert.equal(roomFootprintArea([{ outer: ring(0, 0, 10, 10), holes: [ring(2, 2, 4, 4), ring(4, 4, 4, 4)] }]), undefined);
    assert.equal(roomFootprintArea([]), undefined);
  });
  it('prefers the smaller containing room and ignores voids', () => {
    const outer = { id: 1, polygons: [{ outer: ring(0, 0, 10, 10), holes: [ring(2, 2, 2, 2)] }] };
    const inner = { id: 2, polygons: [box(5, 5, 2, 2)] };
    assert.equal(pickRoomInterior([outer, inner], { x: 6, y: 6 })?.id, 2);
    assert.equal(pickRoomInterior([outer, inner], { x: 3, y: 3 }), undefined);
    assert.equal(pickRoomInterior([outer, inner], { x: 1, y: 1 })?.id, 1);
    assert.equal(pickRoomInterior([outer, inner], { x: 20, y: 20 }), undefined);
  });
});

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
