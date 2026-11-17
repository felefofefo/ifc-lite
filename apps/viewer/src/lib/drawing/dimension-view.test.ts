/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Measure2DResult } from '../../store/slices/drawing2DSlice';
import { assignDimensionView, dimensionViewKey, measurementsInView, temporaryDimensionViewKey } from './dimension-view';

const plan = { axis: 'down', position: 20, flipped: false, id: 'plane-a' } as const;
const section = { axis: 'front', position: 20, flipped: false, id: 'plane-b' } as const;
const measurement = (id: string): Measure2DResult => ({ id, start: { x: 0, y: 0 }, end: { x: 2, y: 0 }, distance: 2 });
const chain = (id: string, viewKey?: string): Measure2DResult => ({
  ...measurement(id), dimension: { chainId: id, anchors: [{ x: 0, y: 1 }, { x: 2, y: 1 }], viewKey },
});

it('keeps dimensions in their saved view even when another view has the same plane geometry', () => {
  const a = dimensionViewKey(plan, plan.id, 'plan-a', plan.id);
  const b = dimensionViewKey(plan, plan.id, 'plan-b', plan.id);
  const c = dimensionViewKey(section, section.id, 'section', section.id);
  assert.ok(a && b && c);
  const results = [chain('dimension-a', a), chain('dimension-b', b), chain('old-chain'), measurement('legacy-measurement')];
  assert.deepEqual(measurementsInView(results, a).map(result => result.id), ['dimension-a', 'legacy-measurement']);
  assert.deepEqual(measurementsInView(results, b).map(result => result.id), ['dimension-b', 'legacy-measurement']);
  assert.deepEqual(measurementsInView(results, c).map(result => result.id), ['legacy-measurement']);
  assert.equal(dimensionViewKey(plan, section.id, 'section', section.id), null);
});

it('uses a durable geometry key for a temporary view and separates elevations and orientations', () => {
  const key = temporaryDimensionViewKey(plan);
  assert.equal(dimensionViewKey({ ...plan, position: 20.000000000001, id: 'reopened' }, 'reopened'), key);
  assert.notEqual(temporaryDimensionViewKey(section), key);
  assert.notEqual(temporaryDimensionViewKey({ ...plan, position: 40 }), key);
  assert.notEqual(temporaryDimensionViewKey({ ...plan, flipped: true }), key);
});

it('promotes only chains belonging to the temporary view being saved', () => {
  const temporary = temporaryDimensionViewKey(plan);
  const saved = dimensionViewKey(plan, plan.id, 'plan', plan.id)!;
  const results = [chain('old-a'), chain('old-b'), chain('temporary', temporary), measurement('legacy')];
  const promoted = assignDimensionView(results, saved, temporary);
  assert.deepEqual(measurementsInView(promoted, saved).map(result => result.id), ['temporary', 'legacy']);
});
