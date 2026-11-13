/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { GraphicOverrideEngine, type DrawingPolygon, type DXFHatchLayer, type ElementData, type GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { EntityRef, FederatedModel } from '@/store/types';
import { backgroundHatchPattern, hasHatchPaint, isMaterialHatchPattern, materialNameForCut, type FillPaint, type MaterialHatches, type MaterialHatchStyle } from '@/lib/drawing/material-hatches';

import type { ImportedPattern } from '@/lib/drawing/pattern-library';

export function drawingPublicationHatchStyle(
  assignments: MaterialHatches | undefined,
  scale: number,
  models: ReadonlyMap<string, FederatedModel>,
  legacyStore: IfcDataStore | null,
  rules: readonly GraphicOverrideRule[],
  getProperties: (entityId: number) => ElementData['properties'],
  resolveEntityRef: (entityId: number) => EntityRef,
  patterns: readonly ImportedPattern[] = [],
) {
  const imported = new Map(patterns.map(p => [p.id, p.lines]));
  const cutRules = rules.filter(({ enabled, style }) => enabled &&
    (style.publicationPattern || isMaterialHatchPattern(style.hatchPattern) || isMaterialHatchPattern(style.hatchBackgroundPattern)
      || style.hatchColor !== undefined || style.backgroundColor !== undefined || style.fillColor !== undefined
      || style.hatchSpacing !== undefined || style.hatchLineWeight !== undefined));
  const hasAssignments = !!assignments && Object.keys(assignments).length > 0;
  const cutEngine = new GraphicOverrideEngine(cutRules);
  const surfaceRules = rules.filter(({ enabled, style }) => enabled && hasHatchPaint(style.surfaceHatch));
  const surfaceEngine = new GraphicOverrideEngine(surfaceRules);
  const hasSurface = hasAssignments && Object.values(assignments).some(style => hasHatchPaint(style?.surface));
  const materialCache = new Map<string, MaterialHatchStyle | undefined>();
  const matchedRules = { cut: new Map<number, GraphicOverrideRule[]>(), surface: new Map<number, GraphicOverrideRule[]>() };
  return (polygon: DrawingPolygon, fallbackColor: string | (() => string)): DXFHatchLayer[] | undefined => {
    const applicableRules = polygon.isCut ? cutRules : surfaceRules;
    if (!(polygon.isCut ? hasAssignments : hasSurface) && !applicableRules.length) return undefined;
    const ref = resolveEntityRef(polygon.entityId);
    const key = `${polygon.entityId}:${polygon.materialId ?? ''}`;
    if (hasAssignments && !materialCache.has(key)) {
      const store = ref.modelId === 'legacy' ? legacyStore : models.get(ref.modelId)?.ifcDataStore;
      const materialRef = polygon.materialId === undefined ? undefined : resolveEntityRef(polygon.materialId);
      const name = store && materialNameForCut(store, ref.expressId,
        materialRef?.modelId === ref.modelId ? materialRef?.expressId : undefined);
      materialCache.set(key, name && Object.hasOwn(assignments, name) ? assignments[name] : undefined);
    }
    const assignment = materialCache.get(key);
    const paints = polygon.isCut ? assignment : assignment?.surface;
    const material = hasHatchPaint(paints) ? paints : undefined;
    const engine = polygon.isCut ? cutEngine : surfaceEngine;
    const cache = polygon.isCut ? matchedRules.cut : matchedRules.surface;
    let matched = cache.get(polygon.entityId);
    if (!matched) {
      matched = applicableRules.length ? engine.getMatchingRules({
        expressId: polygon.entityId, ifcType: polygon.ifcType, modelId: ref.modelId, properties: getProperties(polygon.entityId),
      }) : [];
      cache.set(polygon.entityId, matched);
    }
    if (!material && !matched.length) return undefined;

    const background: FillPaint = { ...material?.background };
    if (polygon.isCut && background.pattern !== 'none') {
      background.pattern ??= 'solid';
      background.color ??= typeof fallbackColor === 'function' ? fallbackColor() : fallbackColor;
    }
    background.pattern = backgroundHatchPattern(background.pattern);
    const foreground: FillPaint = { ...material?.foreground };
    let spacing = 2.5;
    let lineWeight = 0.13;
    for (const { style } of matched) {
      const foregroundPattern = polygon.isCut ? style.publicationPattern ?? style.hatchPattern : style.surfaceHatch?.foreground?.pattern;
      const foregroundColor = polygon.isCut ? style.hatchColor : style.surfaceHatch?.foreground?.color;
      if (isMaterialHatchPattern(foregroundPattern)) foreground.pattern = foregroundPattern;
      const backgroundPattern = backgroundHatchPattern(polygon.isCut ? style.hatchBackgroundPattern : style.surfaceHatch?.background?.pattern);
      if (backgroundPattern) background.pattern = backgroundPattern;
      if (foregroundColor !== undefined) foreground.color = foregroundColor;
      const backgroundColor = polygon.isCut ? style.backgroundColor ?? style.fillColor : style.surfaceHatch?.background?.color;
      if (backgroundColor !== undefined) {
        background.color = backgroundColor;
        if (!backgroundPattern) background.pattern = 'solid';
      }
      if (polygon.isCut && style.hatchSpacing !== undefined && Number.isFinite(style.hatchSpacing) && style.hatchSpacing >= 0.1) spacing = style.hatchSpacing;
      if (polygon.isCut && style.hatchLineWeight !== undefined && Number.isFinite(style.hatchLineWeight) && style.hatchLineWeight > 0) lineWeight = style.hatchLineWeight;
    }

    if (background.color) background.pattern ??= 'solid';
    return [background, foreground].flatMap<DXFHatchLayer>(({ pattern, color }) => {
      if (!pattern || pattern === 'none') return [];
      const paint = { color: color ?? '#666666', spacing: spacing * scale / 1000, lineWeight };
      if (pattern === 'solid' || pattern === 'diagonal' || pattern === 'cross-hatch') return [{ ...paint, pattern }];
      const families = imported.get(pattern);
      return families ? [{ ...paint, pattern: 'custom', spacing: scale / 1000, families }] : [];
    });
  };
}
