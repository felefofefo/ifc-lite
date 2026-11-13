/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, type RefObject } from 'react';
import type { MeshData } from '@ifc-lite/geometry';
import type { Renderer } from '@ifc-lite/renderer';
import { useViewerStore } from '@/store';
import { pdfColor } from '@/lib/export/pdf-color';
import { usePublicationFillPreview } from './usePublicationFillPreview';

const empty = { outer: [], holes: [] };
function packedColor(color: string | undefined): number {
  const parsed = color && pdfColor(color);
  if (!parsed) return 0;
  const rgb = Number.parseInt(parsed.color.slice(1), 16);
  return rgb + 1;
}

export function useSurfacePatterns3D(renderer: RefObject<Renderer | null>, ready: boolean, geometry: MeshData[] | null) {
  const enabled = useViewerStore(s => s.drawing2DDisplayOptions.showSurfacePatterns3D);
  const { resolve } = usePublicationFillPreview(true, true);
  useEffect(() => {
    if (!ready) return;
    const target = renderer.current;
    if (!target) return;
    const patterns: Parameters<Renderer['setSurfacePatterns']>[0][number][] = [];
    const seen = new Set<string>();
    if (enabled && resolve) for (const mesh of geometry ?? []) {
      const materialId = mesh.materialId ?? 0;
      const key = `${mesh.expressId}:${materialId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const paints = resolve({ polygon: empty, isCut: false, entityId: mesh.expressId,
        ifcType: mesh.ifcType ?? '', modelIndex: mesh.modelIndex ?? 0, materialId: mesh.materialId }, '#666666') ?? [];
      const solid = paints.findLastIndex(p => p.pattern === 'solid');
      const hatch = paints.slice(solid + 1).find(p => p.pattern === 'diagonal' || p.pattern === 'cross-hatch');
      if (solid < 0 && !hatch) continue;
      patterns.push([mesh.expressId, materialId, [packedColor(hatch?.color), packedColor(paints[solid]?.color),
        hatch?.spacing ?? 1, hatch?.pattern === 'cross-hatch' ? 2 : hatch ? 1 : 0]]);
    }
    target.setSurfacePatterns(patterns);
  }, [renderer, ready, enabled, resolve, geometry]);
}
