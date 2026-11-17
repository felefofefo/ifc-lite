/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { CloudAnnotation2D, DrawnSectionPlane, Measure2DResult, PolygonArea2DResult, TextAnnotation2D } from '../../store/slices/drawing2DSlice';

export function temporaryDimensionViewKey(plane: DrawnSectionPlane): string {
  const { axis, position, flipped, custom } = plane;
  // Section restore converts through model coordinates, which can change the last decimal places.
  const rounded = (value: number) => Number(value.toFixed(8));
  if (!custom) return `plane:${JSON.stringify([axis, flipped, rounded(position)])}`;
  const { tangent, bitangent, normal, pickedAt, distance } = custom;
  const origin = [tangent, bitangent].map(basis =>
    rounded(basis[0] * pickedAt[0] + basis[1] * pickedAt[1] + basis[2] * pickedAt[2]));
  return `plane:${JSON.stringify([axis, flipped, normal.map(rounded), rounded(distance), tangent.map(rounded), bitangent.map(rounded), origin])}`;
}

export function savedDimensionViewKey(id: string): string {
  return `view:${id}`;
}

export function dimensionViewKey(
  drawnPlane: DrawnSectionPlane, livePlaneId: string, savedViewId?: string, savedPlaneId?: string,
): string | null {
  if (savedViewId && livePlaneId === savedPlaneId) {
    // A view switch can leave the previous drawing on screen while the new one generates.
    return drawnPlane.id === savedPlaneId ? savedDimensionViewKey(savedViewId) : null;
  }
  return temporaryDimensionViewKey(drawnPlane);
}

export function measurementsInView(measurements: Measure2DResult[], viewKey: string | null): Measure2DResult[] {
  return measurements.filter(result => result.dimension ? result.dimension.viewKey === viewKey
    : result.viewKey === undefined || result.viewKey === viewKey);
}

/** Promote a temporary view when the user saves it. */
export function assignDimensionView(
  measurements: Measure2DResult[], to: string, from: string,
): Measure2DResult[] {
  if (!measurements.some(result => result.dimension && result.dimension.viewKey === from)) return measurements;
  return measurements.map(result => result.dimension && result.dimension.viewKey === from
    ? { ...result, dimension: { ...result.dimension, viewKey: to } }
    : result);
}

type MarkupState = {
  measure2DResults: Measure2DResult[];
  polygonArea2DResults: PolygonArea2DResult[];
  textAnnotations2D: TextAnnotation2D[];
  cloudAnnotations2D: CloudAnnotation2D[];
};

export function transferViewMarkup(state: MarkupState, from: string | undefined, to: string, duplicate = false): MarkupState {
  function transfer<T>(items: T[], key: (item: T) => string | undefined, update: (item: T, index: number) => T) {
    if (duplicate) return [...items, ...items.filter(item => key(item) === from).map((item, index) => update(structuredClone(item), index))];
    return items.map((item, index) => key(item) === from ? update(item, index) : item);
  }
  function simple<T extends { id: string; viewKey?: string }>(items: T[], kind: string) {
    return transfer(items, item => item.viewKey, (item, index) => ({
      ...item, viewKey: to, id: duplicate ? `${to}:${kind}:${index}` : item.id,
    }));
  }
  return {
    measure2DResults: transfer(state.measure2DResults, item => item.dimension?.viewKey ?? item.viewKey, (item, index) => {
      const id = duplicate ? `${to}:measure:${index}` : item.id;
      if (!item.dimension) return { ...item, id, viewKey: to };
      const chainId = duplicate ? `${to}:${item.dimension.chainId}` : item.dimension.chainId;
      return { ...item, id, dimension: { ...item.dimension, viewKey: to, chainId } };
    }),
    polygonArea2DResults: simple(state.polygonArea2DResults, 'area'),
    textAnnotations2D: simple(state.textAnnotations2D, 'text'),
    cloudAnnotations2D: simple(state.cloudAnnotations2D, 'cloud'),
  };
}
