/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { buildLocus, projectOntoLocus } from '../snap/constraints.js';
import type { SnapProfile, Vec2 } from '../snap/types.js';
import { pathMetrics, rectanglePath, circlePath, threePointArcPath, pathEdges, samplePath, type DrawingPath, type PathPoint } from './path-geometry.js';

export type SketchShape = 'polygon' | 'rectangle' | 'line' | 'polyline' | 'circle' | 'arc';
export type SketchMode = 'area' | 'path';
export type SketchFields = { first: string; second: string };
export const EMPTY_SKETCH_FIELDS: SketchFields = { first: '', second: '' };
const profile: SnapProfile = { radiusPx: 0, tiers: [], sources: [] };
const EPS = 1e-8;

/** Blank means unconstrained. Reject malformed, infinite and non-positive distances. */
function readValue(text: string, positive: boolean): number | undefined | null {
  const value = text.trim().replace(',', '.');
  if (!value) return undefined;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && (!positive || n > EPS) ? n : null;
}

export function readSketchFields(shape: SketchShape, fields: SketchFields) {
  const first = readValue(fields.first, true), second = shape === 'circle' ? undefined : readValue(fields.second, shape === 'rectangle');
  return first === null || second === null ? null : { first, second };
}

/** Existing snap/direction resolution runs first. Explicit typed values take
 * precedence. A snap glyph is retained only if that exact point was accepted. */
export function constrainSketchPoint(shape: SketchShape, anchor: PathPoint, candidate: PathPoint,
  reference: PathPoint | null, fields: SketchFields): { point: PathPoint; reference: PathPoint | null } | null {
  const values = readSketchFields(shape, fields);
  if (!values || ![anchor.x, anchor.y, candidate.x, candidate.y].every(Number.isFinite)) return null;
  const { first, second } = values;
  if (first === undefined && second === undefined) return { point: candidate, reference };
  let point: PathPoint;
  if (shape === 'rectangle') {
    const dx = candidate.x - anchor.x, dy = candidate.y - anchor.y;
    point = { x: first === undefined ? candidate.x : anchor.x + (dx < 0 ? -first : first),
      y: second === undefined ? candidate.y : anchor.y + (dy < 0 ? -second : second) };
  } else {
    const cursor: Vec2 = [candidate.x, candidate.y];
    // When just the angle is typed, keep the current radial distance. This
    // avoids a backwards cursor collapsing the segment onto the anchor.
    const length = first ?? (second !== undefined ? Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y) : undefined);
    if (length !== undefined && !Number.isFinite(length)) return null;
    const locus = buildLocus({ cursor, anchor: [anchor.x, anchor.y], metresPerPixel: 1,
      chain: [], modifiers: { shift: false, alt: false }, locks: { length, angleDeg: second } }, profile);
    const [x, y] = projectOntoLocus(cursor, locus);
    point = { x, y };
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { point, reference: reference && Math.hypot(reference.x - point.x, reference.y - point.y) <= EPS ? reference : null };
}

export function sketchMeasures(shape: SketchShape, anchor: PathPoint, point: PathPoint) {
  const dx = point.x - anchor.x, dy = point.y - anchor.y;
  return shape === 'rectangle' ? { first: Math.abs(dx), second: Math.abs(dy) }
    : { first: Math.hypot(dx, dy), second: ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360 };
}

/** A graphical stroke is not a measured/filled area, even when closed. */
export function sketchPath(points: readonly PathPoint[], closed: boolean, bulges?: readonly number[]) {
  if (bulges && (bulges.length !== points.length || !bulges.every(Number.isFinite))) return null;
  if (points.length < (closed && !bulges ? 3 : 2)) return null;
  const vertices = points.map(({ x, y }, i) => ({ x, y, ...(bulges ? { bulge: bulges[i] } : {}) }));
  const metrics = pathMetrics({ vertices, closed });
  if (!metrics || !(metrics.length > EPS) || (closed && points.length === 2 && !(metrics.area > EPS))) return null;
  return { points: vertices.map(({ x, y }) => ({ x, y })), area: 0, perimeter: metrics.length, pathClosed: closed,
    ...(bulges && { pathBulges: [...bulges] }) };
}

