/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MeshData } from '@ifc-lite/geometry';
import type { DrawingLine, DrawingPolygon, Point2D, Polygon2D, SectionPlaneConfig, Vec3 } from './types.js';
import { isFeatureElementType } from './feature-elements.js';
import { projectPointForPlane, signedDepth } from './projection-bands.js';
import { clipMeshToProjectionWindow } from './projection-clip.js';
import { vec3Add, vec3Cross, vec3Dot, vec3Normalize, vec3Scale, vec3Sub } from './math.js';
import { getVertex, type RasterVertex } from './raster-core.js';

const TOLERANCE = 1e-8;
type Box = { left: number; right: number; bottom: number; top: number };
type Face = {
  ring: Point2D[];
  box: Box;
  near: number;
  far: number;
  depth: (p: Point2D) => number;
  occludes?: boolean;
  source?: Omit<DrawingPolygon, 'polygon'>;
};

function side(a: Point2D, b: Point2D, p: Point2D): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function signedArea(ring: Point2D[]): number {
  let twiceArea = 0;
  for (let i = 2; i < ring.length; i++) twiceArea += side(ring[0], ring[i - 1], ring[i]);
  return twiceArea / 2;
}

function face(vertices: RasterVertex[], source?: Face['source']): Face | undefined {
  if (vertices.some(p => !p || ![p.x, p.y, p.depth].every(Number.isFinite))) return;
  vertices = vertices.filter((p, i) => {
    const next = vertices[(i + 1) % vertices.length];
    return p.x !== next.x || p.y !== next.y;
  });
  if (vertices.length < 3) return;
  const area = signedArea(vertices);
  if (Math.abs(area) <= TOLERANCE ** 2) return;
  if (area < 0) vertices.reverse();
  let edge = 0, longest = 0;
  for (let i = 0; source && i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (length > longest) { edge = i; longest = length; }
  }
  const a = vertices[edge], b = vertices[(edge + 1) % vertices.length];
  const c = source ? vertices.find(p => Math.abs(side(a, b, p)) > TOLERANCE ** 2) : vertices[2];
  if (!c) return;
  const det = side(a, b, c);
  const depth = source ? (p: Point2D) => a.depth
    + (side(a, p, c) * (b.depth - a.depth) + side(a, b, p) * (c.depth - a.depth)) / det
    : () => 0;
  return {
    ring: vertices.map(({ x, y }) => ({ x, y })),
    box: { left: Math.min(...vertices.map(p => p.x)), right: Math.max(...vertices.map(p => p.x)),
      bottom: Math.min(...vertices.map(p => p.y)), top: Math.max(...vertices.map(p => p.y)) },
    near: Math.min(...vertices.map(p => p.depth)), far: Math.max(...vertices.map(p => p.depth)),
    depth, source, occludes: !source || (source.sourceColor?.[3] ?? 1) >= 0.99,
  };
}

/** Split a convex ring into the two half-planes of a line. */
function split(ring: Point2D[], distance: (p: Point2D) => number): [Point2D[], Point2D[]] {
  const inside: Point2D[] = [], outside: Point2D[] = [];
  let a = ring[ring.length - 1], da = distance(a);
  for (const b of ring) {
    const db = distance(b);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      const intersection = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      inside.push(intersection);
      outside.push(intersection);
    }
    if (db >= 0) inside.push(b);
    if (db <= 0) outside.push(b);
    a = b; da = db;
  }
  return [inside, outside];
}

function subtract(ring: Point2D[], occluder: Point2D[]): Point2D[][] {
  const original = ring;
  const pieces: Point2D[][] = [];
  for (let i = 0; i < occluder.length && ring.length >= 3; i++) {
    const a = occluder[i], b = occluder[(i + 1) % occluder.length];
    const [inside, outside] = split(ring, p => side(a, b, p));
    if (signedArea(outside) > TOLERANCE ** 2) pieces.push(outside);
    ring = inside;
  }
  return signedArea(ring) > TOLERANCE ** 2 ? pieces : [original];
}

/** A cut polygon can be concave or contain holes. Decompose its even-odd
 * interior into convex trapezoids at the vertex heights. */
