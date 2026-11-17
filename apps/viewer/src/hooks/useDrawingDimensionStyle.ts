/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useState } from 'react';
import { readDimensionStyleLibrary, type DimensionStyleLibrary } from '@/lib/drawing/dimension-style';

export function useDrawingDimensionStyle(projectId: string | undefined) {
  const [edited, setEdited] = useState<{ projectId: string | undefined; library: DimensionStyleLibrary }>();
  const key = projectId ? `ifc-lite:drawing-dimension-style:v1:${projectId}` : undefined;
  const saved = useMemo(() => {
    try {
      return readDimensionStyleLibrary(key ? localStorage.getItem(key) : null);
    } catch (error) {
      console.warn('Could not load dimension types', error);
      return readDimensionStyleLibrary(null);
    }
  }, [key]);
  const library = edited && edited.projectId === projectId ? edited.library : saved;
  const styles = useMemo(() => new Map(library.types.map(type => [type.id, type.style])), [library.types]);
  return {
    projectId, library, styles,
    save(library: DimensionStyleLibrary) {
      if (key) localStorage.setItem(key, JSON.stringify({ version: 2, ...library }));
      setEdited({ projectId, library });
    },
  };
}
