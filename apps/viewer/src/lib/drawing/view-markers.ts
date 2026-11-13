/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Point2D } from '@ifc-lite/drawing-2d';
import type { SectionPlane } from '@/store/section-types';
import { percentToWorld, sectionAxisRange, type AxisBounds } from '../section/section-distance.js';

type ViewCode = { id: string; code?: string };
export type MarkerTrace = readonly [Point2D, Point2D];
export const DEFAULT_VIEW_MARKERS = { section: true, elevation: true };

export function isViewCodeAvailable(code: string, views: readonly ViewCode[], except?: string): boolean {
  const normalized = code.trim().toUpperCase();
  return !!normalized && !views.some(view => view.id !== except && view.code?.toUpperCase() === normalized);
}

export function nextViewCode(kind: 'plan' | 'section' | 'elevation' | '3d', views: readonly ViewCode[]): string {
  const prefix = { plan: 'P', section: 'C', elevation: 'E', '3d': '3D' }[kind];
  let number = 1;
  const code = () => `${prefix}-${String(number).padStart(2, '0')}`;
  const used = new Set(views.map(view => view.code?.toUpperCase()));
  while (used.has(code())) number++;
  return code();
}

type MarkerPlane = Pick<SectionPlane, 'axis' | 'position' | 'flipped' | 'box'> & {
  custom?: Pick<NonNullable<SectionPlane['custom']>, 'normal' | 'distance' | 'pickedAt'>;
};

export function viewMarker(plane: MarkerPlane, bounds: AxisBounds, planFlipped: boolean, trace?: MarkerTrace) {
  if (plane.axis === 'down' || plane.box || (plane.custom && Math.abs(plane.custom.normal[1]) >= 1e-8)) return null;
  const range = sectionAxisRange(bounds, plane.axis);
  if (!plane.custom && !range) return null;
  const [nx, , nz] = plane.custom?.normal ?? (plane.axis === 'side' ? [1, 0, 0] : [0, 0, 1]);
  const offset = plane.custom?.distance ?? percentToWorld(plane.position, range!);
  const extent = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
  const center = { x: (bounds.max.x + bounds.min.x) / 2, y: (bounds.max.z + bounds.min.z) / 2 };
  const validTrace = Array.isArray(trace) && trace.length === 2 && trace.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  const ends = validTrace ? trace : [{ x: center.x - nz * extent, y: center.y + nx * extent },
    { x: center.x + nz * extent, y: center.y - nx * extent }];
  const mirror = planFlipped ? -1 : 1;
  const project = ({ x, y }: Point2D) => {
    const shift = offset - (x * nx + y * nz);
    return { x: (x + shift * nx) * mirror, y: y + shift * nz };
  };
  const sign = plane.flipped ? 1 : -1;
  return { start: project(ends[0]), end: project(ends[1]), direction: { x: nx * sign * mirror, y: nz * sign } };
}

type MarkerView = ViewCode & {
  kind?: 'plan' | 'section' | 'elevation' | '3d';
  name: string;
  markerTrace?: MarkerTrace;
  planes: readonly MarkerPlane[];
  activeIndex: number;
};

export function collectViewMarkers(
  views: readonly MarkerView[], bounds: AxisBounds, planFlipped: boolean, flags: typeof DEFAULT_VIEW_MARKERS,
) {
  return views.flatMap(view => {
    const plane = view.planes[view.activeIndex];
    const kind = view.kind ?? (plane?.axis === 'down' ? 'plan' : 'section');
    if (!plane || (kind !== 'section' && kind !== 'elevation') || !flags[kind]) return [];
    const marker = viewMarker(plane, bounds, planFlipped, view.markerTrace);
    return marker ? [{ ...marker, kind, id: view.id, name: view.name, code: view.code ?? view.name }] : [];
  });
}

export function viewMarkerGraphics(marker: NonNullable<ReturnType<typeof viewMarker>>, unit: number) {
  const { start, end, direction: { x, y } } = marker;
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const offset = (forward: number, lateral = 0): Point2D => ({
    x: center.x + (x * forward - y * lateral) * unit,
    y: center.y + (y * forward + x * lateral) * unit,
  });
  const tip = offset(4);
  return { polylines: [[start, end], [center, tip], [offset(2.6, 0.9), tip, offset(2.6, -0.9)]],
    label: offset(6.5) };
}
