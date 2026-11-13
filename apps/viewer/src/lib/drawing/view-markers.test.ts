/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { collectViewMarkers, viewMarkerGraphics, nextViewCode, isViewCodeAvailable, viewMarker } from './view-markers.js';

test('allocates codes across the project and ignores case when checking conflicts', () => {
  const views = [{ id: 'a', code: 'c-01' }, { id: 'b', code: 'C-03' }];
  assert.equal(nextViewCode('section', views), 'C-02');
  assert.equal(isViewCodeAvailable(' C-01 ', views), false);
  assert.equal(isViewCodeAvailable('C-01', views, 'a'), true);
  assert.equal(nextViewCode('elevation', views), 'E-01');
});

test('uses the true oblique plane and mirrors line and arrow in a reflected plan', () => {
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 10 } };
  const plane = { axis: 'front' as const, position: 50, flipped: false,
    custom: { normal: [0.8, 0, -0.6] as [number, number, number], distance: -0.4,
      pickedAt: [1, 0, 2] as [number, number, number] } };
  const trace = [{ x: 1, y: 2 }, { x: 4, y: 6 }] as const;
  const marker = viewMarker(plane, bounds, false, trace)!;
  assert.deepEqual(marker.direction, { x: -0.8, y: 0.6 });
  assert.ok(Math.abs(marker.end.x - 4) < 1e-9);
  assert.ok(Math.abs(marker.end.y - 6) < 1e-9);
  const mirrored = viewMarker(plane, bounds, true, trace)!;
  assert.deepEqual(mirrored.direction, { x: 0.8, y: 0.6 });
  assert.equal(mirrored.end.x, -marker.end.x);
});

test('exports only the enabled kinds and keeps the looking arrow perpendicular', () => {
  const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 10 } };
  const plane = { axis: 'front' as const, position: 50, flipped: false };
  const markers = collectViewMarkers([
    { id: 's', kind: 'section', name: 'Section', code: 'C-01', planes: [plane], activeIndex: 0 },
    { id: 'e', kind: 'elevation', name: 'Elevation', code: 'E-01', planes: [plane], activeIndex: 0 },
  ], bounds, false, { section: false, elevation: true });
  assert.deepEqual(markers.map(m => m.code), ['E-01']);
  const { polylines, label } = viewMarkerGraphics(markers[0], 1);
  assert.equal(polylines.length, 3);
  assert.equal(label.x, 5);
  assert.ok(label.y < polylines[0][0].y);
});
