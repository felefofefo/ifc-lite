import { useDrawingPatterns } from './useDrawingPatterns';
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { GraphicOverrideEngine } from '@ifc-lite/drawing-2d';
import { resolveEntityRef, useViewerStore } from '@/store';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { drawingProjectId } from '@/lib/drawing/drawing-project';
import { resolveCutPolygonStyle, type CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';
import { resolveDrawingPaperTheme } from '@/components/viewer/drawing/paper-theme';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import { drawingPublicationHatchStyle } from './drawingPublicationHatchStyle';
import { makePropertiesGetter } from './drawingElementProperties';
import { useDrawingMaterials } from './useDrawingMaterials';

export function usePublicationFillPreview(retainNativeCaps = false, surface3D = false) {
  const projectId = useViewerStore(drawingProjectId);
  const { patterns } = useDrawingPatterns();
  const { hatches } = useDrawingMaterials(projectId);
  const models = useViewerStore((s) => s.models);
  const legacyStore = useViewerStore((s) => s.ifcDataStore);
  const rules = useDrawingRuntime().graphicRules;
  const legacyRules = useViewerStore(s => s.customOverrideRules);
  const overrides = useViewerStore((s) => s.overridesEnabled);
  const preset = useViewerStore((s) => s.activePresetId);
  const enabled = useViewerStore((s) => surface3D ? s.drawing2DDisplayOptions.showSurfacePatterns3D : s.drawing2DDisplayOptions.showHatching);
  const distant = useViewerStore(s => s.drawing2DDisplayOptions.distantElements);
  const saved3DScale = useSavedSectionCuts((s) => retainNativeCaps
    ? s.cuts.find((cut) => cut.id === s.activeCutId && cut.kind === '3d')?.publicationScale : undefined);
  const scale = useViewerStore((s) => saved3DScale
    ?? (s.sheetEnabled && s.activeSheet ? s.activeSheet.scale.factor : s.drawing2DDisplayOptions.scale));
  const theme = useViewerStore((s) => s.theme);
  const printPreview = useViewerStore((s) => s.drawing2DDisplayOptions.showPrintPreview);
  const sheetEnabled = useViewerStore((s) => s.sheetEnabled && !!s.activeSheet);
  const darkPaper = !sheetEnabled && resolveDrawingPaperTheme(theme, printPreview).isDark;
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  return useMemo(() => {
    const properties = makePropertiesGetter(models, legacyStore);
    const context: CutPolygonStyleContext = {
      useIfcMaterials: (preset === 'preset-3d-colors' || preset?.startsWith('drawing-template:') === true),
      entityColorMap: new Map(), overridesEnabled: overrides,
      overrideEngine: new GraphicOverrideEngine(rules ?? useViewerStore.getState().getActiveOverrideRules()),
      getElementProperties: properties, darkPaper,
    };
    return {
      scale, distant,
      fallbackStyle: (polygon: Parameters<typeof resolveCutPolygonStyle>[0]) =>
        resolveCutPolygonStyle(polygon, context),
      resolve: enabled ? drawingPublicationHatchStyle(hatches, scale, models, legacyStore, overrides ? context.overrideEngine.getRules() : [],
        properties, resolveEntityRef, patterns, distant) : undefined,
    };
  }, [enabled, hatches, scale, models, legacyStore, overrides, preset, rules, legacyRules, mutationVersion, retainNativeCaps, patterns, darkPaper, distant]);
}
