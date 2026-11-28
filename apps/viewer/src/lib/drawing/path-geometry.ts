/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Authored 2D geometry in drawing-space metres. A bulge is tan(signed sweep/4),
 * as in the DXF reader; positive is CCW in drawing coordinates (not screen).
 * Only vertices are authoritative. Sampling is a derived render/export aid. */
export type PathPoint = { x: number; y: number };
export type PathVertex = PathPoint & { bulge?: number };
export type DrawingPath = { vertices: readonly PathVertex[]; closed: boolean };
export type PathArc = { center: PathPoint; radius: number; startAngle: number; sweep: number };
export type PathEdge = { start: PathPoint; end: PathPoint; arc: PathArc | null };

const EPS = 1e-7; // same adjacent-edge tolerance as the area vertex editor
const TAU = 2 * Math.PI;
const MIN_BULGE = 1e-8;
const MAX_BULGE = 1e6; // a full circle uses two semicircles, never a singular sweep
const MAX_SAMPLES = 100_000;
const finite = (p: PathPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const sub = (a: PathPoint, b: PathPoint): PathPoint => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: PathPoint, b: PathPoint): PathPoint => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: PathPoint, k: number): PathPoint => ({ x: a.x * k, y: a.y * k });
const cross = (a: PathPoint, b: PathPoint) => a.x * b.y - a.y * b.x;
const dot = (a: PathPoint, b: PathPoint) => a.x * b.x + a.y * b.y;
const distance = (a: PathPoint, b: PathPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const bulgeOf = (v: PathVertex) => Math.abs(v.bulge ?? 0) < MIN_BULGE ? 0 : v.bulge ?? 0;

/** Legacy areas are simple closed straight paths; no store migration needed. */
export function pathFromPolygon(points: readonly PathPoint[]): DrawingPath {
  return { closed: true, vertices: points.map(({ x, y }) => ({ x, y })) };
}

export function arcFromBulge(a: PathPoint, b: PathPoint, bulge: number): PathArc | null {
  const chord = distance(a, b);
  if (!finite(a) || !finite(b) || !Number.isFinite(chord) || chord < EPS
    || !Number.isFinite(bulge) || Math.abs(bulge) < MIN_BULGE || Math.abs(bulge) > MAX_BULGE) return null;
  const d = sub(b, a);
  const h = chord * (1 / bulge - bulge) / 4;
  const center = add(add(a, mul(d, 0.5)), { x: -d.y / chord * h, y: d.x / chord * h });
  const radius = Math.hypot(chord / 2, h);
  return finite(center) && Number.isFinite(radius)
    ? { center, radius, startAngle: Math.atan2(a.y - center.y, a.x - center.x), sweep: 4 * Math.atan(bulge) }
    : null;
}

/** Returns null for malformed or collapsed paths. Topology is separate: an
 * open path may cross itself, but a filled/measured boundary must not. */
export function pathEdges(path: DrawingPath): PathEdge[] | null {
  const { vertices, closed } = path;
  if (typeof closed !== 'boolean' || !Array.isArray(vertices) || vertices.length < 2) return null;
  if (vertices.some(v => !v || !finite(v) || (v.bulge !== undefined &&
    (!Number.isFinite(v.bulge) || Math.abs(v.bulge) > MAX_BULGE)))) return null;
  if (!closed && bulgeOf(vertices[vertices.length - 1])) return null;
  const edges: PathEdge[] = [];
  for (let i = 0; i < vertices.length - (closed ? 0 : 1); i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const chord = distance(a, b), bulge = bulgeOf(a);
    if (!Number.isFinite(chord) || chord < EPS) return null;
    const arc = bulge ? arcFromBulge(a, b, bulge) : null;
    if (bulge && !arc) return null;
    edges.push({ start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, arc });
  }
  return edges;
}

export function pointOnEdge(edge: PathEdge, t: number): PathPoint {
  if (t <= 0) return { ...edge.start };
  if (t >= 1) return { ...edge.end };
  if (!edge.arc) return add(edge.start, mul(sub(edge.end, edge.start), t));
  const { center, radius, startAngle, sweep } = edge.arc;
  const angle = startAngle + sweep * t;
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

/** Chord plus exact circular-segment contributions (Green's theorem). Use a
 * local origin to avoid catastrophic cancellation at federated coordinates. */
export function pathMetrics(path: DrawingPath): { length: number; area: number; signedArea: number; centroid: PathPoint | null } | null {
  const edges = pathEdges(path);
  if (!edges) return null;
  const origin = edges[0].start;
  let length = 0, area = 0, mx = 0, my = 0;
  for (const edge of edges) {
    const a = sub(edge.start, origin), b = sub(edge.end, origin), d = sub(b, a);
    const chord = Math.hypot(d.x, d.y);
    const arc = edge.arc;
    length += arc ? arc.radius * Math.abs(arc.sweep) : chord;
    if (!path.closed) continue;
    const triangle = cross(a, b) / 2;
    area += triangle;
    mx += triangle * (a.x + b.x) / 3;
    my += triangle * (a.y + b.y) / 3;
    if (!arc) continue;
    const t = arc.sweep, t2 = t * t;
    // Stable series when subtracting sin(t) or nearly equal centroid terms.
    const delta = Math.abs(t) < 0.01 ? t * t2 / 6 * (1 - t2 / 20 + t2 * t2 / 840) : t - Math.sin(t);
    const segment = arc.radius * arc.radius * delta / 2;
    const shift = Math.abs(t) < 0.01 ? arc.radius * t2 * (1 / 20 - t2 * 13 / 16800)
      : arc.radius * (4 * Math.sin(t / 2) ** 3 / (3 * delta) - Math.cos(t / 2));
    const mid = add(mul(add(a, b), 0.5), mul({ x: d.y / chord, y: -d.x / chord }, Math.sign(t) * shift));
    area += segment;
    mx += segment * mid.x;
    my += segment * mid.y;
  }
  if (![length, area, mx, my].every(Number.isFinite)) return null;
  const centroid = path.closed && Math.abs(area) > 1e-8 ? add(origin, { x: mx / area, y: my / area }) : null;
  if (centroid && !finite(centroid)) return null;
  return { length, area: Math.abs(area), signedArea: area, centroid };
}

/** Explicit chord-error tolerance (metres), not zoom-dependent stored geometry.
 * Refuse rather than silently violate tolerance or allocate unbounded arrays. */
export function samplePath(path: DrawingPath, tolerance: number): PathPoint[] | null {
  const edges = pathEdges(path);
  if (!edges || !Number.isFinite(tolerance) || tolerance <= 0) return null;
  const points = [{ ...edges[0].start }];
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const step = edge.arc ? Math.min(Math.PI / 2, 4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * edge.arc.radius))))) : 1;
    const count = edge.arc ? Math.max(1, Math.ceil(Math.abs(edge.arc.sweep) / step)) : 1;
    if (!Number.isFinite(count) || points.length + count > MAX_SAMPLES) return null;
    for (let j = 1; j <= count; j++) {
      if (path.closed && i === edges.length - 1 && j === count) break;
      points.push(pointOnEdge(edge, j / count));
    }
  }
  return points.every(finite) ? points : null;
}