function capFaces({ outer, holes }: Polygon2D): Face[] {
  const rings = [outer, ...holes];
  const ys = [...new Set(rings.flatMap(ring => ring.map(p => p.y)))].sort((a, b) => a - b);
  const edges = rings.flatMap(ring => ring.flatMap((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return a.y === b.y ? [] : [{ a, b }];
  }));
  const faces: Face[] = [];
  const xAt = ({ a, b }: typeof edges[number], y: number) => a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
  for (let i = 1; i < ys.length; i++) {
    const low = ys[i - 1], high = ys[i], mid = low + (high - low) / 2;
    const active = edges.filter(({ a, b }) => mid > Math.min(a.y, b.y) && mid < Math.max(a.y, b.y));
    active.sort((a, b) => xAt(a, mid) - xAt(b, mid));
    for (let j = 1; j < active.length; j += 2) {
      const a = active[j - 1], b = active[j];
      const vertices = [{ x: xAt(a, low), y: low }, { x: xAt(b, low), y: low },
        { x: xAt(b, high), y: high }, { x: xAt(a, high), y: high }];
      const item = face(vertices.filter((p, k) => p.x !== vertices[(k + 1) % 4].x || p.y !== vertices[(k + 1) % 4].y)
        .map(p => ({ ...p, depth: 0 })));
      if (item) faces.push(item);
    }
  }
  return faces;
}

export interface ProjectionCap {
  polygon: DrawingPolygon;
  basis: NonNullable<SectionPlaneConfig['customPlane']>;
  clips: readonly { normal: Vec3; offset: number }[];
}

function projectedCapFaces(cap: ProjectionCap, plane: SectionPlaneConfig): Face[] {
  const { origin, tangent, bitangent } = cap.basis;
  const lift = ({ x, y }: Point2D) => vec3Add(origin, vec3Add(vec3Scale(tangent, x), vec3Scale(bitangent, y)));
  const p = projectPointForPlane(origin, plane);
  const u = projectPointForPlane(vec3Add(origin, tangent), plane);
  const v = projectPointForPlane(vec3Add(origin, bitangent), plane);
  const ux = u.x - p.x, uy = u.y - p.y, vx = v.x - p.x, vy = v.y - p.y;
  const det = ux * vy - uy * vx;
  if (Math.abs(det) <= TOLERANCE) return [];
  const a = vy / det, b = -uy / det, c = -vx / det, d = ux / det;
  const { polygon, ...source } = cap.polygon;
  return capFaces(polygon).flatMap(({ ring }) => {
    for (const { normal, offset } of cap.clips) {
      ring = split(ring, point => offset - vec3Dot(lift(point), normal))[0];
      if (ring.length < 3) return [];
    }
    const item = face(ring.map(point => {
      const world = lift(point);
      return { ...projectPointForPlane(world, plane), depth: -signedDepth(world, plane) };
    }), { ...source, cutOutline: [], surfacePatternTransform: [a, b, c, d, -a * p.x - c * p.y, -b * p.x - d * p.y] });
    if (item) item.occludes = true;
    return item ? [item] : [];
  });
}

