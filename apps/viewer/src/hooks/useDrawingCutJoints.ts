/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback } from 'react';
import { suppressCutJoints, type DrawingPolygon } from '@ifc-lite/drawing-2d';
import { resolveAllMaterialDefIds } from '@ifc-lite/parser';
import { resolveEntityRef, useViewerStore } from '@/store';
import { drawingProjectId } from '@/lib/drawing/drawing-project';
import { materialIdForCut } from '@/lib/drawing/material-hatches';
import { useDrawingMaterials } from './useDrawingMaterials';

export function useDrawingCutJoints() {
  const models = useViewerStore(state => state.models);
  const legacyStore = useViewerStore(state => state.ifcDataStore);
  const projectId = useViewerStore(drawingProjectId);
  const { joinUnassigned } = useDrawingMaterials(projectId);
  return useCallback((polygons: DrawingPolygon[]) => suppressCutJoints(polygons, polygon => {
    const ref = resolveEntityRef(polygon.entityId);
    const material = polygon.materialId === undefined ? undefined : resolveEntityRef(polygon.materialId);
    const store = ref.modelId === 'legacy' ? legacyStore : models.get(ref.modelId)?.ifcDataStore;
    const id = store && materialIdForCut(store, ref.expressId,
      material && material.modelId === ref.modelId ? material.expressId : undefined);
    if (id !== undefined) return `${ref.modelId}:${id}`;
    const ifcClass = /^Ifc(Wall|Column|Beam|Slab)(?:StandardCase|ElementedCase)?$/i.exec(polygon.ifcType)?.[1];
    if (joinUnassigned && ifcClass && store && polygon.materialId === undefined
      && resolveAllMaterialDefIds(store, ref.expressId).length === 0) {
      return `${ref.modelId}:unassigned:${ifcClass.toLowerCase()}`;
    }
    return undefined;
  }), [models, legacyStore, joinUnassigned]);
}
