/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import { create } from 'zustand';
import { readMaterialHatches, type MaterialHatches } from '@/lib/drawing/material-hatches';

const useMaterialEdits = create<{ projects: ReadonlyMap<string | undefined, MaterialHatches> }>(() => ({ projects: new Map() }));

export function useDrawingMaterials(projectId: string | undefined) {
  const edited = useMaterialEdits((state) => state.projects.get(projectId));
  const key = projectId ? `ifc-lite:drawing-material-hatches:v1:${projectId}` : undefined;
  const saved = useMemo(() => {
    if (!key) return {};
    try {
      return readMaterialHatches(localStorage.getItem(key));
    } catch (error) {
      console.warn('Could not load drawing material hatches', error);
      return {};
    }
  }, [key]);
  return {
    projectId,
    hatches: edited ?? saved,
    save(hatches: MaterialHatches) {
      if (key) localStorage.setItem(key, JSON.stringify(hatches));
      useMaterialEdits.setState(({ projects }) => ({ projects: new Map(projects).set(projectId, hatches) }));
    },
  };
}
