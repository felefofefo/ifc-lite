/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isDegenerateMeasurement } from '../../store/slices/drawing2DDegenerateGuards';

export interface Point {
  x: number;
  y: number;
}

/** Resolve ticks and a horizontal label after mapping the endpoints into a y-down output. */
export function dimensionLine(start: Point, end: Point, tickSize: number, labelGap: number) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return null;

  // Use a consistent direction so picking the endpoints in reverse preserves the drawing.
  const sign = dx < 0 || (dx === 0 && dy < 0) ? -1 : 1;
  const tangentX = sign * dx / length;
  const tangentY = sign * dy / length;
  const tickX = (tangentX + tangentY) * tickSize / 2;
  const tickY = (tangentY - tangentX) * tickSize / 2;
  const ticks = [start, end].map(({ x, y }) => [
    { x: x - tickX, y: y - tickY },
    { x: x + tickX, y: y + tickY },
  ] as const);

  return {
    ticks,
    label: {
      x: (start.x + end.x) / 2 + tangentY * labelGap,
      y: (start.y + end.y) / 2 - tangentX * labelGap,
    },
  };
}

export const DIMENSION_TYPES = ['aligned', 'horizontal', 'vertical', 'angular', 'radius', 'diameter'] as const;
export type DimensionType = typeof DIMENSION_TYPES[number];

export interface DimensionDraft {
  points: Point[];
  placing: boolean;
  angularSide?: Point;
  alignedAxis?: Point;
}

export interface DimensionSegment {
  start: Point;
  end: Point;
  distance: number;
  anchors: [Point, Point];
  shape?: DimensionShape;
}


export type CurvedDimensionKind = 'angular' | 'radius' | 'diameter';
export type DimensionShape = { kind: CurvedDimensionKind; center: Point; label: Point };

export function isCurvedDimension(type: DimensionType): type is CurvedDimensionKind {
  return type === 'angular' || type === 'radius' || type === 'diameter';
}

export function mapDimensionShape(shape: DimensionShape | undefined, map: (point: Point) => Point) {
  return shape && { ...shape, center: map(shape.center), label: map(shape.label) };
}

const direction = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);
const length = (from: Point, to: Point) => Math.hypot(to.x - from.x, to.y - from.y);
const polar = (center: Point, angle: number, radius: number) => ({
  x: center.x + Math.cos(angle) * radius,
  y: center.y + Math.sin(angle) * radius,
});
const turn = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function circleCenter(a: Point, b: Point, c: Point): Point | null {
  const bx = b.x - a.x, by = b.y - a.y;
  const cx = c.x - a.x, cy = c.y - a.y;
  const b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const determinant = 2 * (bx * cy - by * cx);
  if (Math.abs(determinant) <= 1e-8 * Math.max(b2, c2)) return null;
  return {
    x: a.x + (b2 * cy - c2 * by) / determinant,
    y: a.y + (c2 * bx - b2 * cx) / determinant,
  };
}

export function curvedDimension(points: readonly Point[], kind: CurvedDimensionKind, placement?: Point, angularSide?: Point): DimensionSegment | null {
  if (points.length !== 3) return null;
  const [a, b, c] = points;
  if (kind === 'angular') {
    if (isDegenerateMeasurement(length(a, b)) || isDegenerateMeasurement(length(a, c))) return null;
    let angle = direction(a, b);
    const sweep = turn(direction(a, c) - angle);
    if (Math.abs(sweep) < 1e-8) return null;

    // The opposite sector has the same included angle.
    const bisector = angle + sweep / 2;
    if (angularSide && Math.cos(direction(a, angularSide) - bisector) < -1e-12) {
      angle += Math.PI;
    }
    const radius = placement ? length(a, placement) : Math.min(length(a, b), length(a, c));
    if (isDegenerateMeasurement(radius)) return null;
    return {
      start: polar(a, angle, radius), end: polar(a, angle + sweep, radius),
      anchors: [b, c], distance: Math.abs(sweep) * 180 / Math.PI,
      shape: { kind, center: a, label: polar(a, angle + sweep / 2, radius) },
    };
  }
  const center = circleCenter(a, b, c);
  if (!center) return null;
  const radius = length(center, a);
  if (!Number.isFinite(radius) || isDegenerateMeasurement(radius)) return null;
  const angle = direction(center, placement ?? a);
  const end = polar(center, angle, radius);
  const start = kind === 'diameter' ? polar(center, angle + Math.PI, radius) : center;
  return {
    start, end, anchors: [start, end], distance: radius * (kind === 'diameter' ? 2 : 1),
    shape: { kind, center, label: polar(center, angle, Math.max(radius, placement ? length(center, placement) : radius)) },
  };
}

