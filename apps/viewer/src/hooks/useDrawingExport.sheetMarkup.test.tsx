/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  GraphicOverrideEngine, PAPER_SIZE_REGISTRY, FRAME_PRESETS,
  TITLE_BLOCK_PRESETS, DEFAULT_TITLE_BLOCK_FIELDS, DEFAULT_SCALE_BAR,
  DEFAULT_NORTH_ARROW, calculateViewportBounds,
  type Drawing2D, type DrawingSheet,
} from '@ifc-lite/drawing-2d';
import type { PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';
import useDrawingExport from './useDrawingExport.js';

const DRAWING: Drawing2D = {
  config: { plane: { axis: 'y', position: 0, flipped: false }, projectionDepth: 10, includeHiddenLines: true, creaseAngle: 30, scale: 50 },
  lines: [{ line: { start: { x: 0, y: 0 }, end: { x: 4, y: 0 } }, category: 'projection', visibility: 'visible', entityId: 1, ifcType: 'IfcWall', modelIndex: 0, depth: 0 }],
  cutPolygons: [], projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 4, y: 2 } },
  stats: { cutLineCount: 0, projectionLineCount: 1, hiddenLineCount: 0, silhouetteLineCount: 0, polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};

const AREAS: PolygonArea2DResult[] = [{
  id: 'area', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }],
  area: 8, perimeter: 12, appearance: { color: '#0088cc', textHeight: 2.5 },
}];
const NOTES: TextAnnotation2D[] = [{
  id: 'note', position: { x: 1, y: 1 }, text: 'Note & <review>',
  fontSize: 14, color: '#111111', backgroundColor: '#fff4d0', borderColor: '#333333',
  appearance: { font: 'serif', textHeight: 2.5, bold: true, italic: true, align: 'right' },
}];
const CLOUDS: CloudAnnotation2D[] = [{
  id: 'cloud', points: [{ x: 1, y: 0.5 }, { x: 2, y: 1.5 }],
  color: '#E53935', label: 'REV & B',
}];

function makeSheet(): DrawingSheet {
  const paper = PAPER_SIZE_REGISTRY.A3_LANDSCAPE;
  const frame = { style: 'professional' as const, ...FRAME_PRESETS.professional };
  const titleBlock = { ...TITLE_BLOCK_PRESETS.standard, fields: DEFAULT_TITLE_BLOCK_FIELDS.map(field => ({ ...field })), logo: null };
  return {
    id: 'sheet', name: 'Sheet markup', paper, frame, titleBlock,
    scale: { name: '1:50', factor: 50, useCase: 'test' },
    scaleBar: { ...DEFAULT_SCALE_BAR, visible: false },
    northArrow: { ...DEFAULT_NORTH_ARROW, style: 'none' },
    viewportBounds: calculateViewportBounds(paper, frame, titleBlock), revisions: [],
  };
}

function Probe({ sheetEnabled, onReady }: { sheetEnabled: boolean; onReady: (fn: () => string | null) => void }) {
  const { buildSVG } = useDrawingExport({
    drawing: DRAWING,
    displayOptions: { showHiddenLines: true, scale: 50, showScanSection: false, scanSectionOpacity: 0, scanSectionIncludeInExport: false },
    sectionPlane: { axis: 'down', position: 0, flipped: false },
    activePresetId: null, entityColorMap: new Map(), overridesEnabled: false,
    overrideEngine: new GraphicOverrideEngine(),
    measure2DResults: [], polygonArea2DResults: AREAS,
    textAnnotations2D: NOTES, cloudAnnotations2D: CLOUDS,
    sheetEnabled, activeSheet: sheetEnabled ? makeSheet() : null,
    dxfUnderlays: [], ifcDataStore: null, coordinateInfo: undefined,
    scanSection: { points: [] },
  });
  onReady(buildSVG);
  return null;
}

function exportSvg(sheetEnabled: boolean): Document {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  let build: (() => string | null) | undefined;
  try {
    act(() => root.render(<Probe sheetEnabled={sheetEnabled} onReady={fn => { build = fn; }} />));
    assert.ok(build);
    const svg = build();
    assert.ok(svg);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(xml.querySelector('parsererror'), null, 'exported SVG must be valid XML');
    return xml;
  } finally {
    act(() => root.unmount());
    element.remove();
  }
}

describe('drawing export keeps markup in both direct and sheet SVG', () => {
  for (const sheetEnabled of [false, true]) {
    it(`${sheetEnabled ? 'sheet' : 'direct'} SVG includes scaled areas, styled notes and clouds`, () => {
      const svg = exportSvg(sheetEnabled);
      const root = sheetEnabled ? '#drawing-content ' : '';
      const area = svg.querySelector(`${root}#polygon-area-measurements polygon`);
      const note = svg.querySelector(`${root}#text-annotations text`);
      const cloud = svg.querySelector(`${root}#cloud-annotations path`);
      assert.ok(area, 'area polygon is exported');
      assert.ok(note, 'text note is exported');
      assert.ok(cloud, 'revision cloud is exported');
      assert.match(cloud.getAttribute('d') ?? '', / A /);
      assert.equal(note.textContent, 'Note & <review>');
      assert.equal(note.getAttribute('font-family'), 'serif');
      assert.equal(note.getAttribute('font-weight'), 'bold');
      assert.equal(note.getAttribute('font-style'), 'italic');
      assert.equal(note.getAttribute('text-anchor'), 'end');
      assert.equal(svg.querySelector(`${root}#cloud-annotations text`)?.textContent, 'REV & B');
      if (sheetEnabled) {
        assert.ok(svg.querySelector('#drawing-content[clip-path="url(#viewport-clip)"]'), 'markup is clipped to sheet viewport');
        const line = svg.querySelector('#drawing-content #drawing-lines line');
        assert.ok(line);
        const [x, y] = (area.getAttribute('points') ?? '').split(' ')[0].split(',').map(Number);
        assert.ok(Math.abs(x - Number(line.getAttribute('x1'))) < 1e-4, 'area and drawing share the same X transform');
        assert.ok(Math.abs(y - Number(line.getAttribute('y1'))) < 1e-4, 'area and drawing share the same Y transform');
        assert.equal(note.getAttribute('font-size'), '2.5000', 'note height is in paper mm, independent of screen zoom');
      }
    });
  }
});