export function circlePath(center: PathPoint, radius: number): DrawingPath | null {
  if (!finite(center) || !Number.isFinite(radius) || radius < EPS) return null;
  const path: DrawingPath = { closed: true, vertices: [
    { x: center.x + radius, y: center.y, bulge: 1 },
    { x: center.x - radius, y: center.y, bulge: 1 },
  ] };
  return pathEdges(path) ? path : null;
}

export function rectanglePath(a: PathPoint, b: PathPoint): DrawingPath | null {
  const path = pathFromPolygon([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]);
  return pathEdges(path) ? path : null;
}

/** Three picked points: start, a point on the arc, end. The inscribed angle
 * determines the sweep including major arcs, with no second stored centre. */
export function threePointArcPath(start: PathPoint, through: PathPoint, end: PathPoint): DrawingPath | null {
  if (![start, through, end].every(finite)) return null;
  const a = sub(start, through), b = sub(end, through);
  const da = Math.hypot(a.x, a.y), db = Math.hypot(b.x, b.y);
  if (da < EPS || db < EPS || !Number.isFinite(da + db)) return null;
  const u = mul(a, 1 / da), v = mul(b, 1 / db), c = cross(u, v);
  if (Math.abs(c) < 1e-8) return null;
  const sweep = -Math.sign(c) * 2 * Math.atan2(Math.abs(c), -dot(u, v));
  const path: DrawingPath = { closed: false, vertices: [{ ...start, bulge: Math.tan(sweep / 4) }, { ...end }] };
  return pathEdges(path) ? path : null;
}