export function dimensionArc(start: Point, end: Point, center: Point, middle: Point): Point[] {
  const angle = direction(center, start);
  const sweep = 2 * turn(direction(center, middle) - angle);
  const radius = length(center, start);
  const count = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 72)));
  return [start, ...Array.from({ length: count - 1 }, (_, index) =>
    polar(center, angle + sweep * (index + 1) / count, radius)), end];
}

export function repositionCurvedDimension(segment: DimensionSegment, newOrigin: Point): DimensionSegment | null {
  const shape = segment.shape;
  if (!shape) return null;
  if (shape.kind === 'angular') {
    return curvedDimension([shape.center, ...segment.anchors], shape.kind, newOrigin, shape.label);
  }
  const { center } = shape;
  const radius = length(center, segment.end);
  if (isDegenerateMeasurement(length(center, newOrigin))) return null;
  return curvedDimension([
    polar(center, 0, radius),
    polar(center, Math.PI / 2, radius),
    polar(center, Math.PI, radius),
  ], shape.kind, newOrigin);
}

export const EMPTY_DIMENSION_DRAFT: DimensionDraft = { points: [], placing: false };

function dimensionAxis(type: DimensionType, first: Point, second: Point): Point | null {
  if (type === 'horizontal') return { x: 1, y: 0 };
  if (type === 'vertical') return { x: 0, y: 1 };
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy);
  return isDegenerateMeasurement(distance) ? null : { x: dx / distance, y: dy / distance };
}

function project(origin: Point, point: Point, axis: Point): number {
  return (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
}

export function dimensionSegments(
  points: readonly Point[], type: DimensionType, offsetPoint?: Point, angularSide?: Point, alignedAxis?: Point,
): DimensionSegment[] {
  if (isCurvedDimension(type)) {
    const segment = curvedDimension(points, type, offsetPoint, angularSide);
    return segment ? [segment] : [];
  }
  if (points.length < 2) return [];
  const origin = points[0];
  const axis = (type === 'aligned' ? alignedAxis : undefined) ?? dimensionAxis(type, origin, points[1]);
  if (!axis) return [];
  const normal = { x: -axis.y, y: axis.x };
  const offset = offsetPoint ? project(origin, offsetPoint, normal) : 0;
  const stations = points.map(anchor => ({ anchor, station: project(origin, anchor, axis) }))
    .sort((a, b) => a.station - b.station);
  const linePoint = (station: number) => ({
    x: origin.x + axis.x * station + normal.x * offset,
    y: origin.y + axis.y * station + normal.y * offset,
  });
  const segments: DimensionSegment[] = [];
  let previous = stations[0];
  for (const next of stations.slice(1)) {
    const distance = next.station - previous.station;
    if (isDegenerateMeasurement(distance)) continue;
    segments.push({
      start: linePoint(previous.station),
      end: linePoint(next.station),
      distance,
      anchors: [previous.anchor, next.anchor],
    });
    previous = next;
  }
  return segments;
}

/** Geometry shared by dimension creation and offset editing. */
type DimensionSnapTarget = {
  start: Point; end: Point;
  dimension?: { shape?: DimensionShape; chainId?: string; anchors?: readonly Point[] };
};

/** Actual reference points, not the ends of the decorative tick strokes. */
export function dimensionSnapVertices(
  targets: readonly DimensionSnapTarget[], excluded?: ReadonlySet<string>,
): (readonly [number, number])[] {
  const vertices: (readonly [number, number])[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const data = target.dimension;
    if (!data || (data.chainId && excluded?.has(data.chainId))) continue;
    for (const p of [target.start, target.end, ...(data.anchors ?? [])]) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      vertices.push([p.x, p.y]);
    }
  }
  return vertices;
}

/** Keep the geometric solution separate from the stationary visual feedback. */
export interface DimensionAlignment {
  point: Point;
  reference: Point;
}

/** Project the requested position onto the nearest parallel dimension line,
 * including its continuation beyond either tick. Exclude the moving chain. */
