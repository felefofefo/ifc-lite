/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suppressCutJoints, type DrawingLine, type DrawingPolygon } from '@ifc-lite/drawing-2d';
import { capOverlayHasContent, capOverlayInput } from './cap-overlay.js';

const line = (extra: Partial<DrawingLine>): DrawingLine => ({
  line: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
  category: 'cut',
  visibility: 'visible',
  entityId: 1,
  ifcType: 'IfcBuildingElementProxy',
  modelIndex: 0,
  depth: 0,
  ...extra,
});

describe('section cap overlay of a cut with no polygons (#8664)', () => {
  it('has content when an open surface left only lines, and hands them to the renderer', () => {
    const cut = { cutPolygons: [], lines: [line({ openSurfaceCut: true })] };
    assert.equal(capOverlayHasContent(cut), true);
    assert.equal(capOverlayInput(cut, false).lines.length, 1);
  });

  it('has nothing to show for projection lines alone, as before', () => {
    assert.equal(capOverlayHasContent({ cutPolygons: [], lines: [line({ category: 'projection' })] }), false);
  });
});

it('uses the drawing fallback and disables the independent cap hatch when the material inherits', () => {
  const polygon = { polygon: { outer: [], holes: [] }, isCut: true, entityId: 7, modelIndex: 0, ifcType: 'IfcSlab' };
  const { polygons } = capOverlayInput({ cutPolygons: [polygon], lines: [] }, false, 'element', {
    scale: 50,
    fallbackStyle: () => ({ fillColor: '#808080', fillOpacity: 0.5 }),
    resolve: () => undefined,
  });
  assert.deepEqual(polygons[0].color, [128 / 255, 128 / 255, 128 / 255, 1]);
  assert.equal(polygons[0].hatch?.patternId, 0);
});

it('keeps cap fills and drops the raw and backing contours at a shared material joint', () => {
  const wall = (entityId: number, points: [number, number][]): DrawingPolygon => ({
    entityId, materialId: 2, ifcType: 'IfcWall', modelIndex: 0, isCut: true,
    polygon: { outer: points.map(([x, y]) => ({ x, y })), holes: [] },
  });
  const first = wall(10, [[0, 0], [2, 0], [0, 2]]);
  const second = wall(11, [[0, 2], [2, 0], [2, 2]]);
  const third = { ...second, modelIndex: 1 };
  const open = line({ entityId: first.entityId, openSurfaceCut: true });
  const unrelated = line({ entityId: third.entityId, modelIndex: third.modelIndex });
  const output = capOverlayInput({
    cutPolygons: [first, second, third], layerBaseCutPolygons: [first],
    lines: [line({ entityId: first.entityId }), open, unrelated],
  }, false, 'element', {
    scale: 50,
    joinCutPolygons: polygons => suppressCutJoints(polygons, p => `${p.modelIndex}:${p.materialId}`),
  });
  assert.deepEqual(output.polygons.map(p => p.polygon), [first.polygon, first.polygon, second.polygon, third.polygon]);
  assert.deepEqual(output.polygons.map(p => p.cutOutline?.length), [0, 2, 2, undefined]);
  assert.equal(output.lines.length, 2, 'preserves open surfaces and other models’ cut lines');
});

it('gives a hatch without a solid background an opaque material fill', () => {
  const polygon = { polygon: { outer: [], holes: [] }, isCut: true, entityId: 7, modelIndex: 0, ifcType: 'IfcSlab' };
  const { polygons } = capOverlayInput({ cutPolygons: [polygon], lines: [] }, false, 'element', {
    scale: 50,
    fallbackStyle: () => ({ fillColor: '#808080', fillOpacity: 0 }),
    resolve: () => [{ pattern: 'diagonal', color: '#000000', spacing: 0.1 }],
  });
  assert.deepEqual(polygons[0].color, [128 / 255, 128 / 255, 128 / 255, 1]);
  assert.equal(polygons[0].hatch?.patternId, 1);
});

it('only lifts cut lines to the cap, even when the drawing includes hidden lines', () => {
  const cut = { cutPolygons: [], lines: [
    line({ entityId: 1, openSurfaceCut: true }),
    line({ entityId: 2, category: 'projection', depth: 2 }),
    line({ entityId: 3, category: 'crease', depth: 1 }),
    line({ entityId: 4, category: 'hidden', visibility: 'hidden', depth: 3 }),
  ] };
  for (const showHiddenLines of [false, true]) {
    assert.deepEqual(capOverlayInput(cut, showHiddenLines).lines, [{ line: cut.lines[0].line, category: 'cut' }]);
  }
});
