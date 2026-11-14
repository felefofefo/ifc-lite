/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { makeEntityKey, type Drawing2D, type DrawingLine, type DrawingPolygon, type EntityKey, type Line2D } from './types.js';

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
  return joinedPolygons(polygons, findCutJointEdges(polygons, materialKey));
}

type DrawingGeometry = Pick<Drawing2D, 'cutPolygons' | 'lines'>;

/** Remove projection strokes coincident with a cut joint on the same IFC element. */
export function suppressDrawingCutJoints(
  drawing: DrawingGeometry,
  materialKey: (polygon: DrawingPolygon) => string | undefined,
): DrawingGeometry {
  const { cutPolygons, lines } = drawing;
  const edges = findCutJointEdges(cutPolygons, materialKey);
  const byOwner = new Map<EntityKey, Line2D[]>();
  for (const polygonEdges of edges) {
    for (const edge of polygonEdges) {
      if (!edge.covered.length) continue;
      const { modelIndex, entityId } = cutPolygons[edge.index];
      const key = makeEntityKey(modelIndex, entityId);
      let intervals = byOwner.get(key);
      if (!intervals) byOwner.set(key, intervals = []);
      for (const [start, end] of edge.covered) {
        intervals.push({ start: pointAlong(edge, start), end: pointAlong(edge, end) });
      }
    }
  }
  if (!byOwner.size) return drawing;

  return {
    cutPolygons: joinedPolygons(cutPolygons, edges),
    lines: lines.flatMap(line => {
      if (line.category !== 'projection' || line.overhead) return [line];
      const intervals = byOwner.get(makeEntityKey(line.modelIndex, line.entityId));
      return intervals ? clipProjectionLine(line, intervals) : [line];
    }),
  };
}

function findCutJointEdges(
  polygons: DrawingPolygon[],
  materialKey: (polygon: DrawingPolygon) => string | undefined,
): Edge[][] {
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
      const a = sharedInterval(edge, other.line);
      const b = sharedInterval(other, edge.line);
      if (a && b) {
        edge.covered.push(a);
        other.covered.push(b);
      }
    }
    active.push(edge);
  }
  return byPolygon;
}

function joinedPolygons(polygons: DrawingPolygon[], byPolygon: Edge[][]): DrawingPolygon[] {
  return polygons.map((polygon, index) => {
    const edges = byPolygon[index];
    return edges.some(edge => edge.covered.length)
      ? { ...polygon, cutOutline: edges.flatMap(remainingEdge) }
      : polygon;
  });
}

type Segment = Pick<Edge, 'line' | 'length' | 'dx' | 'dy' | 'covered'>;

function sharedInterval(edge: Segment, other: Line2D): [number, number] | undefined {
  const start = edge.line.start;
  const a = { x: other.start.x - start.x, y: other.start.y - start.y };
  const b = { x: other.end.x - start.x, y: other.end.y - start.y };
  if (Math.abs(a.x * edge.dy - a.y * edge.dx) > tolerance
    || Math.abs(b.x * edge.dy - b.y * edge.dx) > tolerance) return;
  const ta = a.x * edge.dx + a.y * edge.dy, tb = b.x * edge.dx + b.y * edge.dy;
  const low = Math.max(0, Math.min(ta, tb)), high = Math.min(edge.length, Math.max(ta, tb));
  if (high - low > tolerance) return [low, high];
}

function pointAlong(edge: Segment, distance: number) {
  return {
    x: edge.line.start.x + distance * edge.dx,
    y: edge.line.start.y + distance * edge.dy,
  };
}

function remainingEdge(edge: Segment): Line2D[] {
  if (!edge.covered.length) return [edge.line];
  const remaining: Line2D[] = [];
  let from = 0;
  for (const [low, high] of edge.covered.sort((a, b) => a[0] - b[0])) {
    if (low - from > tolerance) remaining.push({ start: pointAlong(edge, from), end: pointAlong(edge, low) });
    from = Math.max(from, high);
  }
  if (edge.length - from > tolerance) remaining.push({ start: pointAlong(edge, from), end: edge.line.end });
  return remaining;
}

function clipProjectionLine(drawingLine: DrawingLine, intervals: Line2D[]): DrawingLine[] {
  const { line, depth, depthEnd } = drawingLine;
  const x = line.end.x - line.start.x, y = line.end.y - line.start.y;
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= tolerance) return [drawingLine];

  const edge: Segment = { line, length, dx: x / length, dy: y / length, covered: [] };
  for (const interval of intervals) {
    const overlap = sharedInterval(edge, interval);
    if (overlap) edge.covered.push(overlap);
  }
  if (!edge.covered.length) return [drawingLine];

  const depthAt = (point: Line2D['start']) => depth + ((depthEnd ?? depth) - depth) *
    ((point.x - line.start.x) * edge.dx + (point.y - line.start.y) * edge.dy) / length;
  return remainingEdge(edge).map(segment => ({
    ...drawingLine,
    line: segment,
    depth: depthAt(segment.start),
    depthEnd: depthEnd === undefined ? undefined : depthAt(segment.end),
  }));
}
