/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';
import useDrawingExport from './useDrawingExport.js';
import { expandDrawingAnnotationBounds } from '@/lib/export/drawing-annotation-pdf';
import type { TextAnnotation2D } from '@/store/slices/drawing2DSlice';

const drawing: Drawing2D = {
  config: { plane: { axis: 'y', position: 0, flipped: false }, projectionDepth: 10, includeHiddenLines: true, creaseAngle: 30, scale: 50 },
  lines: [{ line: { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } },
    category: 'projection', visibility: 'visible', entityId: 1, ifcType: 'IfcWall', modelIndex: 0, depth: 0 }],
  cutPolygons: [], projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 4, y: 2 } },
  stats: { cutLineCount: 0, projectionLineCount: 1, hiddenLineCount: 0, silhouetteLineCount: 0,
    polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};
const note: TextAnnotation2D = { id: 'note', position: { x: 1, y: 1 }, text: 'PDF NOTE',
  fontSize: 14, color: '#111111', backgroundColor: 'rgba(255,255,255,0.9)', borderColor: '#333333',
  appearance: { font: 'serif', textHeight: 2.5, bold: true, italic: true, align: 'right' } };

function Probe({ onReady }: { onReady: (fn: (scale?: number, dest?: (blob: Blob) => void) => Promise<void>) => void }) {
  const { handleExportPDF } = useDrawingExport({
    drawing,
    displayOptions: { showHiddenLines: true, scale: 50, showScanSection: false, scanSectionOpacity: 0, scanSectionIncludeInExport: false },
    sectionPlane: { axis: 'down', position: 0, flipped: false },
    activePresetId: null, entityColorMap: new Map(), overridesEnabled: false,
    overrideEngine: new GraphicOverrideEngine([]),
    measure2DResults: [],
    polygonArea2DResults: [{ id: 'area', area: 8, perimeter: 12, points: [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 },
    ] }],
    textAnnotations2D: [note],
    cloudAnnotations2D: [{ id: 'cloud', points: [{ x: 2, y: 0.5 }, { x: 3, y: 1.5 }],
      color: '#e53935', label: 'REV-A' }],
    sheetEnabled: false, activeSheet: null, dxfUnderlays: [], ifcDataStore: null,
    coordinateInfo: undefined, scanSection: { points: [] },
  });
  onReady(handleExportPDF);
  return null;
}

describe('non-sheet PDF exports annotations as vectors', () => {
  it('expands auto-fit page bounds for notes outside the model geometry', () => {
    const expanded = expandDrawingAnnotationBounds(drawing.bounds, [],
      [{ ...note, position: { x: 20, y: 30 } }], [], 50);
    assert.equal(expanded.min.x, 0);
    assert.equal(expanded.min.y, 0);
    assert.ok(expanded.max.x > 20);
    assert.ok(expanded.max.y > 30);
  });

  it('writes native area, styled text and revision-cloud vectors into the actual PDF', async () => {
    useViewerStore.setState({ models: new Map() });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let exportPdf: ((scale?: number, dest?: (blob: Blob) => void) => Promise<void>) | undefined;
    try {
      await act(async () => root.render(<Probe onReady={fn => { exportPdf = fn; }} />));
      const readyExportPdf = exportPdf;
      assert.ok(readyExportPdf);
      let blob: Blob | undefined;
      await act(async () => { await readyExportPdf(50, value => { blob = value; }); });
      assert.ok(blob);
      const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
      assert.ok(pdf.includes('PDF NOTE'), 'styled text must be embedded as editable text');
      assert.ok(pdf.includes('REV-A'), 'revision label must be embedded as editable text');
      assert.ok(pdf.includes('8.00'), 'polygon area label must be present');
      assert.ok(/\bh\nS\n/.test(pdf), 'area and cloud outlines must use vector strokes');
      assert.ok(!pdf.includes('/Subtype /Image'), 'drawing annotations must not be rasterized');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
