/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { projectPointForPlane, type Drawing2D, type Point2D, type SectionPlaneConfig, type Vec3 } from '@ifc-lite/drawing-2d';
import type { DrawingElementTag } from './drawing-element-tags';

export interface ProjectGrid {
  id: string;
  templateId: string;
  name: string;
  appearanceId?: string;
  start: Vec3;
  end: Vec3;
}

/** Graphic height limits in a particular vertical view (not model geometry). */
export interface GridViewExtents { start: number; end: number }

export function validGridViewExtents(value: unknown): value is GridViewExtents {
  if (!value || typeof value !== 'object') return false;
  const { start, end } = value as Partial<GridViewExtents>;
  return Number.isFinite(start) && Number.isFinite(end) && (end as number) - (start as number) > 1e-8;
}

export function readProjectGrids(value: unknown): ProjectGrid[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((grid): grid is ProjectGrid => {
    const point = (p: unknown): p is Vec3 => !!p && typeof p === 'object'
      && ['x', 'y', 'z'].every(key => Number.isFinite(Reflect.get(p, key)));
    if (!grid || typeof grid.id !== 'string' || seen.has(grid.id) || typeof grid.name !== 'string'
      || typeof grid.templateId !== 'string' || !point(grid.start) || !point(grid.end)
      || Math.hypot(grid.end.x - grid.start.x, grid.end.z - grid.start.z) < 1e-8) return false;
    seen.add(grid.id);
    return true;
  });
}

export function gridFromPlan(tag: DrawingElementTag, plane: SectionPlaneConfig): ProjectGrid | undefined {
  if (plane.axis !== 'y' || plane.customPlane || !tag.gridStart || !tag.templateId) return;
  const world = (p: Point2D) => ({ x: plane.flipped ? -p.x : p.x, y: plane.position, z: p.y });
  return { id: tag.id, templateId: tag.templateId, name: tag.field, appearanceId: tag.appearanceId,
    start: world(tag.gridStart), end: world(tag.position) };
}

/** Translate the common grid datum in the model's XZ plane. */
export function moveProjectGrid(grid: ProjectGrid, plane: SectionPlaneConfig, delta: Point2D): ProjectGrid {
  const shift = plane.axis === 'y' && !plane.customPlane
    ? { x: plane.flipped ? -delta.x : delta.x, z: delta.y }
    : { x: (plane.customPlane?.tangent.x ?? (plane.axis === 'x' ? 0 : plane.flipped ? -1 : 1)) * delta.x,
        z: (plane.customPlane?.tangent.z ?? (plane.axis === 'x' ? plane.flipped ? -1 : 1 : 0)) * delta.x };
  const move = (p: Vec3): Vec3 => ({ ...p, x: p.x + shift.x, z: p.z + shift.z });
  return { ...grid, start: move(grid.start), end: move(grid.end) };
}

export function projectGrid(grid: ProjectGrid, drawing: Drawing2D, extents?: GridViewExtents): DrawingElementTag | undefined {
  const plane = drawing.config.plane;
  let start: Point2D, end: Point2D;
  if (plane.axis === 'y' && !plane.customPlane) {
    start = projectPointForPlane(grid.start, plane);
    end = projectPointForPlane(grid.end, plane);
  } else {
    const normal = plane.customPlane?.normal ?? (plane.axis === 'x' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 });
    if (Math.abs(normal.y) > 1e-6) return;
    const offset = plane.customPlane?.distance ?? plane.position;
    const dx = grid.end.x - grid.start.x, dz = grid.end.z - grid.start.z;
    const denominator = normal.x * dx + normal.z * dz;
    if (Math.abs(denominator) < 1e-8) return;
    // A grid defines an infinite vertical datum plane. Its plan extents locate its markers.
    const t = (offset - normal.x * grid.start.x - normal.z * grid.start.z) / denominator;
    const point = projectPointForPlane({ x: grid.start.x + dx * t, y: 0, z: grid.start.z + dz * t }, plane);
    const margin = (drawing.bounds.max.x - drawing.bounds.min.x) * 0.1;
    if (point.x < drawing.bounds.min.x - margin || point.x > drawing.bounds.max.x + margin) return;
    const bottom = validGridViewExtents(extents) ? extents.start : drawing.bounds.min.y;
    const top = validGridViewExtents(extents) ? extents.end : drawing.bounds.max.y;
    if (!Number.isFinite(bottom + top) || top <= bottom) return;
    start = { x: point.x, y: bottom };
    end = { x: point.x, y: top };
  }
  return { id: grid.id, templateId: grid.templateId, appearanceId: grid.appearanceId, field: grid.name,
    gridStart: start, position: end, free: true, leader: false,
    globalId: '', projectId: '', fingerprint: '', anchorOffset: { x: 0, y: 0 } };
}
