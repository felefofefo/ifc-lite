/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Drawing2D, DrawingLine, Point2D } from '@ifc-lite/drawing-2d';

export interface DistantElements { offset: number; fade: number; color?: string; weight?: number }
export const DEFAULT_DISTANT: DistantElements = { offset: 3, fade: 0.6 };
const mixPoint = (a: Point2D, b: Point2D, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function distantColor(color: string, settings: DistantElements): string {
  if (!settings.fade) return settings.color ?? color;
  color = settings.color ?? color;
  const rgb = /^#([0-9a-f]{6})$/i.exec(color);
  const hex = rgb ? Number.parseInt(rgb[1], 16) : 0;
  const fade = (shift: number) => Math.round(((hex >> shift) & 255) * (1 - settings.fade) + 255 * settings.fade).toString(16).padStart(2, '0');
  return `#${fade(16)}${fade(8)}${fade(0)}`;
}

export function splitDistantLine(line: DrawingLine, offset: number): DrawingLine[] {
  if (line.category === 'cut' || line.category === 'annotation') return [line];
  const endDepth = line.depthEnd ?? line.depth;
  const farStart = line.depth >= offset, farEnd = endDepth >= offset;
  if (farStart === farEnd) return [farStart ? { ...line, distant: true } : line];
  const point = mixPoint(line.line.start, line.line.end, (offset - line.depth) / (endDepth - line.depth));
  return [
    { ...line, line: { start: line.line.start, end: point }, depthEnd: offset, distant: farStart },
    { ...line, line: { start: point, end: line.line.end }, depth: offset, distant: farEnd },
  ].filter(part => part.line.start.x !== part.line.end.x || part.line.start.y !== part.line.end.y);
}

export function applyDistantZone(drawing: Drawing2D | null, settings?: DistantElements): Drawing2D | null {
  if (!drawing || !settings || drawing.config.plane.axis === 'y' && !drawing.config.plane.customPlane) return drawing;
  return { ...drawing, lines: drawing.lines.flatMap(line => splitDistantLine(line, settings.offset)),
    projectionPolygons: (drawing.projectionPolygons ?? []).flatMap(polygon => {
      const points = polygon.polygon.outer;
      const depths = polygon.vertexDepths;
      if (!depths || depths.length !== points.length) return [polygon];
      if (depths.every(depth => depth < settings.offset)) return [polygon];
      if (depths.every(depth => depth >= settings.offset)) return [{ ...polygon, distant: true }];
      return [false, true].flatMap(distant => {
        const outer: Point2D[] = [];
        for (let i = 0; i < points.length; i++) {
          const next = (i + 1) % points.length;
          const start = depths[i], end = depths[next];
          if ((start >= settings.offset) === distant) outer.push(points[i]);
          if ((start >= settings.offset) !== (end >= settings.offset)) {
            outer.push(mixPoint(points[i], points[next], (settings.offset - start) / (end - start)));
          }
        }
        return outer.length >= 3 ? [{ ...polygon, distant, polygon: { outer, holes: [] }, vertexDepths: undefined }] : [];
      });
    }),
  };
}
