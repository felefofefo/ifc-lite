/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Read-only plan footprints for IFC spaces. No IFC geometry is modified. */
import type { Point2D, Polygon2D, SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { MeshOutlineInput, MeshOutlineProvider } from '@/hooks/meshOutlineProvider';

export interface DrawingIfcSpaceRoom {
  /** Renderer/federation ID, also used by the existing IFC Tag resolver. */
  id: number;
  contours: Point2D[][];
  polygons: Polygon2D[];
}

type SpaceMesh = MeshOutlineInput & { expressId: number; ifcType?: string };

function ringArea(ring: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length];
    sum += ring[i].x * next.y - next.x * ring[i].y;
  }
  return Math.abs(sum) / 2;
}

function inside(point: Point2D, ring: readonly Point2D[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Convert nested outline rings into outers/holes, including islands in holes. */
export function roomContourPolygons(contours: readonly Point2D[][]): Polygon2D[] {
  const sorted = contours.map(ring => ({ ring, area: ringArea(ring) }))
    .filter(item => item.ring.length >= 3 && item.area > 1e-8)
    .sort((a, b) => b.area - a.area);
  const depth: number[] = [];
  const polygonFor: Array<Polygon2D | undefined> = [];
  const polygons: Polygon2D[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let enclosing = -1;
    // Reverse search finds the smallest enclosing ring (direct parent).
    for (let j = i - 1; j >= 0; j--) {
      if (inside(sorted[i].ring[0], sorted[j].ring)) { enclosing = j; break; }
    }
    depth[i] = enclosing < 0 ? 0 : depth[enclosing] + 1;
    if (depth[i] % 2 === 0) {
      const polygon: Polygon2D = { outer: sorted[i].ring, holes: [] };
      polygons.push(polygon);
      polygonFor[i] = polygon;
    } else {
      polygonFor[i] = polygonFor[enclosing];
      polygonFor[i]?.holes.push(sorted[i].ring);
    }
  }
  return polygons;
}

/**
 * Detect only spaces whose volume intersects the plan cut height. The existing
 * winding-robust mesh-outline provider supplies exact projected footprints;
 * if the WASM binding/geometry is absent we do not invent rectangular rooms.
 * Room contours are independent of 3D class visibility, so hidden IfcSpace
 * meshes remain available for IFC Tags.
 */
export function readIfcSpaceRooms(
  meshes: readonly SpaceMesh[],
  plane: SectionPlaneConfig,
  outline: MeshOutlineProvider | undefined,
): DrawingIfcSpaceRoom[] {
  if (plane.axis !== 'y' || plane.customPlane || !outline) return [];
  const rooms = new Map<number, DrawingIfcSpaceRoom>();
  for (const mesh of meshes) {
    if (mesh.ifcType?.toLowerCase() !== 'ifcspace' || !(mesh.expressId > 0)) continue;
    const footprint = outline(mesh, 'y', plane.flipped);
    if (!footprint || plane.position < footprint.axisMin - 0.01 || plane.position > footprint.axisMax + 0.01) continue;
    const rings: Point2D[][] = [];
    for (const raw of footprint.contours) {
      if (raw.length < 6 || raw.length > 40000 || raw.length % 2 !== 0) continue;
      const ring: Point2D[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        if (!Number.isFinite(raw[i]) || !Number.isFinite(raw[i + 1])) { ring.length = 0; break; }
        ring.push({ x: raw[i], y: raw[i + 1] });
      }
      if (ring.length > 3 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y) ring.pop();
      if (ring.length >= 3 && ringArea(ring) > 1e-8) rings.push(ring);
    }
    if (!rings.length) continue;
    const room = rooms.get(mesh.expressId) ?? { id: mesh.expressId, contours: [], polygons: [] };
    room.contours.push(...rings);
    rooms.set(mesh.expressId, room);
  }
  // Federation/model mesh fragments can repeat the same surface outline.
  // Without de-duplication a duplicate outer ring looks like a false hole.
  for (const room of rooms.values()) {
    const keys = new Set<string>();
    room.contours = room.contours.filter(ring => {
      const key = ring.map(p => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).sort().join(';');
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    room.polygons = roomContourPolygons(room.contours);
  }
  return [...rooms.values()].filter(room => room.polygons.length > 0);
}
