/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphicOverrideEngine, parseDxf, type Drawing2D } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';
import useDrawingExport from './useDrawingExport.js';

const drawing: Drawing2D = {
  config: { plane: { axis: 'y', position: 0, flipped: false }, projectionDepth: 10, includeHiddenLines: true, creaseAngle: 30, scale: 100 },
  lines: [], cutPolygons: [], projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 6, y: 4 } },
  stats: { cutLineCount: 0, projectionLineCount: 0, hiddenLineCount: 0, silhouetteLineCount: 0, polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};

function Probe({ onReady }: { onReady: (build: () => { dxf: string } | undefined) => void }) {
  const { buildDXF } = useDrawingExport({
    drawing,
    displayOptions: { showHiddenLines: true, scale: 50, showScanSection: false, scanSectionOpacity: 0, scanSectionIncludeInExport: false },
    sectionPlane: { axis: 'down', position: 0, flipped: false },
    activePresetId: null, entityColorMap: new Map(), overridesEnabled: false,
    overrideEngine: new GraphicOverrideEngine([]),
    measure2DResults: [],
    polygonArea2DResults: [{ id: 'area', area: 8, perimeter: 12, points: [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 },
    ] }],
    textAnnotations2D: [{ id: 'text', position: { x: 1, y: 1 }, text: 'DXF note',
      fontSize: 14, color: '#000000', backgroundColor: '#ffffff', borderColor: '#222222' }],
    cloudAnnotations2D: [{ id: 'cloud', points: [{ x: 2, y: 1 }, { x: 3, y: 2 }],
      color: '#ff0000', label: 'REV' }],
    sheetEnabled: false, activeSheet: null, dxfUnderlays: [], ifcDataStore: null,
    coordinateInfo: undefined, scanSection: { points: [] },
  });
  onReady(buildDXF);
  return null;
}

describe('useDrawingExport DXF markups', () => {
  it('includes areas, texts and revision clouds through the actual drawing export hook', () => {
    useViewerStore.setState({ models: new Map() });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let build: (() => { dxf: string } | undefined) | undefined;
    try {
      act(() => root.render(<Probe onReady={fn => { build = fn; }} />));
      assert.ok(build);
      const exported = build();
      assert.ok(exported);
      const entities = parseDxf(exported.dxf).entities;
      assert.ok(entities.some(e => e.kind === 'polyline' && e.layer === 'ROVE-AREAS'));
      assert.ok(entities.some(e => e.kind === 'text' && e.layer === 'ROVE-TEXT' && e.text === 'DXF note'));
      assert.ok(entities.some(e => e.kind === 'polyline' && e.layer === 'ROVE-REVISION-CLOUDS'));
      assert.ok(entities.some(e => e.kind === 'text' && e.layer === 'ROVE-REVISION-CLOUDS' && e.text === 'REV'));
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
