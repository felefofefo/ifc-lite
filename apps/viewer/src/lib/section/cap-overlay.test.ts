/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DrawingLine } from '@ifc-lite/drawing-2d';
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
  assert.deepEqual(polygons[0].color, [128 / 255, 128 / 255, 128 / 255, 0.5]);
  assert.equal(polygons[0].hatch?.patternId, 0);
});
