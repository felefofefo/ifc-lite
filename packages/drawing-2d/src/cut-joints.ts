/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DrawingPolygon, Line2D } from './types.js';

// Drawing coordinates are in metres. Match coincident edges within 0.05 mm.
const tolerance = 0.00005;
type Edge = {
  line: Line2D;
  index: number;
  material: string;
  interior: number;
  dx: number;
  dy: number;
  length: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
  covered: [number, number][];
};

/** Keep polygon fills and IFC ownership intact. Suppress only shared cut
 * outline intervals whose filled sides face each other. */
export function suppressCutJoints(
  polygons: DrawingPolygon[],
  materialKey: (polygon: DrawingPolygon) => string | undefined,
): DrawingPolygon[] {
  const byPolygon: Edge[][] = polygons.map(({ polygon }, index) => {
    const material = materialKey(polygons[index]);
    if (!material) return [];
    return [polygon.outer, ...polygon.holes].flatMap((ring, ringIndex) => {
      if (ring.length < 3) return [];
      const origin = ring[0];
      const area = ring.reduce((sum, point, i) => {
        const next = ring[(i + 1) % ring.length];
        return sum + (point.x - origin.x) * (next.y - origin.y) - (point.y - origin.y) * (next.x - origin.x);
      }, 0);
      if (!Number.isFinite(area) || area === 0) return [];
      const interior = Math.sign(area) * (ringIndex === 0 ? 1 : -1);
      return ring.flatMap((start, i): Edge[] => {
        const end = ring[(i + 1) % ring.length];
        const vx = end.x - start.x, vy = end.y - start.y;
        const length = Math.hypot(vx, vy);
        if (!(length > 0)) return [];
        return [{
          line: { start, end }, index, material, interior, length, dx: vx / length, dy: vy / length,
          left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
          bottom: Math.min(start.y, end.y), top: Math.max(start.y, end.y), covered: [],
        }];
      });
    });
  });
  const edges = byPolygon.flat().sort((a, b) => a.left - b.left);
  let active: Edge[] = [];
  for (const edge of edges) {
    active = active.filter(other => other.right + tolerance >= edge.left);
    for (const other of active) {
      if (edge.index === other.index || edge.material !== other.material
        || edge.bottom > other.top + tolerance || other.bottom > edge.top + tolerance) continue;
      const direction = edge.dx * other.dx + edge.dy * other.dy;
      if (Math.abs(direction) < 1 - 1e-8 || direction * edge.interior * other.interior >= 0) continue;
      const a = sharedInterval(edge, other);
      const b = sharedInterval(other, edge);
      if (a && b) {
        edge.covered.push(a);
        other.covered.push(b);
      }
    }
    active.push(edge);
  }
  return polygons.map((polygon, index) => {
    const edges = byPolygon[index];
    return edges.some(edge => edge.covered.length)
      ? { ...polygon, cutOutline: edges.flatMap(remainingEdge) }
      : polygon;
  });
}

function sharedInterval(edge: Edge, other: Edge): [number, number] | undefined {
  const start = edge.line.start;
  const a = { x: other.line.start.x - start.x, y: other.line.start.y - start.y };
  const b = { x: other.line.end.x - start.x, y: other.line.end.y - start.y };
  if (Math.abs(a.x * edge.dy - a.y * edge.dx) > tolerance
    || Math.abs(b.x * edge.dy - b.y * edge.dx) > tolerance) return;
  const ta = a.x * edge.dx + a.y * edge.dy, tb = b.x * edge.dx + b.y * edge.dy;
  const low = Math.max(0, Math.min(ta, tb)), high = Math.min(edge.length, Math.max(ta, tb));
  if (high - low > tolerance) return [low, high];
}

function remainingEdge(edge: Edge): Line2D[] {
  if (!edge.covered.length) return [edge.line];
  const remaining: Line2D[] = [];
  const point = (distance: number) => ({
    x: edge.line.start.x + distance * edge.dx,
    y: edge.line.start.y + distance * edge.dy,
  });
  let from = 0;
  for (const [low, high] of edge.covered.sort((a, b) => a[0] - b[0])) {
    if (low - from > tolerance) remaining.push({ start: point(from), end: point(low) });
    from = Math.max(from, high);
  }
  if (edge.length - from > tolerance) remaining.push({ start: point(from), end: edge.line.end });
  return remaining;
}
