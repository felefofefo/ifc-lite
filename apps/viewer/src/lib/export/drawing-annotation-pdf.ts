/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Vector annotations and page extents for the non-sheet drawing PDF. */
import type { jsPDF } from 'jspdf';
import type { Drawing2D, Point2D } from '@ifc-lite/drawing-2d';
import type { PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';
import { computePolygonCentroid, formatArea } from '@/components/viewer/tools/computePolygonArea';
import { generateCloudArcs } from '@/components/viewer/tools/cloudPathGenerator';
import { lineweightsAtScale, type LineweightTable } from '@/lib/drawing/lineweight-table';
import { pdfColor } from './pdf-color';
import { textAnnotationLayout } from '@/lib/drawing/annotation-types';
import { isPagePoint } from './section-pdf-cut-polygons';

type MapPoint = (x: number, y: number) => Point2D;

/** Include markup outside the model extent so the automatic PDF paper fits it. */
export function expandDrawingAnnotationBounds(
  bounds: Drawing2D['bounds'],
  areas: readonly PolygonArea2DResult[],
  texts: readonly TextAnnotation2D[],
  clouds: readonly CloudAnnotation2D[],
  scale: number,
): Drawing2D['bounds'] {
  const result = { min: { ...bounds.min }, max: { ...bounds.max } };
  if (!Number.isFinite(scale) || scale <= 0) return result;
  const world = (mm: number) => mm * scale / 1000;
  const include = ({ x, y }: Point2D) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    result.min.x = Math.min(result.min.x, x);
    result.min.y = Math.min(result.min.y, y);
    result.max.x = Math.max(result.max.x, x);
    result.max.y = Math.max(result.max.y, y);
  };
  for (const area of areas) {
    if (area.points.length < 3) continue;
    area.points.forEach(include);
    const center = computePolygonCentroid(area.points);
    const label = formatArea(area.area);
    const height = world(area.appearance?.textHeight ?? 3);
    include({ x: center.x - label.length * height * 0.3, y: center.y - height });
    include({ x: center.x + label.length * height * 0.3, y: center.y + height });
  }
  for (const note of texts) {
    if (!note.text.trim()) continue;
    const height = world(note.appearance?.textHeight ?? 2.5);
    const fixed = note.widthMm === undefined ? undefined : textAnnotationLayout(note, world(1));
    const lines = fixed?.lines ?? note.text.split('\n');
    const width = fixed?.bgW ?? Math.max(...lines.map(line => line.length * height * 0.6)) + 2 * world(1);
    const boxHeight = fixed?.bgH ?? lines.length * height * 1.3 + 2 * world(1);
    include(note.position);
    include({ x: note.position.x + width, y: note.position.y + boxHeight });
  }
  for (const cloud of clouds) {
    if (cloud.points.length < 2) continue;
    const [a, b] = cloud.points;
    const arc = Math.min(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 0.15;
    include({ x: Math.min(a.x, b.x) - arc, y: Math.min(a.y, b.y) - arc });
    include({ x: Math.max(a.x, b.x) + arc, y: Math.max(a.y, b.y) + arc });
    if (cloud.label.trim()) {
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      include({ x: midX - world(cloud.label.length * 1.5), y: midY - world(3) });
      include({ x: midX + world(cloud.label.length * 1.5), y: midY + world(3) });
    }
  }
  return result;
}

function traceClosed(doc: jsPDF, ring: readonly Point2D[]): void {
  doc.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) doc.lineTo(ring[i].x, ring[i].y);
  doc.close();
}

