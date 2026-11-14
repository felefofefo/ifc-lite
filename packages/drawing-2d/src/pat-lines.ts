/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { DrawingPolygon, Line2D, Point2D, Polygon2D } from './types.js';
import { HatchGenerator } from './hatch-generator.js';

export interface PatternLine { angle: number; x: number; y: number; dx: number; dy: number; dash: number[] }

/** Clip the PAT line families in their original Y-up coordinate system. */
export function patternSegments(polygon: Polygon2D, families: readonly PatternLine[], scale: number): Line2D[] {
  const result: Line2D[] = [];
  const clipper = new HatchGenerator();
  const ring = polygon.outer;
  if (ring.length < 3 || !(scale > 0) || !Number.isFinite(scale)) return result;
  let budget = 100_000;
  for (const { angle, x, y, dx, dy, dash } of families) {
    const theta = angle * Math.PI / 180;
    const c = Math.cos(theta), s = Math.sin(theta);
    const base = { x: x * scale, y: y * scale };
    const along = (p: Point2D) => (p.x - base.x) * c + (p.y - base.y) * s;
    const normal = (p: Point2D) => -(p.x - base.x) * s + (p.y - base.y) * c;
    const step = dy * scale;
    if (!step || !Number.isFinite(step)) continue;
    let low = Infinity, high = -Infinity, start = Infinity, end = -Infinity;
    for (const p of ring) {
      const n = normal(p) / step, a = along(p);
      low = Math.min(low, n); high = Math.max(high, n);
      start = Math.min(start, a); end = Math.max(end, a);
    }
    const from = Math.ceil(low), to = Math.floor(high);
    const cycle = dash.reduce((total, d) => total + Math.abs(d * scale), 0);
    const point = (t: number, offset: number) => ({ x: base.x + c * t - s * offset, y: base.y + s * t + c * offset });
    for (let row = from; row <= to && budget-- > 0; row++) {
      const offset = row * step;
      if (!dash.length) {
        result.push(...clipper.clipLineToPolygon({ start: point(start, offset), end: point(end, offset) }, polygon));
        continue;
      }
      if (!(cycle > 0)) continue;
      const phase = row * dx * scale;
      for (let t = phase + Math.floor((start - phase) / cycle) * cycle; t <= end && budget-- > 0; t += cycle) {
        let at = t;
        for (const d of dash) {
          const next = at + Math.abs(d * scale);
          if (d >= 0 && next >= start && at <= end) {
            const tip = d === 0 ? at + 0.05 * scale : next;
            result.push(...clipper.clipLineToPolygon({ start: point(at, offset), end: point(tip, offset) }, polygon));
          }
          at = next;
        }
      }
    }
  }
  return result;
}

/** Lay out the pattern on the physical face, then project its clipped strokes into the drawing. */
export function surfacePatternSegments(
  polygon: DrawingPolygon,
  paint: { pattern: 'diagonal' | 'cross-hatch' | 'custom'; spacing: number; families?: readonly PatternLine[] },
): Line2D[] {
  const [a, b, c, d, x, y] = polygon.surfacePatternTransform ?? [1, 0, 0, 1, 0, 0];
  const det = a * d - b * c;
  const toFace = (p: Point2D) => ({ x: a * p.x + c * p.y + x, y: b * p.x + d * p.y + y });
  const toDrawing = (p: Point2D) => ({
    x: (d * (p.x - x) - c * (p.y - y)) / det,
    y: (a * (p.y - y) - b * (p.x - x)) / det,
  });
  const shape = { outer: polygon.polygon.outer.map(toFace), holes: polygon.polygon.holes.map(ring => ring.map(toFace)) };
  const families = paint.pattern === 'custom' ? paint.families ?? [] :
    (paint.pattern === 'cross-hatch' ? [-45, 45] : [-45]).map(angle => ({ angle, x: 0, y: 0, dx: 0, dy: 1, dash: [] }));
  return patternSegments(shape, families, paint.spacing)
    .map(({ start, end }) => ({ start: toDrawing(start), end: toDrawing(end) }));
}
