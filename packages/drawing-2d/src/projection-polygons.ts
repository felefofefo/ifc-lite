/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MeshData } from '@ifc-lite/geometry';
import type { DrawingPolygon, Point2D, Polygon2D, SectionPlaneConfig } from './types.js';
import { isFeatureElementType } from './feature-elements.js';
import { projectPointForPlane, signedDepth } from './projection-bands.js';
import { clipMeshToProjectionWindow } from './projection-clip.js';
import { vec3Cross, vec3Dot, vec3Normalize, vec3Sub } from './math.js';
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
  const area = signedArea(vertices);
  if (Math.abs(area) <= TOLERANCE ** 2) return;
  if (area < 0) vertices.reverse();
  const [a, b, c] = vertices;
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

/** Visible convex pieces of the projected faces. Occlusion is computed in
 * drawing coordinates using the two triangles' affine depths, so crossing
 * slopes are split where their depth order changes. */
export function buildProjectionPolygons(
  meshes: readonly MeshData[], caps: readonly DrawingPolygon[], plane: SectionPlaneConfig, maxDepth: number,
): DrawingPolygon[] {
  const faces = caps.flatMap(cap => capFaces(cap.polygon));
  for (const mesh of meshes) {
    if (!isFeatureElementType(mesh.ifcType)) {
      for (const item of meshFaces(mesh, plane, maxDepth)) faces.push(item);
    }
  }
  if (!faces.length) return [];
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
  const cell = (value: number, base: number) => Math.min(cellsPerSide - 1, Math.floor((value - base) / step));
  function* cells(box: Box) {
    for (let y = cell(box.bottom, bounds.bottom); y <= cell(box.top, bounds.bottom); y++) {
      for (let x = cell(box.left, bounds.left); x <= cell(box.right, bounds.left); x++) yield y * cellsPerSide + x;
    }
  }
  const bins: number[][] = Array.from({ length: cellsPerSide ** 2 }, () => []);
  faces.forEach(({ box }, i) => { for (const key of cells(box)) bins[key].push(i); });

  const polygons: DrawingPolygon[] = [];
  faces.forEach((target, index) => {
    if (!target.source) return;
    const nearby = new Set<number>();
    for (const key of cells(target.box)) for (const i of bins[key]) nearby.add(i);
    let visible = [target.ring];
    for (const i of nearby) {
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
