/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback } from 'react';
import { useViewerStore } from '@/store';
import { selectSaved3DActive, setViewSectionCap, useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export function useSectionFill(): { on: boolean; available: boolean; toggle: () => void } {
  const overlay = useViewerStore(s => s.drawing2DDisplayOptions.show3DOverlay);
  const saved3D = useSavedSectionCuts(selectSaved3DActive);
  const available = overlay || saved3D;
  const showCap = useViewerStore((s) => s.sectionPlane.showCap);
  const toggle = useCallback(() => {
    const state = useViewerStore.getState();
    if (state.drawing2DDisplayOptions.show3DOverlay || selectSaved3DActive(useSavedSectionCuts.getState())) {
      setViewSectionCap(!state.sectionPlane.showCap);
    }
  }, []);
  return { on: available && showCap, available, toggle };
}
