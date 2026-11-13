/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { AxisBounds } from '@/lib/section/section-distance';
import type { jsPDF } from 'jspdf';
import type { Drawing2D, DXFExportOptions, DXFPolylineLayer } from '@ifc-lite/drawing-2d';
import { viewMarkerGraphics, collectViewMarkers, DEFAULT_VIEW_MARKERS } from '../drawing/view-markers';

type Markers = ReturnType<typeof collectViewMarkers>;
type Bounds = Drawing2D['bounds'];

const VIEW_MARKER_INK = '#000000';
const VIEW_MARKER_TEXT_MM = 2.5;

export function viewMarkersSvg(
  markers: ReturnType<typeof collectViewMarkers>,
  map: (x: number, y: number) => { x: number; y: number },
  unit: number, outputUnit: number, escapeXml: (text: string) => string,
): string {
  if (!markers.length) return '';
  const items = markers.map(marker => {
    const { polylines, label } = viewMarkerGraphics(marker, unit);
    const point = map(label.x, label.y);
    const lines = polylines.map((line, i) => {
      const points = line.map(p => { const v = map(p.x, p.y); return `${v.x},${v.y}`; }).join(' ');
      const dash = marker.kind === 'elevation' ? 1 : 3;
      return `<polyline points="${points}" fill="none" stroke="${VIEW_MARKER_INK}" stroke-width="${0.25 * outputUnit}"${i === 0 ? ` stroke-dasharray="${dash * outputUnit} ${outputUnit}"` : ''}/>`;
    });
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
  const graphics = markers.map(marker => ({
    layer: marker.kind === 'section' ? 'IFC-SECTION-MARKERS' : 'IFC-ELEVATION-MARKERS',
    code: marker.code,
    ...viewMarkerGraphics(marker, scale / 1000),
  }));
  return {
    polylineLayers: [
      ...existing,
      ...graphics.map(marker => ({ name: marker.layer, polylines: marker.polylines, color: VIEW_MARKER_INK, closed: false })),
    ],
    labels: graphics.map(marker => ({ layer: marker.layer, color: VIEW_MARKER_INK, text: marker.code,
      position: marker.label, height: VIEW_MARKER_TEXT_MM * scale / 1000 })),
  };
}

export function drawViewMarkersPdf(
  doc: jsPDF, markers: Markers, mapPoint: (x: number, y: number) => { x: number; y: number }, effectiveScale: number,
): void {
  if (!markers.length) return;
  doc.setDrawColor(VIEW_MARKER_INK);
  doc.setTextColor(VIEW_MARKER_INK);
  doc.setLineWidth(0.25);
  doc.setFontSize(VIEW_MARKER_TEXT_MM * 72 / 25.4);
  for (const marker of markers) {
    const { polylines, label } = viewMarkerGraphics(marker, effectiveScale / 1000);
    polylines.forEach((line, index) => {
      doc.setLineDashPattern(index === 0 ? [marker.kind === 'elevation' ? 1 : 3, 1] : [], 0);
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
  const activeView = useSavedSectionCuts(s => s.activeCutId);
  return useMemo(() => {
    if (!drawing || !bounds || sectionAxis !== 'down' || isCustomPlane) return [];
    const flags = savedViews.find(view => view.id === activeView)?.markers ?? DEFAULT_VIEW_MARKERS;
    return collectViewMarkers(savedViews, bounds, drawing.config.plane.flipped, flags);
  }, [drawing, bounds, sectionAxis, isCustomPlane, savedViews, activeView]);
}
