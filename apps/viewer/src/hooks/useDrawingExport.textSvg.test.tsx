/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import type { TextAnnotation2D } from '@/store/slices/drawing2DSlice';
import useDrawingExport from './useDrawingExport.js';

const DRAWING: Drawing2D = {
  config: { plane: { axis: 'y', position: 0, flipped: false }, projectionDepth: 10, includeHiddenLines: true, creaseAngle: 30, scale: 50 },
  lines: [], cutPolygons: [], projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
  stats: { cutLineCount: 0, projectionLineCount: 0, hiddenLineCount: 0, silhouetteLineCount: 0, polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};

function ExportProbe({ notes, onReady }: { notes: TextAnnotation2D[]; onReady: (build: () => string | null) => void }) {
  const { buildSVG } = useDrawingExport({
    drawing: DRAWING,
    displayOptions: { showHiddenLines: true, scale: 50, showScanSection: false, scanSectionOpacity: 0, scanSectionIncludeInExport: false },
    sectionPlane: { axis: 'down', position: 0, flipped: false },
    activePresetId: null, entityColorMap: new Map(), overridesEnabled: false, overrideEngine: new GraphicOverrideEngine(),
    measure2DResults: [], polygonArea2DResults: [], textAnnotations2D: notes, cloudAnnotations2D: [],
    sheetEnabled: false, activeSheet: null, dxfUnderlays: [], ifcDataStore: null, coordinateInfo: undefined,
    scanSection: { points: [] },
  });
  onReady(buildSVG);
  return null;
}

function svgWithNotes(notes: TextAnnotation2D[]): Document {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root: Root = createRoot(element);
  let build: (() => string | null) | undefined;
  try {
    act(() => root.render(<ExportProbe notes={notes} onReady={callback => { build = callback; }} />));
    assert.ok(build);
    const xml = build();
    assert.ok(xml);
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    assert.equal(doc.querySelector('parsererror'), null, 'exported SVG must be well-formed');
    return doc;
  } finally {
    act(() => root.unmount());
    element.remove();
  }
}

const NOTE: TextAnnotation2D = {
  id: 'text-1', position: { x: 1, y: 2 }, text: 'Room & <A>\nSecond line', fontSize: 14,
  color: '#111111', backgroundColor: '#eeeeee', borderColor: '#444444',
  appearance: { textHeight: 2.5, font: 'serif', bold: true, italic: true, align: 'right' },
};

describe('drawing direct SVG text annotation formatting', () => {
  it('exports bold, italic, right-aligned multiline text without breaking XML', () => {
    const doc = svgWithNotes([NOTE]);
    const box = doc.querySelector('#text-annotations rect');
    const lines = [...doc.querySelectorAll('#text-annotations text')];
    assert.ok(box);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].textContent, 'Room & <A>');
    assert.equal(lines[1].textContent, 'Second line');
    for (const line of lines) {
      assert.equal(line.getAttribute('font-family'), 'serif');
      assert.equal(line.getAttribute('font-weight'), 'bold');
      assert.equal(line.getAttribute('font-style'), 'italic');
      assert.equal(line.getAttribute('text-anchor'), 'end');
      assert.ok(Math.abs(Number(line.getAttribute('x')) - (Number(box.getAttribute('x')) + Number(box.getAttribute('width')) - 0.05)) < 0.0001);
    }
  });

  it('respects local formatting overrides and escapes text attribute values', () => {
    const doc = svgWithNotes([{
      ...NOTE, text: 'Default', align: 'center', bold: false, italic: false,
      borderColor: '#444444" onload="invalid',
    }]);
    const text = doc.querySelector('#text-annotations text');
    const box = doc.querySelector('#text-annotations rect');
    assert.ok(text);
    assert.ok(box);
    assert.equal(text.getAttribute('text-anchor'), 'middle');
    assert.equal(text.hasAttribute('font-weight'), false);
    assert.equal(text.hasAttribute('font-style'), false);
    assert.equal(box.getAttribute('onload'), null);
    assert.equal(box.getAttribute('stroke'), '#444444" onload="invalid');
    assert.ok(Math.abs(Number(text.getAttribute('x')) - (Number(box.getAttribute('x')) + Number(box.getAttribute('width')) / 2)) < 0.0001);
  });
});
