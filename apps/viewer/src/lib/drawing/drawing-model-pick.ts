/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isOccludedDrawingLine, isPolygonCutLine, type Drawing2D, type Point2D } from '@ifc-lite/drawing-2d';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Line = Drawing2D['lines'][number];
type Face = Drawing2D['cutPolygons'][number];
type Geometry = { lines: Line[]; faces: Face[] };
type Entry = Bounds & { id: number; line?: Line; face?: Face; hidden: boolean; priority: number; depth: number };
type Hit = { id: number; hidden: boolean; priority: number; distance: number; depth: number };
type Node = Bounds & { entries: Entry[] } | Bounds & { children: [Node, Node] };

export function bounds(points: readonly Point2D[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function build(entries: Entry[]): Node {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const entry of entries) {
    box.minX = Math.min(box.minX, entry.minX);
    box.minY = Math.min(box.minY, entry.minY);
    box.maxX = Math.max(box.maxX, entry.maxX);
    box.maxY = Math.max(box.maxY, entry.maxY);
  }
  if (entries.length <= 16) return { ...box, entries };
  const horizontal = box.maxX - box.minX >= box.maxY - box.minY;
  entries.sort((a, b) => horizontal ? (a.minX + a.maxX) - (b.minX + b.maxX) : (a.minY + a.maxY) - (b.minY + b.maxY));
  const middle = entries.length >> 1;
  return { ...box, children: [build(entries.slice(0, middle)), build(entries.slice(middle))] };
}

function contains(box: Bounds, point: Point2D, pad: number) {
  return point.x >= box.minX - pad && point.x <= box.maxX + pad &&
    point.y >= box.minY - pad && point.y <= box.maxY + pad;
}

export function insideRing(point: Point2D, ring: readonly Point2D[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function nearest(point: Point2D, a: Point2D, b: Point2D) {
  const x = b.x - a.x, y = b.y - a.y;
  const lengthSquared = x * x + y * y;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * x + (point.y - a.y) * y) / lengthSquared)) : 0;
  return { t, distance: Math.hypot(point.x - a.x - t * x, point.y - a.y - t * y) };
}

function pickDistance(entry: Entry, point: Point2D, tolerance: number) {
  if (entry.line) {
    const { t, distance } = nearest(point, entry.line.line.start, entry.line.line.end);
    const depth = entry.depth + ((entry.line.depthEnd ?? entry.depth) - entry.depth) * t;
    return distance <= tolerance ? { distance, depth } : null;
  }
  const face = entry.face;
  if (!face) return null;
  const { outer, holes } = face.polygon;
  if (insideRing(point, outer) && !holes.some(ring => insideRing(point, ring))) {
    return { distance: 0, depth: entry.depth };
  }
  // Cut polygons own their contour in the renderer, even with hatching disabled.
  if (!face.isCut) return null;
  const edges = face.cutOutline;
  const distance = edges
    ? edges.reduce((min, edge) => Math.min(min, nearest(point, edge.start, edge.end).distance), Infinity)
    : [outer, ...holes].reduce((best, ring) => ring.reduce((min, a, i) =>
      Math.min(min, nearest(point, a, ring[(i + 1) % ring.length]).distance), best), Infinity);
  return distance <= tolerance ? { distance, depth: entry.depth } : null;
}

// Liang-Barsky clipping: a bounding box overlap alone is not a crossing.
export function segmentCrossesBox(a: Point2D, b: Point2D, box: Bounds): boolean {
  let lo = 0, hi = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.minX], [dx, box.maxX - a.x],
    [-dy, a.y - box.minY], [dy, box.maxY - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return true;
}

export function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function boxContains(outer: Bounds, inner: Bounds): boolean {
  return outer.minX <= inner.minX && outer.maxX >= inner.maxX &&
    outer.minY <= inner.minY && outer.maxY >= inner.maxY;
}

