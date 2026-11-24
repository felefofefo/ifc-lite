/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportToDXF, parseDxf, type Drawing2D } from '@ifc-lite/drawing-2d';
import type { PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';
import { drawingAnnotationDxf } from './drawing-annotation-dxf.js';

const drawing: Drawing2D = {
  config: { plane: { axis: 'y', position: 0, flipped: false }, projectionDepth: 10, includeHiddenLines: false, creaseAngle: 30, scale: 50 },
  lines: [], cutPolygons: [], projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 6, y: 4 } },
  stats: { cutLineCount: 0, projectionLineCount: 0, hiddenLineCount: 0, silhouetteLineCount: 0, polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};
const area: PolygonArea2DResult = {
  id: 'area', area: 8, perimeter: 12,
  points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }],
  appearance: { textHeight: 2.5, color: '#0088cc' },
};
const note: TextAnnotation2D = {
  id: 'note', position: { x: 1, y: 2 }, text: 'Line one\nLine two', fontSize: 14,
  color: '#111111', backgroundColor: '#ffffff', borderColor: '#333333',
  appearance: { textHeight: 3, align: 'right', color: '#554433' },
};
const cloud: CloudAnnotation2D = {
  id: 'cloud', points: [{ x: 1, y: 0.5 }, { x: 3, y: 1.5 }],
  color: '#e53935', label: 'REV A',
};

describe('drawing annotation DXF', () => {
  it('exports closed area boundaries, scale-correct labels, and styled multiline text', () => {
    const markup = drawingAnnotationDxf([area], [note], [], 50);
    const dxf = exportToDXF(drawing, { version: 'R2007', ...markup });
    const entities = parseDxf(dxf).entities;
    const boundary = entities.find(e => e.kind === 'polyline' && e.layer === 'ROVE-AREAS');
    assert.ok(boundary && boundary.kind === 'polyline');
    assert.equal(boundary.closed, true);
    assert.equal(boundary.vertices.length, 4);
    assert.ok(entities.some(e => e.kind === 'polyline' && e.layer === 'ROVE-TEXT-BOX'));
    const labels = entities.filter(e => e.kind === 'text');
    assert.ok(labels.some(e => e.kind === 'text' && e.text.includes('8') && e.layer === 'ROVE-AREAS'));
    const lines = labels.filter(e => e.kind === 'text' && e.layer === 'ROVE-TEXT');
    assert.equal(lines.length, 2);
    assert.ok(lines.every(e => e.kind === 'text' && e.hAlign === 'right' && e.vAlign === 'baseline'));
    assert.ok(lines.every(e => e.kind === 'text' && Math.abs(e.height - 0.15) < 1e-6));
    assert.equal((lines[0] as Extract<typeof lines[number], {kind:'text'}>).text, 'Line one');
    assert.equal((lines[1] as Extract<typeof lines[number], {kind:'text'}>).text, 'Line two');
  });

  it('applies the CAD coordinate transform once to boundaries and text', () => {
    const markup = drawingAnnotationDxf([area], [note], [], 100);
    const dxf = exportToDXF(drawing, {
      version: 'R2007', ...markup,
      coordinateTransform: ({ x, y }) => ({ x: x + 1000, y: 2000 - y }),
    });
    const entities = parseDxf(dxf).entities;
    const boundary = entities.find(e => e.kind === 'polyline' && e.layer === 'ROVE-AREAS');
    assert.ok(boundary && boundary.kind === 'polyline');
    assert.ok(Math.abs(boundary.vertices[0].x - 1000) < 1e-6);
    assert.ok(Math.abs(boundary.vertices[0].y - 2000) < 1e-6);
    const areaLabel = entities.find(e => e.kind === 'text' && e.layer === 'ROVE-AREAS');
    assert.ok(areaLabel && areaLabel.kind === 'text');
    assert.ok(Math.abs(areaLabel.x - 1002) < 1e-6);
    assert.ok(Math.abs(areaLabel.y - 1999) < 1e-6);
    assert.ok(Math.abs(areaLabel.height - 0.25) < 1e-6);
  });

  it('tessellates revision cloud arcs as closed CAD polylines and labels them', () => {
    const markup = drawingAnnotationDxf([], [], [cloud], 50);
    const dxf = exportToDXF(drawing, { version: 'R2007', ...markup });
    const entities = parseDxf(dxf).entities;
    const outline = entities.find(e => e.kind === 'polyline' && e.layer === 'ROVE-REVISION-CLOUDS');
    assert.ok(outline && outline.kind === 'polyline');
    assert.equal(outline.closed, true);
    assert.ok(outline.vertices.length > 30, 'each scallop is sampled as a smooth polyline');
    assert.ok(outline.vertices.some(vertex => vertex.y < 0.5), 'top scallops bulge outwards');
    assert.ok(entities.some(e => e.kind === 'text' && e.layer === 'ROVE-REVISION-CLOUDS' && e.text === 'REV A'));
  });

  it('skips degenerate and empty markups without introducing CAD entities', () => {
    assert.deepEqual(drawingAnnotationDxf([], [], [], 100), { polylineLayers: [], labels: [] });
    assert.deepEqual(drawingAnnotationDxf([area], [note], [cloud], 0), { polylineLayers: [], labels: [] });
    const badCloud = { ...cloud, points: [{ x: 0, y: 0 }, { x: 0, y: 1 }] };
    const emptyText = { ...note, text: '  ' };
    assert.deepEqual(drawingAnnotationDxf([], [emptyText], [badCloud], 100), { polylineLayers: [], labels: [] });
  });
});