function meshFaces(mesh: MeshData, plane: SectionPlaneConfig, maxDepth: number): Face[] {
  const clipped = clipMeshToProjectionWindow(mesh, plane, 0, maxDepth);
  if (!clipped) return [];
  const source = { entityId: mesh.expressId, ifcType: mesh.ifcType ?? 'Unknown', modelIndex: mesh.modelIndex ?? 0,
    isCut: false, materialId: mesh.materialId, sourceColor: mesh.color };
  const { positions, indices, origin } = clipped;
  const world = [];
  const projected: RasterVertex[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const p = getVertex(positions, i, origin);
    world.push(p);
    projected.push({ ...projectPointForPlane(p, plane), depth: Math.max(0, -signedDepth(p, plane)) });
  }
  const faces: Face[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const [i0, i1, i2] = [indices[i], indices[i + 1], indices[i + 2]];
    const item = face([projected[i0], projected[i1], projected[i2]], source);
    if (!item) continue;

    // Use the same world-oriented tangent frame as the 3D surface shader.
    const p = world[i0];
    const n = vec3Normalize(vec3Cross(vec3Sub(world[i1], p), vec3Sub(world[i2], p)));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const horizontal = ay + 1e-5 >= Math.max(ax, az);
    const alongZ = !horizontal && ax > az + 1e-5;
    const axisU = alongZ ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
    const axisV = horizontal ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const component = vec3Dot(axisU, n);
    const u = vec3Normalize(vec3Sub(axisU, { x: n.x * component, y: n.y * component, z: n.z * component }));
    const perpendicular = vec3Cross(n, u);
    const sign = vec3Dot(perpendicular, axisV) < 0 ? -1 : 1;
    const v = { x: perpendicular.x * sign, y: perpendicular.y * sign, z: perpendicular.z * sign };

    const origin = projected[i0];
    const projectedU = projectPointForPlane({ x: p.x + u.x, y: p.y + u.y, z: p.z + u.z }, plane);
    const projectedV = projectPointForPlane({ x: p.x + v.x, y: p.y + v.y, z: p.z + v.z }, plane);
    const ux = projectedU.x - origin.x, uy = projectedU.y - origin.y;
    const vx = projectedV.x - origin.x, vy = projectedV.y - origin.y;
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < TOLERANCE) {
      faces.push(item);
      continue;
    }
    const a = vy / det, b = -uy / det, c = -vx / det, d = ux / det;
    item.source = { ...source, surfacePatternTransform: [
      a, b, c, d, vec3Dot(p, u) - a * origin.x - c * origin.y, vec3Dot(p, v) - b * origin.x - d * origin.y,
    ] };
    faces.push(item);
  }
  return faces;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
}

/** Clip a projected line against convex face footprints and affine depth.
 * Merge the occluded intervals before emitting visible and hidden pieces. */
