/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GraphicOverrideEngine, type DrawingPolygon, type GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import { resolveCutPolygonStyle, type CutPolygonStyleContext } from './cut-polygon-style.js';

const polygon: DrawingPolygon = {
  polygon: { outer: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], holes: [] },
  ifcType: 'IfcWall', entityId: 7, modelIndex: 0, isCut: true,
  color: [0, 1, 0, 0.25],
};
const rule = (style: GraphicOverrideRule['style'], enabled = true, ifcType = 'IfcWall'): GraphicOverrideRule => ({
  id: 'wall', name: 'Wall', enabled, priority: 1,
  criteria: { type: 'ifcType', ifcTypes: [ifcType] }, style,
});
const context = (rules: GraphicOverrideRule[], overridesEnabled = true): CutPolygonStyleContext => ({
  useIfcMaterials: true, entityColorMap: new Map(), overridesEnabled,
  overrideEngine: new GraphicOverrideEngine(rules), getElementProperties: () => undefined,
});

describe('explicit fill overrides take precedence over IFC materials', () => {
  it('applies an authored fill without overwriting the material opacity', () => {
    const result = resolveCutPolygonStyle(polygon, context([rule({ fillColor: '#FFCDD2' })]));
    assert.equal(result.fillColor, '#FFCDD2');
    assert.equal(result.fillOpacity, 0.25);
  });

  it('supports an explicit opacity independently of the material fill', () => {
    const original = resolveCutPolygonStyle(polygon, context([]));
    const result = resolveCutPolygonStyle(polygon, context([rule({ opacity: 0.8 })]));
    assert.equal(result.fillColor, original.fillColor);
    assert.equal(result.fillOpacity, 0.8);
  });

  it('does not replace a material fill with the resolved default for stroke-only, disabled or nonmatching rules', () => {
    const original = resolveCutPolygonStyle(polygon, context([]));
    for (const rules of [
      [rule({ strokeColor: '#1976D2' })],
      [rule({ fillColor: '#FFCDD2' }, false)],
      [rule({ fillColor: '#FFCDD2' }, true, 'IfcSlab')],
    ]) {
      const result = resolveCutPolygonStyle(polygon, context(rules));
      assert.equal(result.fillColor, original.fillColor);
      assert.equal(result.fillOpacity, original.fillOpacity);
    }
  });

  it('does not apply disabled overrides or repaint untouched materials', () => {
    const original = resolveCutPolygonStyle(polygon, context([], false));
    const result = resolveCutPolygonStyle(polygon, context([rule({ fillColor: 'none' })], false));
    assert.deepEqual(result, original);
  });
});