export function parallelDimensionPoint(
  axis: Point, point: Point, targets: readonly DimensionSnapTarget[],
  tolerance: number, excluded?: ReadonlySet<string>,
): DimensionAlignment | null {
  const length = Math.hypot(axis.x, axis.y);
  if (!Number.isFinite(length) || length < 1e-8 || !Number.isFinite(tolerance)
    || tolerance <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const normal = { x: -axis.y / length, y: axis.x / length };
  let best: DimensionAlignment | null = null;
  let distance = tolerance;
  for (const target of targets) {
    const data = target.dimension;
    if (!data || data.shape || (data.chainId && excluded?.has(data.chainId))) continue;
    const dx = target.end.x - target.start.x, dy = target.end.y - target.start.y;
    const span = Math.hypot(dx, dy);
    if (!Number.isFinite(span) || span < 1e-8
      || Math.abs(dx * normal.x + dy * normal.y) / span > 1e-6) continue;
    const offset = project(point, target.start, normal);
    if (!Number.isFinite(offset) || Math.abs(offset) > distance
      || (best && Math.abs(offset) === distance)) continue;
    const candidate = { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
    // The snap solution slides along the supporting line, but the icon stays
    // on the actual reference segment, not on the cursor projection.
    const reference = { x: target.start.x + dx / 2, y: target.start.y + dy / 2 };
    if (!Number.isFinite(reference.x) || !Number.isFinite(reference.y)) continue;
    distance = Math.abs(offset);
    best = { point: candidate, reference };
  }
  return best;
}

/** Snap a draft's line offset without changing the measured anchors. */
export function dimensionAlignmentPoint(
  draft: DimensionDraft, type: DimensionType, point: Point,
  targets: readonly DimensionSnapTarget[], tolerance: number,
): DimensionAlignment | null {
  if (!draft.placing || isCurvedDimension(type) || draft.points.length < 2) return null;
  const axis = (type === 'aligned' ? draft.alignedAxis : undefined)
    ?? dimensionAxis(type, draft.points[0], draft.points[1]);
  return axis ? parallelDimensionPoint(axis, point, targets, tolerance) : null;
}

/** A continuation uses the existing dimension's tick line and its extreme
 * measured anchors. Existing segments (including label overrides) stay intact. */
export function continueLinearDimension(
  chain: readonly DimensionSnapTarget[], point: Point,
): DimensionSegment | null {
  const first = chain[0];
  const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!first?.dimension || !finite(point) || !finite(first.start) || !finite(first.end)) return null;
  const origin = first.start;
  const dx = first.end.x - origin.x, dy = first.end.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || isDegenerateMeasurement(length)) return null;
  const axis = { x: dx / length, y: dy / length };
  const normal = { x: -axis.y, y: axis.x };
  const ends: { tick: Point; anchor: Point; station: number }[] = [];
  for (const item of chain) {
    const data = item.dimension;
    if (!data || data.shape || data.anchors?.length !== 2 || data.chainId !== first.dimension.chainId) return null;
    const ticks = [item.start, item.end];
    for (let i = 0; i < 2; i++) {
      const tick = ticks[i], anchor = data.anchors[i];
      if (!finite(tick) || !finite(anchor)) return null;
      // Reject malformed/non-collinear chains instead of changing their geometry.
      if (Math.abs(project(origin, tick, normal)) > 1e-6
        || Math.abs(project(tick, anchor, axis)) > 1e-6) return null;
      ends.push({ tick, anchor, station: project(origin, tick, axis) });
    }
  }
  ends.sort((a, b) => a.station - b.station);
  const low = ends[0], high = ends[ends.length - 1];
  const station = project(origin, point, axis);
  if (!Number.isFinite(station) || (station >= low.station && station <= high.station)) return null;
  const end = station < low.station ? low : high;
  const delta = station - end.station;
  const distance = Math.abs(delta);
  if (isDegenerateMeasurement(distance)) return null;
  const tick = { x: end.tick.x + axis.x * delta, y: end.tick.y + axis.y * delta };
  if (!finite(tick)) return null;
  return delta < 0
    ? { start: tick, end: end.tick, distance, anchors: [point, end.anchor] }
    : { start: end.tick, end: tick, distance, anchors: [end.anchor, point] };
}

export type DimensionChainMode = 'continue' | 'insert' | 'remove';

/** A local replacement: unaffected segments and their label overrides remain untouched. */
export interface DimensionChainEdit {
  removedIds: string[];
  segments: DimensionSegment[];
  reference: Point;
}

/** Insert a measured anchor inside one segment, or remove a shared interior
 * anchor. The tick line is fixed, including for oblique dimensions. */