function classifyLine(line: DrawingLine, faces: Iterable<Face>): DrawingLine[] {
  const { start, end } = line.line;
  const z0 = line.depth, z1 = line.depthEnd ?? z0;
  const intervals: [number, number][] = [];
  for (const face of faces) {
    if (!face.occludes || face.near >= Math.max(z0, z1) - 1e-5) continue;
    let lo = 0, hi = 1;
    const clip = (a: number, b: number) => {
      if (a < 0 && b < 0) return false;
      if (a < 0) lo = Math.max(lo, a / (a - b));
      if (b < 0) hi = Math.min(hi, a / (a - b));
      return hi > lo;
    };
    if (!clip(z0 - face.depth(start) - 1e-5, z1 - face.depth(end) - 1e-5)) continue;
    if (!face.ring.every((a, i) => {
      const b = face.ring[(i + 1) % face.ring.length];
      return clip(side(a, b, start), side(a, b, end));
    })) continue;
    intervals.push([lo, hi]);
  }
  if (!intervals.length) return [line];

  const out: DrawingLine[] = [];
  const point = (t: number) => ({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  const minSpan = 1e-5 / Math.hypot(end.x - start.x, end.y - start.y);
  const emit = (a: number, b: number, visibility: DrawingLine['visibility']) => {
    if (b - a > minSpan) {
      out.push({ ...line, line: { start: point(a), end: point(b) }, visibility,
        depth: z0 + (z1 - z0) * a, depthEnd: z0 + (z1 - z0) * b });
    }
  };
  let from = 0;
  let hiddenStart = 0, hiddenEnd = 0;
  for (const [lo, hi] of intervals.sort((a, b) => a[0] - b[0])) {
    if (lo > hiddenEnd + minSpan) {
      emit(from, hiddenStart, 'visible');
      emit(hiddenStart, hiddenEnd, 'hidden');
      from = hiddenEnd;
      hiddenStart = lo;
    }
    hiddenEnd = Math.max(hiddenEnd, hi);
  }
  emit(from, hiddenStart, 'visible');
  emit(hiddenStart, hiddenEnd, 'hidden');
  emit(hiddenEnd, 1, 'visible');
  return out;
}

/** Visible convex pieces of the projected faces. Occlusion is computed in
 * drawing coordinates using the two triangles' affine depths, so crossing
 * slopes are split where their depth order changes. */
export function buildProjectionPolygons(
  meshes: readonly MeshData[], caps: readonly DrawingPolygon[], plane: SectionPlaneConfig, maxDepth: number,
  worldCaps: readonly ProjectionCap[] = [],
  includeFace?: (source: NonNullable<Face['source']>) => boolean,
  linework?: { input: readonly DrawingLine[]; output: DrawingLine[] },
): DrawingPolygon[] {
  const faces = [...caps.flatMap(cap => capFaces(cap.polygon)), ...worldCaps.flatMap(cap => projectedCapFaces(cap, plane))];
  for (const mesh of meshes) {
    if (!isFeatureElementType(mesh.ifcType)) {
      for (const item of meshFaces(mesh, plane, maxDepth)) faces.push(item);
    }
  }
  if (!faces.length) {
    if (linework) for (const line of linework.input) linework.output.push(line);
    return [];
  }
  // Near occluders first so fully hidden triangles can stop early. Stable
  // ordering keeps the cut caps first when a mesh face lies on the cut plane.
  faces.sort((a, b) => a.near - b.near);

  // Bin the faces by their projected bounds so separated parts of a building
  // do not participate in one another's depth tests.
  const bounds = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
  for (const { box } of faces) {
    bounds.left = Math.min(bounds.left, box.left); bounds.right = Math.max(bounds.right, box.right);
    bounds.bottom = Math.min(bounds.bottom, box.bottom); bounds.top = Math.max(bounds.top, box.top);
  }
  const cellsPerSide = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(faces.length / 8))));
  const step = Math.max(bounds.right - bounds.left, bounds.top - bounds.bottom) / cellsPerSide;
  const cell = (value: number, base: number) => Math.max(0, Math.min(cellsPerSide - 1, Math.floor((value - base) / step)));
  function* cells(box: Box) {
    for (let y = cell(box.bottom, bounds.bottom); y <= cell(box.top, bounds.bottom); y++) {
      for (let x = cell(box.left, bounds.left); x <= cell(box.right, bounds.left); x++) yield y * cellsPerSide + x;
    }
  }
  const bins: number[][] = Array.from({ length: cellsPerSide ** 2 }, () => []);
  faces.forEach(({ box }, i) => { for (const key of cells(box)) bins[key].push(i); });

  function nearbyFaces(box: Box): Set<number> {
    const nearby = new Set<number>();
    for (const key of cells(box)) for (const i of bins[key]) nearby.add(i);
    return nearby;
  }
  if (linework) {
    for (const line of linework.input) {
      const { start, end } = line.line;
      const box = { left: Math.min(start.x, end.x), right: Math.max(start.x, end.x),
        bottom: Math.min(start.y, end.y), top: Math.max(start.y, end.y) };
      for (const piece of classifyLine(line, Array.from(nearbyFaces(box), i => faces[i]))) linework.output.push(piece);
    }
  }

  const polygons: DrawingPolygon[] = [];
  faces.forEach((target, index) => {
    if (!target.source || (includeFace && !includeFace(target.source))) return;
    let visible = [target.ring];
    for (const i of nearbyFaces(target.box)) {
      if (i === index) continue;
      const other = faces[i];
      if (!other.occludes && (other.source?.entityId !== target.source?.entityId || other.source?.modelIndex !== target.source?.modelIndex)) continue;
      if (other.near > target.far + TOLERANCE || !overlaps(target.box, other.box)) continue;
      const bias = i < index ? TOLERANCE : -TOLERANCE;
      const nearer = other.far < target.near - TOLERANCE ? other.ring
        : split(other.ring, p => target.depth(p) - other.depth(p) + bias)[0];
      if (signedArea(nearer) <= TOLERANCE ** 2) continue;
      visible = visible.flatMap(ring => subtract(ring, nearer));
      if (!visible.length) break;
    }
    for (const outer of visible) polygons.push({ ...target.source, polygon: { outer, holes: [] }, vertexDepths: outer.map(target.depth) });
  });
  return polygons.reverse();
}
