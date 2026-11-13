/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { GraphicOverrideEngine } from '@ifc-lite/drawing-2d';
import { resolveEntityRef, useViewerStore } from '@/store';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { drawingProjectId } from '@/lib/drawing/drawing-project';
import { resolveCutPolygonStyle, type CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';
import { drawingPublicationHatchStyle } from './drawingPublicationHatchStyle';
import { makePropertiesGetter } from './drawingElementProperties';
import { useDrawingMaterials } from './useDrawingMaterials';

export function usePublicationFillPreview(retainNativeCaps = false) {
  const projectId = useViewerStore(drawingProjectId);
  const { hatches } = useDrawingMaterials(projectId);
  const models = useViewerStore((s) => s.models);
  const legacyStore = useViewerStore((s) => s.ifcDataStore);
  const rules = useViewerStore((s) => s.customOverrideRules);
  const overrides = useViewerStore((s) => s.overridesEnabled);
  const preset = useViewerStore((s) => s.activePresetId);
  const enabled = useViewerStore((s) => s.drawing2DDisplayOptions.showHatching);
  const saved3DScale = useSavedSectionCuts((s) => retainNativeCaps
    ? s.cuts.find((cut) => cut.id === s.activeCutId && cut.kind === '3d')?.publicationScale : undefined);
  const scale = useViewerStore((s) => saved3DScale
    ?? (s.sheetEnabled && s.activeSheet ? s.activeSheet.scale.factor : s.drawing2DDisplayOptions.scale));
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  return useMemo(() => {
    const properties = makePropertiesGetter(models, legacyStore);
    const context: CutPolygonStyleContext = {
      useIfcMaterials: preset === 'preset-3d-colors',
      entityColorMap: new Map(), overridesEnabled: overrides,
      overrideEngine: new GraphicOverrideEngine(useViewerStore.getState().getActiveOverrideRules()),
      getElementProperties: properties,
    };
    return {
      scale,
      fallbackColor: (polygon: Parameters<typeof resolveCutPolygonStyle>[0]) =>
        resolveCutPolygonStyle({ ...polygon, color: polygon.color ?? polygon.sourceColor }, context).fillColor,
      resolve: enabled ? drawingPublicationHatchStyle(hatches, scale, models, legacyStore, overrides ? context.overrideEngine.getRules() : [],
        properties, resolveEntityRef) : retainNativeCaps ? undefined : () => [],
    };
  }, [enabled, hatches, scale, models, legacyStore, overrides, preset, rules, mutationVersion, retainNativeCaps]);
}