/** Independent, immutable move; arc bulges do not change under translation. */
export function translatePath(path: DrawingPath, delta: PathPoint): DrawingPath | null {
  if (!finite(delta) || !pathEdges(path)) return null;
  const next = { closed: path.closed, vertices: path.vertices.map(v => ({ ...v, x: v.x + delta.x, y: v.y + delta.y })) };
  return pathEdges(next) ? next : null;
}

/** Analytic edge membership. Both endpoints are included. */
function onArc(edge: PathEdge, p: PathPoint): boolean {
  const arc = edge.arc;
  if (!arc) return false;
  if (distance(p, edge.start) <= EPS || distance(p, edge.end) <= EPS) return true;
  if (Math.abs(distance(p, arc.center) - arc.radius) > EPS) return false;
  const angle = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  const turn = wrap(Math.sign(arc.sweep) * (angle - arc.startAngle));
  return turn <= Math.abs(arc.sweep) + EPS / arc.radius;
}
function onLine(edge: PathEdge, p: PathPoint): boolean {
  const d = sub(edge.end, edge.start), v = sub(p, edge.start), len = Math.hypot(d.x, d.y);
  const t = dot(v, d) / len;
  return Math.abs(cross(d, v)) / len <= EPS && t >= -EPS && t <= len + EPS;
}

/** Candidate intersections of the infinite supporting lines/circles, clipped
 * to both finite edges. Collinear/coincident overlaps are caught by endpoints
 * and midpoint membership. No tessellated chord is used for validation. */
function intersections(a: PathEdge, b: PathEdge): PathPoint[] {
  const contains = (edge: PathEdge, p: PathPoint) => edge.arc ? onArc(edge, p) : onLine(edge, p);
  const candidates = [a.start, a.end, b.start, b.end, pointOnEdge(a, 0.5), pointOnEdge(b, 0.5)];
  if (!a.arc && !b.arc) {
    const u = sub(a.end, a.start), v = sub(b.end, b.start), det = cross(u, v);
    if (det !== 0) candidates.push(add(a.start, mul(u, cross(sub(b.start, a.start), v) / det)));
  } else if (a.arc && b.arc) {
    const d = sub(b.arc.center, a.arc.center), len = Math.hypot(d.x, d.y), r = a.arc.radius, s = b.arc.radius;
    if (len > EPS && len <= r + s + EPS && len >= Math.abs(r - s) - EPS) {
      const x = ((r - s) * (r + s) + len * len) / (2 * len);
      const h2 = (r - x) * (r + x);
      if (h2 >= -EPS * Math.max(r, s)) {
        const center = add(a.arc.center, mul(d, x / len)), h = Math.sqrt(Math.max(0, h2));
        const offset = mul({ x: -d.y / len, y: d.x / len }, h);
        candidates.push(add(center, offset), sub(center, offset));
      }
    }
  } else {
    const line = a.arc ? b : a, arc = (a.arc ?? b.arc)!;
    const d = sub(line.end, line.start), len = Math.hypot(d.x, d.y), u = mul(d, 1 / len);
    const from = sub(arc.center, line.start), along = dot(from, u), away = Math.abs(cross(u, from));
    const h2 = (arc.radius - away) * (arc.radius + away);
    if (h2 >= -EPS * arc.radius) {
      const h = Math.sqrt(Math.max(0, h2));
      candidates.push(add(line.start, mul(u, along + h)), add(line.start, mul(u, along - h)));
    }
  }
  return candidates.filter(p => finite(p) && contains(a, p) && contains(b, p));
}

/** Closed, nondegenerate, non-self-touching boundary. Adjacent edges may
 * meet only at their common vertex. Two arcs can form a valid full circle. */
export function isSimpleBoundary(path: DrawingPath): boolean {
  const edges = path.closed ? pathEdges(path) : null;
  const metrics = edges && pathMetrics(path);
  if (!edges || !metrics || metrics.area <= 1e-8) return false;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      const shared = [...(j === i + 1 ? [a.end] : []), ...(i === 0 && j === edges.length - 1 ? [a.start] : [])];
      // Coincident arcs/lines that share both endpoints are only valid when
      // their interiors are disjoint (e.g. the two halves of a circle).
      if (intersections(a, b).some(p => !shared.some(q => distance(p, q) <= EPS))) return false;
    }
  }
  return true;
}