export function editLinearDimensionChain(
  chain: readonly (DimensionSnapTarget & { id: string })[], point: Point,
  mode: Exclude<DimensionChainMode, 'continue'>, tolerance: number,
): DimensionChainEdit | null {
  const first = chain[0];
  const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!first?.dimension?.chainId || !finite(point) || !finite(first.start) || !finite(first.end)) return null;
  const origin = first.start;
  const dx = first.end.x - origin.x, dy = first.end.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || isDegenerateMeasurement(length)) return null;
  const axis = { x: dx / length, y: dy / length };
  const normal = { x: -axis.y, y: axis.x };
  const station = (p: Point) => project(origin, p, axis);
  const at = (s: number): Point => ({ x: origin.x + axis.x * s, y: origin.y + axis.y * s });
  const equal = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6;
  const intervals: { id: string; lo: number; hi: number; start: Point; end: Point; a: Point; b: Point }[] = [];
  const ids = new Set<string>();
  for (const item of chain) {
    const data = item.dimension;
    if (!data || data.shape || data.chainId !== first.dimension.chainId || data.anchors?.length !== 2
      || ids.has(item.id)) return null;
    ids.add(item.id);
    let [start, end] = [item.start, item.end];
    let [a, b] = data.anchors;
    if (![start, end, a, b].every(finite)) return null;
    if (station(start) > station(end)) { [start, end] = [end, start]; [a, b] = [b, a]; }
    const lo = station(start), hi = station(end);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || isDegenerateMeasurement(hi - lo)
      || Math.abs(project(origin, start, normal)) > 1e-6 || Math.abs(project(origin, end, normal)) > 1e-6
      || Math.abs(project(start, a, axis)) > 1e-6 || Math.abs(project(end, b, axis)) > 1e-6) return null;
    intervals.push({ id: item.id, lo, hi, start, end, a, b });
  }
  intervals.sort((a, b) => a.lo - b.lo);
  // Refuse ambiguous, overlapping or disconnected chains instead of guessing.
  for (let i = 1; i < intervals.length; i++) {
    if (!equal(intervals[i - 1].end, intervals[i].start) || !equal(intervals[i - 1].b, intervals[i].a)) return null;
  }
  if (mode === 'insert') {
    const s = station(point);
    const item = intervals.find(part => s > part.lo && s < part.hi
      && !isDegenerateMeasurement(s - part.lo) && !isDegenerateMeasurement(part.hi - s));
    if (!item) return null;
    const tick = at(s);
    if (!finite(tick)) return null;
    return { removedIds: [item.id], reference: point, segments: [
      { start: item.start, end: tick, distance: s - item.lo, anchors: [item.a, point] },
      { start: tick, end: item.end, distance: item.hi - s, anchors: [point, item.b] },
    ] };
  }
  if (mode !== 'remove' || !Number.isFinite(tolerance) || tolerance <= 0) return null;
  let best: DimensionChainEdit | null = null;
  let distance = tolerance;
  for (let i = 1; i < intervals.length; i++) {
    const left = intervals[i - 1], right = intervals[i];
    // Both the tick node and the actual measured anchor are selectable.
    const tickDistance = Math.hypot(point.x - left.end.x, point.y - left.end.y);
    const baseDistance = Math.hypot(point.x - left.b.x, point.y - left.b.y);
    const d = Math.min(tickDistance, baseDistance);
    if (d > distance || (best && d === distance)) continue;
    distance = d;
    best = { removedIds: [left.id, right.id], reference: tickDistance <= baseDistance ? left.end : left.b,
      segments: [{ start: left.start, end: right.end, distance: right.hi - left.lo, anchors: [left.a, right.b] }] };
  }
  return best;
}

export function snapDrawingAngle(anchor: Point, point: Point, baseAngle = 0, increment = 15): Point {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const radius = Math.hypot(dx, dy);
  if (!radius) return point;
  const step = increment * Math.PI / 180;
  const angle = baseAngle + Math.round((Math.atan2(dy, dx) - baseAngle) / step) * step;
  return { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius };
}

export function finishDimensionPoints(draft: DimensionDraft): DimensionDraft | null {
  return draft.placing || draft.points.length < 2 ? null : { ...draft, placing: true };
}

export function clickDimension(
  draft: DimensionDraft, type: DimensionType, point: Point, snapped: boolean, alignedAxis = draft.alignedAxis,
):
  { draft: DimensionDraft; segments: DimensionSegment[] } {
  if (draft.placing) {
    return { draft: EMPTY_DIMENSION_DRAFT, segments: dimensionSegments(draft.points, type, point, draft.angularSide, draft.alignedAxis) };
  }
  if (isCurvedDimension(type)) {
    if (type === 'angular' && draft.points.length === 3) {
      if (isDegenerateMeasurement(length(draft.points[0], point))) return { draft, segments: [] };
      return { draft: { ...draft, placing: true, angularSide: point }, segments: [] };
    }
    if (type !== 'angular' && !snapped) return { draft, segments: [] };
    if (draft.points.some(previous => isDegenerateMeasurement(length(previous, point)))) {
      return { draft, segments: [] };
    }
    const points = [...draft.points, point];
    if (points.length < 3) return { draft: { points, placing: false }, segments: [] };
    return curvedDimension(points, type)
      ? { draft: { points, placing: type !== 'angular' }, segments: [] }
      : { draft, segments: [] };
  }
  if (draft.points.length >= 2 && !snapped) {
    return { draft: finishDimensionPoints(draft) ?? draft, segments: [] };
  }
  const points = [...draft.points, point];
  if (points.length > 1 && dimensionSegments(points, type, undefined, undefined, alignedAxis).length < points.length - 1) {
    return { draft, segments: [] };
  }
  return { draft: { points, placing: false, alignedAxis }, segments: [] };
}
