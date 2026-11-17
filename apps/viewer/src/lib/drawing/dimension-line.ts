/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isDegenerateMeasurement } from '../../store/slices/drawing2DDegenerateGuards';

interface Point {
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

export function dimensionSegments(points: readonly Point[], type: DimensionType, offsetPoint?: Point, angularSide?: Point): DimensionSegment[] {
  if (isCurvedDimension(type)) {
    const segment = curvedDimension(points, type, offsetPoint, angularSide);
    return segment ? [segment] : [];
  }
  if (points.length < 2) return [];
  const origin = points[0];
  const axis = dimensionAxis(type, origin, points[1]);
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

export function snapDrawingAngle(anchor: Point, point: Point, baseAngle = 0): Point {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const radius = Math.hypot(dx, dy);
  if (!radius) return point;
  const step = Math.PI / 12;
  const angle = baseAngle + Math.round((Math.atan2(dy, dx) - baseAngle) / step) * step;
  return { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius };
}

export function finishDimensionPoints(draft: DimensionDraft): DimensionDraft | null {
  return draft.placing || draft.points.length < 2 ? null : { ...draft, placing: true };
}

export function clickDimension(draft: DimensionDraft, type: DimensionType, point: Point, snapped: boolean):
  { draft: DimensionDraft; segments: DimensionSegment[] } {
  if (draft.placing) {
    return { draft: EMPTY_DIMENSION_DRAFT, segments: dimensionSegments(draft.points, type, point, draft.angularSide) };
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
  if (points.length > 1 && dimensionSegments(points, type).length < points.length - 1) {
    return { draft, segments: [] };
  }
  return { draft: { points, placing: false }, segments: [] };
}
