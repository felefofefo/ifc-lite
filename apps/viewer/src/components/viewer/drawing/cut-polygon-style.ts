/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Fill and stroke of one cut polygon, shared by every `useDrawingExport.ts`
 * writer (raw SVG, sheet SVG, scaled PDF) so the PDF cannot fall back to
 * black outlines while the SVG export shows the coloured section. Same rules
 * as the light-paper canvas in Drawing2DCanvas.
 */

import type { DrawingPolygon, DXFExportOptions, DXFHatchLayer, ElementData, GraphicOverrideEngine } from '@ifc-lite/drawing-2d';
import { rgbaToHex } from '@ifc-lite/lens';
import { getFillColorForType } from './ifc-fill-colors';

export interface CutPolygonStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  /** Paper millimetres. */
  lineWeight: number;
  dash?: readonly number[];
  fills?: readonly DXFHatchLayer[];
}

export interface CutPolygonStyleContext {
  /** The 3D colours preset: fill with IFC material colours (as Drawing2DCanvas). */
  useIfcMaterials: boolean;
  entityColorMap: Map<number, [number, number, number, number]>;
  overridesEnabled: boolean;
  overrideEngine: GraphicOverrideEngine;
  stroke?: DXFExportOptions['strokeStyle'];
  fills?: (polygon: DrawingPolygon, fallbackColor: string) => readonly DXFHatchLayer[] | undefined;
  darkPaper?: boolean;
  getElementProperties: (entityId: number) => ElementData['properties'];
}

export function resolveCutPolygonStyle(
  polygon: DrawingPolygon,
  ctx: CutPolygonStyleContext,
): CutPolygonStyle {
  if (!polygon.isCut) {
    return {
      fillColor: '#666666', fillOpacity: 0, strokeColor: '#000000', lineWeight: 0,
      fills: ctx.fills?.(polygon, '#666666') ?? [],
    };
  }
  const override = ctx.overridesEnabled
    ? ctx.overrideEngine.applyOverrides({
      expressId: polygon.entityId,
      ifcType: polygon.ifcType,
      properties: ctx.getElementProperties(polygon.entityId),
    }).style
    : null;
  const pen = ctx.stroke?.(polygon, 'cut');
  const weight = pen?.lineWeight ?? override?.lineWeight;
  const material = ctx.useIfcMaterials ? (polygon.color ?? polygon.sourceColor ?? ctx.entityColorMap.get(polygon.entityId)) : undefined;
  const fillColor = material ? rgbaToHex(material)
    : override && !ctx.useIfcMaterials ? override.fillColor : getFillColorForType(polygon.ifcType, ctx.darkPaper);
  const fillOpacity = material?.[3] ?? (override && !ctx.useIfcMaterials ? override.opacity : 1);
  return {
    fillColor, fillOpacity,
    strokeColor: pen?.color ?? override?.strokeColor ?? '#000000',
    lineWeight: weight !== undefined && Number.isFinite(weight) ? Math.max(0, weight) : 0.5,
    dash: pen?.dash,
    fills: ctx.fills?.(polygon, fillColor),
  };
}

/** Style every cut polygon once, alongside the writer's own geometry for it. */
export function styleCutPolygons<P extends DrawingPolygon, G>(
  polygons: readonly P[],
  ctx: CutPolygonStyleContext,
  geometry: (polygon: P) => G,
): { polygon: P; style: CutPolygonStyle; geometry: G }[] {
  return polygons.map((polygon) => ({ polygon, style: resolveCutPolygonStyle(polygon, ctx), geometry: geometry(polygon) }));
}
