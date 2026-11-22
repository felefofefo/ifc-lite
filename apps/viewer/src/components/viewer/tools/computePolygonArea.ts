/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Polygon area and perimeter computation utilities for 2D annotations.
 * Uses the shoelace formula for area calculation.
 */

interface Point2D {
  x: number;
  y: number;
}

/**
 * Compute the signed area of a simple polygon using the shoelace formula.
 * Returns absolute value (always positive).
 */
export function computePolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Compute the perimeter of a closed polygon.
 */
export function computePolygonPerimeter(points: Point2D[]): number {
  if (points.length < 2) return 0;
  let perimeter = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/** Whether two non-adjacent polygon edges cross or touch (including collinear overlap). */
function edgesIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const cross = (p: Point2D, q: Point2D, r: Point2D) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p: Point2D, q: Point2D, r: Point2D) =>
    q.x >= Math.min(p.x, r.x) && q.x <= Math.max(p.x, r.x)
    && q.y >= Math.min(p.y, r.y) && q.y <= Math.max(p.y, r.y);
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  return ((abC > 0 && abD < 0 || abC < 0 && abD > 0)
      && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0))
    || (abC === 0 && onSegment(a, c, b))
    || (abD === 0 && onSegment(a, d, b))
    || (cdA === 0 && onSegment(c, a, d))
    || (cdB === 0 && onSegment(c, b, d));
}

/** Edited 2D measurement: immutable vertices and freshly derived geometry. */
export function editedPolygonAreaVertex(points: Point2D[], index: number, point: Point2D) {
  if (!Number.isInteger(index) || index < 0 || index >= points.length
    || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const next = points.map((value, i) => i === index ? { ...point } : value);
  const area = computePolygonArea(next);
  if (!(area > 1e-8)) return null;
  const n = next.length;
  for (let i = 0; i < n; i++) {
    if (Math.hypot(next[i].x - next[(i + 1) % n].x, next[i].y - next[(i + 1) % n].y) < 1e-7) return null;
  }
  // Moving one vertex only changes its two incident edges: check those against
  // non-neighbouring edges in O(n), so dragging stays responsive on large areas.
  for (const edge of [(index + n - 1) % n, index]) {
    const end = (edge + 1) % n;
    for (let other = 0; other < n; other++) {
      const otherEnd = (other + 1) % n;
      if (other === edge || other === end || otherEnd === edge) continue;
      if (edgesIntersect(next[edge], next[end], next[other], next[otherEnd])) return null;
    }
  }
  return { points: next, area, perimeter: computePolygonPerimeter(next) };
}

/**
 * Compute the centroid (geometric center) of a polygon.
 */
export function computePolygonCentroid(points: Point2D[]): Point2D {
  if (points.length === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / points.length, y: cy / points.length };
}

/**
 * A room area in square metres at one decimal, whatever its size: the Space
 * Sketch bar and its status line both use it, so an empty draft reads
 * "0.0 m²" in both instead of "0.0 cm²" next to "0.0 m²" (#6233).
 */
export function formatSquareMetres(squareMeters: number): string {
  return `${squareMeters.toFixed(1)} m²`;
}

/**
 * Format an area value for display with appropriate units.
 */
export function formatArea(squareMeters: number): string {
  if (squareMeters < 0.01) {
    return `${(squareMeters * 10000).toFixed(1)} cm²`;
  } else if (squareMeters < 10000) {
    return `${squareMeters.toFixed(2)} m²`;
  } else {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  }
}