/** Curves remain exact; a separate bulge array survives existing Move/Copy translations. */
export function sketchCurve(shape: 'circle' | 'arc', points: readonly PathPoint[], cursor: PathPoint) {
  const path = shape === 'circle' && points.length === 1
    ? circlePath(points[0], Math.hypot(cursor.x - points[0].x, cursor.y - points[0].y))
    : shape === 'arc' && points.length === 2 ? threePointArcPath(points[0], points[1], cursor) : null;
  return path && sketchPath(path.vertices, path.closed, path.vertices.map(v => v.bulge ?? 0));
}

export type StoredPath = { points: readonly PathPoint[]; pathClosed?: boolean; pathBulges?: readonly number[] };
export function storedPath(item: StoredPath): DrawingPath {
  return { closed: item.pathClosed ?? true, vertices: item.points.map((p, i) => ({ ...p, bulge: item.pathBulges?.[i] ?? 0 })) };
}

/** Derived display/pick/PDF polyline. Radius-relative tolerance bounds memory,
 * and no sample becomes an authored vertex or an object snap. */
export function pathDisplayPoints(item: StoredPath, tolerance = 0.0001): readonly PathPoint[] {
  if (!item.pathBulges) return item.points;
  const path = storedPath(item), edges = pathEdges(path);
  if (!edges) return [];
  const radius = Math.max(0, ...edges.map(edge => edge.arc?.radius ?? 0));
  return samplePath(path, Math.max(tolerance, radius * 1e-7)) ?? [];
}

export function curveMeasurements(item: StoredPath) {
  const arc = pathEdges(storedPath(item))?.[0]?.arc;
  return arc ? { radius: arc.radius, sweep: item.pathClosed ? 360 : Math.abs(arc.sweep) * 180 / Math.PI } : undefined;
}

/** Native SVG arcs, with sweep corrected for the drawing-to-page reflection. */
export function curveSvgPath(item: StoredPath, map: (point: PathPoint) => PathPoint): string | null {
  const edges = pathEdges(storedPath(item));
  if (!edges?.length) return null;
  const origin = map({x:0,y:0}), u = map({x:1,y:0}), v = map({x:0,y:1});
  const ux=u.x-origin.x, uy=u.y-origin.y, vx=v.x-origin.x, vy=v.y-origin.y;
  const sx=Math.hypot(ux,uy), sy=Math.hypot(vx,vy), det=ux*vy-uy*vx;
  if (!(sx>0 && sy>0) || Math.abs(sx-sy)>1e-6*Math.max(sx,sy) || Math.abs(ux*vx+uy*vy)>1e-6*sx*sy) return null;
  const start=map(edges[0].start);
  if (![start.x,start.y,sx,sy,det].every(Number.isFinite)) return null;
  let d=`M${start.x} ${start.y}`;
  for(const edge of edges){
    const p=map(edge.end), arc=edge.arc;
    if (![p.x,p.y,arc ? arc.radius*sx : 0].every(Number.isFinite)) return null;
    if(arc) d+=` A${arc.radius*sx} ${arc.radius*sx} 0 ${Math.abs(arc.sweep)>Math.PI?1:0} ${arc.sweep*det>0?1:0} ${p.x} ${p.y}`;
    else d+=` L${p.x} ${p.y}`;
  }
  return item.pathClosed ? d+' Z' : d;
}

/** Exact straight boundary from the 10A foundation; never commit a collapsed rectangle. */
export function sketchRectangle(a: PathPoint, b: PathPoint) {
  const path = rectanglePath(a, b);
  const metrics = path && pathMetrics(path);
  return path && metrics && metrics.area > EPS ? {
    points: path.vertices.map(({ x, y }) => ({ x, y })), area: metrics.area, perimeter: metrics.length,
  } : null;
}
