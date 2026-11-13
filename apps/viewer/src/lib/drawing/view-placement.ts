/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D } from '@ifc-lite/drawing-2d';
import type { CustomSectionPlane } from '@/store/section-types';
import { sectionAxisRange, worldToPosition, type AxisBounds } from '../section/section-distance.js';

export function planCutPosition(elevation: number, bounds: AxisBounds | null): number | null {
  const range = sectionAxisRange(bounds, 'down');
  const position = range ? worldToPosition(elevation, range) : NaN;
  return Number.isFinite(position) ? position : null;
}

/** The source plan's projected U is mirrored when looking up. */
export function verticalViewPlane(
  start: Point2D, end: Point2D, planFlipped: boolean, reverse: boolean,
): CustomSectionPlane | null {
  const mirror = planFlipped ? -1 : 1;
  const dx = (end.x - start.x) * mirror;
  const dz = end.y - start.y;
  const length = Math.hypot(dx, dz);
  if (!Number.isFinite(length) || length < 1e-6) return null;
  const direction = planFlipped === reverse ? 1 : -1;
  const nx = direction * dz / length;
  const nz = -direction * dx / length;
  const pickedAt: CustomSectionPlane['pickedAt'] = [start.x * mirror, 0, start.y];
  const distance = pickedAt[0] * nx + pickedAt[2] * nz;
  if (!Number.isFinite(distance)) return null;
  return {
    normal: [nx || 0, 0, nz || 0], distance, pickedAt,
    tangent: [nz || 0, 0, -nx || 0], bitangent: [0, 1, 0],
  };
}

export function supportsDrawingProjection(plane: { custom?: Pick<CustomSectionPlane, 'normal'> }): boolean {
  return !plane.custom || Math.abs(plane.custom.normal[1]) < 1e-8;
}

export function verticalProjectionDepth(bounds: AxisBounds, plane: Pick<CustomSectionPlane, 'normal' | 'distance'>, flipped: boolean): number {
  const [nx, , nz] = plane.normal;
  const depth = [bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.z, bounds.max.z].map(z =>
    (plane.distance - nx * x - nz * z) * (flipped ? -1 : 1)));
  return Math.max(0.001, ...depth);
}
