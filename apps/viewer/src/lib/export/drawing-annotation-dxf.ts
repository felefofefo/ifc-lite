/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Export drawing markups as native DXF TEXT and closed polylines, in model metres. */
import type { DXFExportOptions, DXFPolylineLayer, Point2D } from '@ifc-lite/drawing-2d';
import type { PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';
import { computePolygonCentroid, formatArea } from '@/components/viewer/tools/computePolygonArea';
import { generateCloudArcs } from '@/components/viewer/tools/cloudPathGenerator';
import { lineweightsAtScale, type LineweightTable } from '@/lib/drawing/lineweight-table';
import { textAnnotationLayout } from '@/lib/drawing/annotation-types';

type DxfLabel = NonNullable<DXFExportOptions['labels']>[number];

export function drawingAnnotationDxf(
  areas: readonly PolygonArea2DResult[],
  texts: readonly TextAnnotation2D[],
  clouds: readonly CloudAnnotation2D[],
  scale: number,
  lineweightTable?: LineweightTable,
): { polylineLayers: DXFPolylineLayer[]; labels: DxfLabel[] } {
  const polylineLayers: DXFPolylineLayer[] = [];
  const labels: DxfLabel[] = [];
  if (!Number.isFinite(scale) || scale <= 0) return { polylineLayers, labels };
  // Convert paper millimetres to drawing metres; the DXF writer applies
  // coordinateTransform to ALL these points exactly once, like model edges.
  const mm = (value: number) => value * scale / 1000;

  for (const area of areas) {
    if (area.points.length < 3) continue;
    const color = area.appearance?.color ?? '#2196F3';
    polylineLayers.push({
      name: 'ROVE-AREAS', color, closed: true, lineWeight: 0.3,
      dash: [mm(1), mm(0.5)], polylines: [area.points],
    });
    labels.push({
      layer: 'ROVE-AREAS', color: '#000000', text: formatArea(area.area),
      position: computePolygonCentroid(area.points), height: mm(area.appearance?.textHeight ?? 3),
      hAlign: 'center', vAlign: 'middle',
    });
  }

  for (const note of texts) {
    if (!note.text.trim()) continue;
    const height = mm(note.appearance?.textHeight ?? 2.5);
    const padding = mm(1);
    const fixed = note.widthMm === undefined ? undefined : textAnnotationLayout(note, mm(1));
    const lines = fixed?.lines ?? note.text.split('\n');
    const lineHeight = height * 1.3;
    const width = fixed?.bgW ?? Math.max(...lines.map(line => line.length * height * 0.6)) + padding * 2;
    const boxHeight = fixed?.bgH ?? lines.length * lineHeight + padding * 2;
    const { x, y } = note.position;
    polylineLayers.push({
      name: 'ROVE-TEXT-BOX', color: note.borderColor, closed: true,
      lineWeight: 0.15, polylines: [[
        { x, y }, { x: x + width, y },
        { x: x + width, y: y + boxHeight }, { x, y: y + boxHeight },
      ]],
    });
    const align = note.align ?? note.appearance?.align ?? 'left';
    const textX = align === 'center' ? x + width / 2 : align === 'right' ? x + width - padding : x + padding;
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      labels.push({
        layer: 'ROVE-TEXT', color: note.appearance?.color ?? note.color, text: line,
        position: { x: textX, y: y + padding + height * 0.8 + index * lineHeight },
        height, hAlign: align, vAlign: 'baseline',
      });
    });
  }

  const weights = lineweightsAtScale(lineweightTable ?? {}, scale);
  for (const cloud of clouds) {
    if (cloud.points.length < 2) continue;
    const [a, b] = cloud.points;
    const width = Math.abs(b.x - a.x), height = Math.abs(b.y - a.y);
    if (width < 0.001 || height < 0.001) continue;
    const arcs = generateCloudArcs(a, b, Math.min(width, height) * 0.15);
    if (!arcs.length) continue;
    // Eight straight segments per semicircle, matching the existing SVG arc
    // generator's clockwise sweep (screen-space Y increases downward).
    const points: Point2D[] = arcs.flatMap(arc => {
      const sweep = (arc.endAngle - arc.startAngle + 2 * Math.PI) % (2 * Math.PI);
      return Array.from({ length: 8 }, (_, i) => {
        const angle = arc.startAngle + sweep * i / 8;
        return { x: arc.center.x + arc.radius * Math.cos(angle), y: arc.center.y + arc.radius * Math.sin(angle) };
      });
    });
    const color = cloud.appearance?.color ?? cloud.color;
    polylineLayers.push({
      name: 'ROVE-REVISION-CLOUDS', color, closed: true,
      lineWeight: cloud.appearance?.weight ? weights[cloud.appearance.weight] : 0.4,
      polylines: [points],
    });
    if (cloud.label.trim()) labels.push({
      layer: 'ROVE-REVISION-CLOUDS', color, text: cloud.label,
      position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      height: mm(3), hAlign: 'center', vAlign: 'middle',
    });
  }

  return { polylineLayers, labels };
}
