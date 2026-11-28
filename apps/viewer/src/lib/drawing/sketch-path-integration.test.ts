/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { PolygonArea2DResult, Point2D } from '@/store/slices/drawing2DSlice';
import { hitTestAnnotations } from '@/hooks/annotation2DHitTest';
import { drawingAnnotationDxf } from '@/lib/export/drawing-annotation-dxf';
import { expandDrawingAnnotationBounds } from '@/lib/export/drawing-annotation-pdf';
import { DETAIL_PATH_WEIGHT_MM } from './annotation-types.js';
import { sketchPath } from './sketch-input.js';
const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const path = (closed: boolean): PolygonArea2DResult => ({ id: 'path', viewKey: 'view:test', ...sketchPath(points, closed)! });
const area: PolygonArea2DResult = { id: 'area', viewKey: 'view:test', points, area: 10000, perimeter: 400 };
const pick = (record: PolygonArea2DResult, screenX: number, screenY: number, genuineOnly = false) => hitTestAnnotations({
  screenX, screenY, threshold: 10, drawingToScreen: (p: Point2D) => p,
  polys: [record], texts: [], clouds: [], measures: [], genuineOnly,
});
it('open path cannot be hit on an implicit closing edge', () => {
  assert.equal(pick(path(false), 0, 50), null);
  assert.deepEqual(pick(path(false), 100, 50, true), { type: 'polygon', id: 'path' });
});
it('closed path is selectable on its closing edge but not its empty interior', () => {
  assert.deepEqual(pick(path(true), 0, 50), { type: 'polygon', id: 'path' });
  assert.equal(pick(path(true), 50, 50), null);
});
it('legacy area remains selectable by its interior', () => {
  assert.deepEqual(pick(area, 50, 50, true), { type: 'polygon', id: 'area' });
});
it('two-point path has a valid hit target', () => {
  const line = { id: 'line', ...sketchPath(points.slice(0, 2), false)! };
  assert.deepEqual(pick(line, 50, 0), { type: 'polygon', id: 'line' });
});
it('DXF preserves open/closed state, coordinates and drafting pen', () => {
  const output = drawingAnnotationDxf([path(false), path(true), area], [], [], 100);
  assert.equal(output.polylineLayers.length, 3);
  const [open, closed, legacy] = output.polylineLayers;
  assert.equal(open.name, 'ROVE-LINES'); assert.equal(open.closed, false);
  assert.equal(open.lineWeight, DETAIL_PATH_WEIGHT_MM); assert.deepEqual(open.polylines[0], points);
  assert.equal(closed.closed, true); assert.equal(legacy.name, 'ROVE-AREAS');
  assert.equal(output.labels.length, 0);
});
it('PDF bounds include a two-point path outside the model', () => {
  const line = { id: 'line', ...sketchPath([{ x: -3, y: -2 }, { x: 12, y: 20 }], false)! };
  const bounds = { min: { x: 0, y: 0 }, max: { x: 1, y: 1 } };
  assert.deepEqual(expandDrawingAnnotationBounds(bounds, [line], [], [], 100), { min: { x: -3, y: -2 }, max: { x: 12, y: 20 } });
});
