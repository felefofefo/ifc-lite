/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { jsPDF } from 'jspdf';
import { GraphicOverrideEngine, type DrawingPolygon } from '@ifc-lite/drawing-2d';
import type { CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';
import { publicationCapPaint } from '@/lib/section/cap-overlay';
import { drawPublicationCanvasFills } from '@/components/viewer/drawing/publication-canvas-fills';
import { readMaterialHatches } from '@/lib/drawing/material-hatches';
import { publicationCutSvg } from './drawing-publication-svg';
import { drawCutPolygonsPdf, prepareCutPolygonsPdf } from './section-pdf-cut-polygons';

const square = (a: number, b: number) => [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
const polygon: DrawingPolygon = {
  entityId: 1, modelIndex: 0, ifcType: 'IfcWall', isCut: true,
  polygon: { outer: square(1, 4), holes: [square(2, 3)] },
};
const style: CutPolygonStyleContext = {
  useIfcMaterials: false, entityColorMap: new Map(), overridesEnabled: false,
  overrideEngine: new GraphicOverrideEngine(), getElementProperties: () => undefined,
  stroke: () => ({ color: '#123456', lineWeight: 0.35, dash: [2, 1] }),
  fills: () => [
    { pattern: 'solid', color: '#eeddcc', spacing: 0 },
    { pattern: 'diagonal', color: '#815132', spacing: 0.125, lineWeight: 0.13 },
  ],
};

test('exports both SVG fills before the cut outline with paper pen attributes', () => {
  const svg = publicationCutSvg([polygon], style, () => 'M1 1Z M2 2Z', (text) => text, 50, (mm) => mm);
  assert.match(svg, /patternUnits="userSpaceOnUse" width="2.5"/);
  assert.match(svg, /fill-rule="evenodd"[^\n]+fill="#eeddcc"/);
  assert.ok(svg.indexOf('fill="#eeddcc"') < svg.indexOf('fill="url(#ifc-cut-pattern-1)"'));
  assert.ok(svg.indexOf('fill="url(#ifc-cut-pattern-1)"') < svg.indexOf('id="polygon-outlines"'));
  assert.match(svg, /stroke="#123456" stroke-width="0.3500" stroke-dasharray="2.0000 1.0000"/);
});

test('writes the solid fill, hatch strokes and dashed outline as vector PDF content', () => {
  const doc = new jsPDF({ unit: 'mm' });
  const prepared = prepareCutPolygonsPdf([polygon], style, (x, y) => ({ x: x * 20, y: y * 20 }));
  drawCutPolygonsPdf(doc, prepared, 50);
  const pdf = doc.output();
  assert.match(pdf, /f\*/);
  assert.match(pdf, /0\.51 0\.32 0\.2 RG/);
  assert.match(pdf, /0\.07 0\.2 0\.34 RG/);
  assert.match(pdf, /\[[^\]]+\] 0\.? d/);
});

test('migrates material hatch assignments from the previous patch', () => {
  assert.deepEqual(readMaterialHatches('{"Tijolo":"diagonal"}'), { Tijolo: { foreground: { pattern: 'diagonal' } } });
});

test('migrates patterned backgrounds to solid without changing foreground or color', () => {
  const materials = readMaterialHatches('{"Wood":{"background":{"pattern":"cross-hatch","color":"#abcdef"},"foreground":{"pattern":"diagonal"}}}');
  assert.equal(materials.Wood?.background?.pattern, 'solid');
  assert.equal(materials.Wood?.background?.color, '#abcdef');
  assert.equal(materials.Wood?.foreground?.pattern, 'diagonal');
});

test('maps publication paints to both 2D clipping and 3D cap attributes', () => {
  const paints = style.fills?.(polygon, '#ffffff') ?? [];
  const cap = publicationCapPaint(paints);
  assert.deepEqual(cap.color, [238 / 255, 221 / 255, 204 / 255, 1]);
  assert.equal(cap.hatch?.patternId, 1);
  assert.equal(cap.hatch?.modelSpace, true);
  assert.equal(cap.hatch?.spacingPx, 0.125);
  assert.deepEqual(cap.hatch?.strokeColor, [129 / 255, 81 / 255, 50 / 255, 1]);
  assert.equal(publicationCapPaint(paints.slice(1)).color?.[3], 0);
  assert.equal(publicationCapPaint([]).hatch?.patternId, 0);

  const order: string[] = [];
  const context = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {},
    clip(rule: string) { order.push(rule); },
    fillRect() { order.push(this.fillStyle); },
    stroke() { order.push(this.strokeStyle); },
    fillStyle: '', strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;
  drawPublicationCanvasFills(context, polygon, paints, (x, y) => ({ x, y }), 1, 0.05);
  assert.deepEqual(order, ['evenodd', '#eeddcc', '#815132']);
});

test('publishes projected surface fills without tessellation outlines in SVG and PDF', () => {
  const surface = { ...polygon, isCut: false };
  const svg = publicationCutSvg([surface], style, () => 'M1 1Z M2 2Z', (text) => text, 50, (mm) => mm);
  assert.match(svg, /fill="url\(#ifc-cut-pattern-1\)"/);
  assert.doesNotMatch(svg, /stroke="#123456"/);
  const doc = new jsPDF({ unit: 'mm' });
  const prepared = prepareCutPolygonsPdf([surface], style, (x, y) => ({ x: x * 20, y: y * 20 }));
  drawCutPolygonsPdf(doc, prepared, 50);
  const pdf = doc.output();
  assert.match(pdf, /0\.51 0\.32 0\.2 RG/);
  assert.doesNotMatch(pdf, /0\.07 0\.2 0\.34 RG/);
});
