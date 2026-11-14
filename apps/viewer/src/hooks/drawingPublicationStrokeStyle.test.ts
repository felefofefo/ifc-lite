/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphicOverrideEngine, type DrawingLine, type GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import { drawingPublicationStrokeStyle } from './drawingPublicationStrokeStyle';

test('keeps cut and projection pens independent and applies the distant pen last', () => {
  const template: GraphicOverrideRule = { id: 'template', name: 'Wall', criteria: { type: 'all' }, enabled: true, priority: 0,
    style: { lineWeight: 0.5, lineStyle: 'solid', projectionLineWeight: 'light', projectionLineStyle: 'dotted' } };
  const rule: GraphicOverrideRule = { ...template, id: 'rule', priority: 1000, style: { projectionLineStyle: 'dashed' } };
  const weights = { heavy: 0.5, medium: 0.35, light: 0.17, hairline: 0.1 };
  const pen = drawingPublicationStrokeStyle(weights,
    { overridesEnabled: true, overrideEngine: new GraphicOverrideEngine([template, rule], weights), getElementProperties: () => undefined },
    { offset: 2, fade: 0, color: '#888888', weight: 0.09 })!;
  const line: DrawingLine = { category: 'projection', visibility: 'visible', entityId: 1, modelIndex: 0, ifcType: 'IfcWall',
    depth: 3, line: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } };
  assert.equal(pen(line, 'cut').lineWeight, 0.5);
  assert.deepEqual(pen(line, 'cut').dash, []);
  assert.equal(pen(line, 'projection', line).lineWeight, 0.17);
  assert.ok(pen(line, 'projection', line).dash?.length);
  assert.equal(pen(line, 'projection', { ...line, distant: true }).lineWeight, 0.09);
  assert.equal(pen(line, 'projection', { ...line, distant: true }).color, '#888888');
});