function entryCrossesBox(entry: Entry, box: Bounds): boolean {
  if (!boxesOverlap(entry, box)) return false;
  if (entry.line) return segmentCrossesBox(entry.line.line.start, entry.line.line.end, box);
  if (!entry.face) return false;
  const { outer, holes } = entry.face.polygon;
  // Includes edge contact, polygons inside the box, and boxes inside a face.
  // A window entirely inside a polygon hole does not select that face.
  if ([outer, ...holes].some(ring => ring.some((a, i) =>
    segmentCrossesBox(a, ring[(i + 1) % ring.length], box)))) return true;
  return [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }]
    .some(point => insideRing(point, outer) && !holes.some(ring => insideRing(point, ring)));
}

export function createDrawingModelIndex(drawing: Drawing2D, showHidden: boolean) {
  const byId = new Map<number, Geometry>();
  const entries: Entry[] = [];
  function add(entry: Entry) {
    if (!(entry.id > 0) || !Number.isFinite(entry.minX + entry.minY + entry.maxX + entry.maxY)) return;
    let geometry = byId.get(entry.id);
    if (!geometry) byId.set(entry.id, geometry = { lines: [], faces: [] });
    if (entry.line) geometry.lines.push(entry.line);
    if (entry.face) geometry.faces.push(entry.face);
    entries.push(entry);
  }
  for (const line of drawing.lines) {
    const hidden = isOccludedDrawingLine(line);
    if ((!showHidden && hidden) || isPolygonCutLine(line) || line.category === 'annotation') continue;
    add({ ...bounds([line.line.start, line.line.end]), id: line.entityId, line, hidden,
      priority: line.category === 'cut' ? 0 : 1, depth: Number.isFinite(line.depth) ? line.depth : 0 });
  }
  for (const face of [...drawing.cutPolygons, ...(drawing.projectionPolygons ?? [])]) {
    const depths = face.vertexDepths?.filter(Number.isFinite);
    const depth = face.isCut ? 0 : depths?.length ? depths.reduce((a, b) => a + b, 0) / depths.length : Infinity;
    add({ ...bounds(face.polygon.outer), id: face.entityId, face, hidden: false, priority: face.isCut ? 0 : 2, depth });
  }
  const tree = build(entries);
  return {
    byId,
    selectBox(a: Point2D, b: Point2D, crossing: boolean): number[] {
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return [];
      const box = bounds([a, b]);
      const hits = new Set<number>();
      // Window mode requires ALL visible pieces of an entity to be contained.
      // Crossing mode requires at least one actual geometry intersection.
      if (!crossing) {
        const rejected = new Set<number>();
        for (const entry of entries) {
          if (boxContains(box, entry)) hits.add(entry.id);
          else rejected.add(entry.id);
        }
        return Array.from(hits).filter(id => !rejected.has(id));
      }
      function visit(node: Node) {
        if (!boxesOverlap(node, box)) return;
        if ('children' in node) { node.children.forEach(visit); return; }
        for (const entry of node.entries) {
          if (!hits.has(entry.id) && entryCrossesBox(entry, box)) hits.add(entry.id);
        }
      }
      visit(tree);
      return Array.from(hits);
    },
    pick(point: Point2D, tolerance: number): number[] {
      const hits = new Map<number, Hit>();
      const compare = (a: Hit, b: Hit) => Number(a.hidden) - Number(b.hidden) || a.priority - b.priority ||
        a.distance - b.distance || a.depth - b.depth || a.id - b.id;
      function visit(node: Node) {
        if (!contains(node, point, tolerance)) return;
        if ('children' in node) {
          node.children.forEach(visit);
          return;
        }
        for (const entry of node.entries) {
          if (!contains(entry, point, tolerance)) continue;
          const distance = pickDistance(entry, point, tolerance);
          if (!distance) continue;
          const hit = { ...distance, id: entry.id, priority: entry.priority, hidden: entry.hidden };
          const previous = hits.get(entry.id);
          if (!previous || compare(hit, previous) < 0) hits.set(entry.id, hit);
        }
      }
      visit(tree);
      return Array.from(hits.values()).sort(compare).map(hit => hit.id);
    },
  };
}
