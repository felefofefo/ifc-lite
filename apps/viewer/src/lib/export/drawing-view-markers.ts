/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { selectActiveSavedView, drawingAnnotationVisible, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { AxisBounds } from '@/lib/section/section-distance';
import type { jsPDF } from 'jspdf';
import type { Drawing2D, DXFExportOptions, DXFPolylineLayer } from '@ifc-lite/drawing-2d';
import type { LineweightRow } from '../drawing/lineweight-table';
import { resolveMarkerHeads, type MarkerLineStyle } from '../drawing/drawing-tag-library';
import { viewMarkerGraphics, collectViewMarkers, DEFAULT_VIEW_MARKERS, markerHeadPoint, markerLineDash, markerLineWidth, markerTraceLines } from '../drawing/view-markers';

type Marker = ReturnType<typeof collectViewMarkers>[number] & {
  line?: MarkerLineStyle;
  heads?: ReturnType<typeof resolveMarkerHeads>;
  headsAtAngle?: (angle: number) => ReturnType<typeof resolveMarkerHeads>;
};
type Markers = readonly Marker[];
type Bounds = Drawing2D['bounds'];

const VIEW_MARKER_INK = '#000000';
const VIEW_MARKER_TEXT_MM = 2.5;

export function viewMarkersSvg(
  markers: Markers,
  map: (x: number, y: number) => { x: number; y: number },
  unit: number, outputUnit: number, escapeXml: (text: string) => string, weights?: LineweightRow,
): string {
  if (!markers.length) return '';
  const items = markers.map(marker => {
    const { polylines, label } = viewMarkerGraphics(marker, unit);
    const point = map(label.x, label.y);
    const end = map(marker.end.x, marker.end.y);
    const forward = map(marker.end.x + marker.direction.x, marker.end.y + marker.direction.y);
    const angle = Math.atan2(forward.y - end.y, forward.x - end.x) * 180 / Math.PI;
    const heads = marker.headsAtAngle?.(angle) ?? [];
    const trace = markerTraceLines(marker, unit, marker.line);
    const dash = markerLineDash(marker.line, marker.kind).map(value => value * outputUnit).join(' ');
    const lines = [...trace, ...(heads.length ? [] : polylines.slice(1))].map((line, i) => {
      const points = line.map(p => { const v = map(p.x, p.y); return `${v.x},${v.y}`; }).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${i < trace.length ? marker.line?.color ?? VIEW_MARKER_INK : VIEW_MARKER_INK}" stroke-width="${(i < trace.length ? markerLineWidth(marker.line, weights) : 0.25) * outputUnit}"${i < trace.length && dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    });
    if (heads.length) {
      const images = heads.map(({ slot, graphic }) => {
        const head = markerHeadPoint(marker, slot);
        const p = map(head.x, head.y);
        return `<image href="${escapeXml(graphic.href)}"
          transform="translate(${p.x} ${p.y}) rotate(${graphic.directional ? 0 : angle})"
          x="${-graphic.anchor.x * outputUnit}" y="${-graphic.anchor.y * outputUnit}"
          width="${graphic.width * outputUnit}" height="${graphic.height * outputUnit}"/>`;
      });
      return lines.join('') + images.join('');
    }
    return `${lines.join('')}<text x="${point.x}" y="${point.y}" font-family="Arial, sans-serif" font-size="${VIEW_MARKER_TEXT_MM * outputUnit}" text-anchor="middle" dominant-baseline="middle" fill="${VIEW_MARKER_INK}">${escapeXml(marker.code)}</text>`;
  });
  return `<g id="view-markers">${items.join('')}</g>\n`;
}

export function viewMarkerExportBounds(bounds: Bounds, markers: Markers, scale: number): Bounds {
  if (!markers.length) return bounds;
  const unit = scale / 1000;
  const min = { ...bounds.min }, max = { ...bounds.max };
  for (const marker of markers) {
    const { polylines, label } = viewMarkerGraphics(marker, unit);
    for (const p of [...polylines.flat(), label]) {
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y);
    }
    for (const { slot, graphic } of marker.heads ?? []) {
      const { width, height, anchor } = graphic;
      const head = markerHeadPoint(marker, slot);
      const radius = Math.hypot(Math.max(Math.abs(anchor.x), Math.abs(width - anchor.x)),
        Math.max(Math.abs(anchor.y), Math.abs(height - anchor.y))) * unit;
      min.x = Math.min(min.x, head.x - radius); min.y = Math.min(min.y, head.y - radius);
      max.x = Math.max(max.x, head.x + radius); max.y = Math.max(max.y, head.y + radius);
    }
    const halfLabel = marker.code.length * VIEW_MARKER_TEXT_MM * unit / 2;
    min.x = Math.min(min.x, label.x - halfLabel);
    max.x = Math.max(max.x, label.x + halfLabel);
    min.y = Math.min(min.y, label.y - VIEW_MARKER_TEXT_MM * unit);
    max.y = Math.max(max.y, label.y + VIEW_MARKER_TEXT_MM * unit);
  }
  return { min, max };
}

export function viewMarkersDxf(
  markers: Markers, scale: number, existing: DXFPolylineLayer[],
): Pick<DXFExportOptions, 'polylineLayers' | 'labels'> {
  const graphics = markers.map((marker, index) => ({
    line: marker.line,
    trace: markerTraceLines(marker, scale / 1000, marker.line),
    traceLayer: `IFC-SECTION-TRACE-${index + 1}`,
    layer: marker.kind === 'section' ? 'IFC-SECTION-MARKERS' : 'IFC-ELEVATION-MARKERS',
    code: marker.code,
    ...viewMarkerGraphics(marker, scale / 1000),
  }));
  return {
    polylineLayers: [
      ...existing,
      ...graphics.flatMap(marker => [
        ...(marker.line ? [{ name: marker.traceLayer, polylines: marker.trace, color: marker.line.color, closed: false }] : []),
        { name: marker.layer, polylines: marker.line ? marker.polylines.slice(1) : marker.polylines, color: VIEW_MARKER_INK, closed: false },
      ]),
    ],
    labels: graphics.map(marker => ({ layer: marker.layer, color: VIEW_MARKER_INK, text: marker.code,
      position: marker.label, height: VIEW_MARKER_TEXT_MM * scale / 1000 })),
  };
}

export function drawViewMarkersPdf(
  doc: jsPDF, markers: Markers, mapPoint: (x: number, y: number) => { x: number; y: number }, effectiveScale: number, weights?: LineweightRow,
): void {
  if (!markers.length) return;
  doc.setDrawColor(VIEW_MARKER_INK);
  doc.setTextColor(VIEW_MARKER_INK);
  doc.setLineWidth(0.25);
  doc.setFontSize(VIEW_MARKER_TEXT_MM * 72 / 25.4);
  for (const marker of markers) {
    const { polylines, label } = viewMarkerGraphics(marker, effectiveScale / 1000);
    const trace = markerTraceLines(marker, effectiveScale / 1000, marker.line);
    [...trace, ...polylines.slice(1)].forEach((line, index) => {
      const isTrace = index < trace.length;
      doc.setDrawColor(isTrace ? marker.line?.color ?? VIEW_MARKER_INK : VIEW_MARKER_INK);
      doc.setLineWidth(isTrace ? markerLineWidth(marker.line, weights) : 0.25);
      doc.setLineDashPattern(isTrace ? markerLineDash(marker.line, marker.kind) : [], 0);
      for (let i = 1; i < line.length; i++) {
        const a = mapPoint(line[i - 1].x, line[i - 1].y), b = mapPoint(line[i].x, line[i].y);
        doc.line(a.x, a.y, b.x, b.y);
      }
    });
    const p = mapPoint(label.x, label.y);
    doc.text(marker.code, p.x, p.y, { align: 'center', baseline: 'middle' });
  }
}

export function useDrawingViewMarkers(
  drawing: Drawing2D | null, bounds: AxisBounds | undefined, sectionAxis: string, isCustomPlane: boolean,
): Markers {
  const savedViews = useSavedSectionCuts(s => s.cuts);
  const annotationView = useSavedSectionCuts(selectActiveSavedView);
  const { templates, markerStyles } = useSavedSectionCuts(s => s.tagLibrary);
  return useMemo(() => {
    if (!drawing || !bounds || sectionAxis !== 'down' || isCustomPlane) return [];
    const flags = annotationView?.annotationOptions ? DEFAULT_VIEW_MARKERS : annotationView?.markers ?? DEFAULT_VIEW_MARKERS;
    return collectViewMarkers(savedViews, bounds, drawing.config.plane.flipped, flags)
      .map(marker => {
        const override = annotationView?.annotationOptions?.styleIds?.[marker.kind];
        return override && markerStyles?.some(style => style.id === override && style.kind === marker.kind)
          ? { ...marker, styleId: override } : marker;
      })
      .filter(marker => drawingAnnotationVisible(annotationView, marker.kind, marker.styleId))
      .map(marker => {
        const heads = resolveMarkerHeads(templates, marker, markerStyles);
        const line = marker.kind === 'section' ? markerStyles?.find(style => style.id === marker.styleId && style.kind === marker.kind)?.line : undefined;
        return heads.length ? { ...marker, line, heads, headsAtAngle: (angle: number) =>
          resolveMarkerHeads(templates, marker, markerStyles, angle) } : { ...marker, line };
      });
  }, [drawing, bounds, sectionAxis, isCustomPlane, savedViews, annotationView, templates, markerStyles]);
}