/** Draw with a fresh state so opacity, fonts and dashed lines cannot affect dimensions. */
export function drawDrawingAnnotationsPdf(
  doc: jsPDF,
  areas: readonly PolygonArea2DResult[],
  texts: readonly TextAnnotation2D[],
  clouds: readonly CloudAnnotation2D[],
  mapPoint: MapPoint,
  scale: number,
  lineweightTable?: LineweightTable,
): void {
  // An empty markup set must leave the existing PDF writer completely untouched.
  if (!areas.length && !texts.length && !clouds.length) return;
  const point = (p: Point2D) => mapPoint(p.x, p.y);
  const valid = (p: Point2D) => isPagePoint(p);
  const fontSize = (mm: number) => doc.setFontSize(mm * 72 / 25.4);
  const color = (input: string, fallback: string) => pdfColor(input) ?? { color: fallback, alpha: 1 };
  const fillWithAlpha = (ring: Point2D[], fillColor: string, opacity: number) => {
    if (!(opacity > 0)) return;
    doc.saveGraphicsState();
    try {
      doc.setFillColor(fillColor);
      doc.setGState(doc.GState({ opacity: Math.min(1, opacity) }));
      traceClosed(doc, ring);
      doc.fill();
    } finally { doc.restoreGraphicsState(); }
  };
  const drawLabel = (text: string, x: number, y: number, mm: number, ink: string,
    align: 'left' | 'center' | 'right' = 'center', baseline: 'alphabetic' | 'middle' = 'middle') => {
    if (!text.trim() || !Number.isFinite(mm) || !(mm > 0) || !valid({ x, y })) return;
    doc.setTextColor(color(ink, '#000000').color);
    fontSize(mm);
    doc.text(text, x, y, { align, baseline });
  };
  doc.saveGraphicsState();
  try {
    doc.setLineCap('round');
    doc.setLineJoin('round');
    doc.setFont('helvetica', 'normal');
    for (const area of areas) {
      if (area.points.length < 3) continue;
      const ring = area.points.map(point);
      if (!ring.every(valid)) continue;
      const ink = color(area.appearance?.color ?? '#2196F3', '#2196F3');
      fillWithAlpha(ring, ink.color, 0.1 * ink.alpha);
      doc.setDrawColor(ink.color);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([1, 0.5], 0);
      traceClosed(doc, ring);
      doc.stroke();
      doc.setLineDashPattern([], 0);
      const center = point(computePolygonCentroid(area.points));
      drawLabel(formatArea(area.area), center.x, center.y, area.appearance?.textHeight ?? 3, '#000000');
    }
    for (const note of texts) {
      if (!note.text.trim()) continue;
      const p = point(note.position);
      if (!valid(p)) continue;
      const height = note.appearance?.textHeight ?? 2.5;
      const padding = 1;
      const fixed = note.widthMm === undefined ? undefined : textAnnotationLayout(note, 1);
      const lines = fixed?.lines ?? note.text.split('\n');
      const lineHeight = height * 1.3;
      const width = fixed?.bgW ?? Math.max(...lines.map(line => line.length * height * 0.6)) + padding * 2;
      const boxHeight = fixed?.bgH ?? lines.length * lineHeight + padding * 2;
      if (!(height > 0) || !valid({ x: p.x + width, y: p.y + boxHeight })) continue;
      const background = color(note.backgroundColor, '#ffffff');
      if (background.alpha > 0) fillWithAlpha([
        p, { x: p.x + width, y: p.y },
        { x: p.x + width, y: p.y + boxHeight }, { x: p.x, y: p.y + boxHeight },
      ], background.color, background.alpha);
      const border = color(note.borderColor, '#333333');
      if (border.alpha > 0) {
        doc.setDrawColor(border.color);
        doc.setLineWidth(0.15);
        doc.setLineDashPattern([], 0);
        doc.rect(p.x, p.y, width, boxHeight, 'S');
      }
      const bold = note.bold ?? note.appearance?.bold ?? false;
      const italic = note.italic ?? note.appearance?.italic ?? false;
      const family = note.appearance?.font === 'serif' ? 'times'
        : note.appearance?.font === 'monospace' ? 'courier' : 'helvetica';
      doc.setFont(family, bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal');
      const align = note.align ?? note.appearance?.align ?? 'left';
      const textX = align === 'center' ? p.x + width / 2 : align === 'right' ? p.x + width - padding : p.x + padding;
      for (let i = 0; i < lines.length; i++) {
        drawLabel(lines[i], textX, p.y + padding + height * 0.8 + i * lineHeight,
          height, note.appearance?.color ?? note.color, align, 'alphabetic');
      }
      doc.setFont('helvetica', 'normal');
    }
    const weights = lineweightsAtScale(lineweightTable ?? {}, scale);
    for (const cloud of clouds) {
      if (cloud.points.length < 2) continue;
      const [a, b] = cloud.points;
      const width = Math.abs(b.x - a.x), height = Math.abs(b.y - a.y);
      if (width < 0.001 || height < 0.001) continue;
      const arcs = generateCloudArcs(a, b, Math.min(width, height) * 0.15);
      // Cap tessellation for extremely long, narrow rectangles.
      if (!arcs.length || arcs.length > 10_000) continue;
      const ring = arcs.flatMap(arc => {
        const sweep = (arc.endAngle - arc.startAngle + 2 * Math.PI) % (2 * Math.PI);
        return Array.from({ length: 8 }, (_, i) => {
          const angle = arc.startAngle + sweep * i / 8;
          return point({ x: arc.center.x + arc.radius * Math.cos(angle),
            y: arc.center.y + arc.radius * Math.sin(angle) });
        });
      });
      if (ring.length < 3 || !ring.every(valid)) continue;
      const ink = color(cloud.appearance?.color ?? cloud.color, '#E53935');
      fillWithAlpha(ring, ink.color, 0.05 * ink.alpha);
      doc.setDrawColor(ink.color);
      doc.setLineWidth(cloud.appearance?.weight ? weights[cloud.appearance.weight] : 0.4);
      doc.setLineDashPattern([], 0);
      traceClosed(doc, ring);
      doc.stroke();
      if (cloud.label.trim()) {
        const center = point({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        if (!valid(center)) continue;
        doc.setFont('helvetica', 'bold');
        fontSize(3);
        const labelWidth = doc.getTextWidth(cloud.label) + 2;
        fillWithAlpha([
          { x: center.x - labelWidth / 2, y: center.y - 2 },
          { x: center.x + labelWidth / 2, y: center.y - 2 },
          { x: center.x + labelWidth / 2, y: center.y + 2 },
          { x: center.x - labelWidth / 2, y: center.y + 2 },
        ], '#ffffff', 0.85);
        doc.setDrawColor(ink.color);
        doc.setLineWidth(0.15);
        doc.rect(center.x - labelWidth / 2, center.y - 2, labelWidth, 4, 'S');
        drawLabel(cloud.label, center.x, center.y, 3, ink.color);
        doc.setFont('helvetica', 'normal');
      }
    }
  } finally { doc.restoreGraphicsState(); }
}
