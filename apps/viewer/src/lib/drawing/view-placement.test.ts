/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planCutPosition, supportsDrawingProjection, verticalViewPlane, verticalProjectionDepth } from './view-placement.js';

const bounds = { min: { x: 0, y: -1, z: 0 }, max: { x: 10, y: 8, z: 10 } };
test('uses the correct viewing side and upright drawing basis for an oblique plan line', () => {
  const a = { x: 1, y: 2 }, b = { x: 4, y: 6 };
  const plane = verticalViewPlane(a, b, false, false)!;
  assert.deepEqual(plane.normal, [0.8, 0, -0.6]);
  assert.deepEqual(plane.tangent, [-0.6, 0, -0.8]);
  assert.deepEqual(plane.bitangent, [0, 1, 0]);
  assert.ok(Math.abs(plane.distance - (4 * 0.8 - 6 * 0.6)) < 1e-9);
  assert.deepEqual(verticalViewPlane(a, b, false, true)?.normal, [-0.8, 0, 0.6]);
  assert.deepEqual(verticalViewPlane(a, b, true, false)?.normal, [-0.8, 0, -0.6]);
  assert.equal(verticalViewPlane(a, a, false, false), null);
});
test('covers the far corner behind a vertical plane and allows cuts outside the model height', () => {
  const plane = verticalViewPlane({ x: 0, y: 12 }, { x: 8, y: 12 }, false, false)!;
  assert.equal(verticalProjectionDepth(bounds, plane, true), 12);
  assert.equal(planCutPosition(11, bounds), 100 * (12 / 9));
  assert.equal(planCutPosition(NaN, bounds), null);
});

test('projection is available for vertical planes, including oblique plans, with the existing cardinal path', () => {
  assert.equal(supportsDrawingProjection({}), true);
  assert.equal(supportsDrawingProjection({ custom: { normal: [0.8, 0, -0.6] } }), true);
  assert.equal(supportsDrawingProjection({ custom: { normal: [0.8, 0.6, 0] } }), false);
});
