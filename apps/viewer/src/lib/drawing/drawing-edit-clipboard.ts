/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Clipboard for authored 2D elements. The IFC source geometry is never modified. */
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { DrawingElementTag } from './drawing-element-tags';
import type { ProjectGrid } from './project-grids';
import type {
  Measure2DResult, PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D, SelectedAnnotation2D,
} from '@/store/slices/drawing2DSlice';

export type DrawingClipboardPayload =
  | { kind: 'dimensions'; items: Measure2DResult[] }
  | { kind: 'area'; item: PolygonArea2DResult }
  | { kind: 'text'; item: TextAnnotation2D }
  | { kind: 'cloud'; item: CloudAnnotation2D }
  | { kind: 'tag'; item: DrawingElementTag }
  | { kind: 'grid'; item: ProjectGrid };

export interface DrawingEditClipboard {
  projectId?: string;
  payload: DrawingClipboardPayload | { kind: 'batch'; items: DrawingClipboardPayload[] };
  plane: SectionPlaneConfig;
}

/** Coordinate identity, not a coincidental matching zoom or drawing size. */
export function sameDrawingCoordinates(source: SectionPlaneConfig, target: SectionPlaneConfig): boolean {
  if (source.axis !== target.axis || source.flipped !== target.flipped) return false;
  if (!source.customPlane || !target.customPlane) return !source.customPlane && !target.customPlane;
  // Different origins/bases are different drawing coordinate systems, even if both are vertical cuts.
  const compare = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
  const a = source.customPlane, b = target.customPlane;
  return compare(a.origin, b.origin) && compare(a.tangent, b.tangent) && compare(a.bitangent, b.bitangent);
}

/** A selected dimension segment copies its entire chain, not a detached fragment. */
export function snapshotAnnotation(
  selected: SelectedAnnotation2D,
  measurements: readonly Measure2DResult[],
  areas: readonly PolygonArea2DResult[],
  texts: readonly TextAnnotation2D[],
  clouds: readonly CloudAnnotation2D[],
): DrawingClipboardPayload | null {
  if (selected.type === 'measure') {
    if (selected.dimensionLabel) return null;
    const item = measurements.find(item => item.id === selected.id);
    if (!item) return null;
    const chainId = item.dimension?.chainId;
    return { kind: 'dimensions', items: structuredClone(chainId
      ? measurements.filter(item => item.dimension?.chainId === chainId)
      : [item]) };
  }
  if (selected.type === 'polygon') {
    const item = areas.find(item => item.id === selected.id);
    return item ? { kind: 'area', item: structuredClone(item) } : null;
  }
  if (selected.type === 'text') {
    const item = texts.find(item => item.id === selected.id);
    return item ? { kind: 'text', item: structuredClone(item) } : null;
  }
  const item = clouds.find(item => item.id === selected.id);
  return item ? { kind: 'cloud', item: structuredClone(item) } : null;
}

/** Copy complete dimension chains exactly once, retaining local symbol references. */
export function snapshotWindowClipboard(
  selection: readonly (SelectedAnnotation2D | { type: 'tag'; id: string } | { type: 'marker'; id: string })[],
  measurements: readonly Measure2DResult[], areas: readonly PolygonArea2DResult[],
  texts: readonly TextAnnotation2D[], clouds: readonly CloudAnnotation2D[],
  tags: readonly DrawingElementTag[], grids: readonly ProjectGrid[],
): DrawingClipboardPayload[] | null {
  const items: DrawingClipboardPayload[] = [];
  const seen = new Set<string>();
  const dimensions = new Set<string>();
  for (const selected of selection) {
    const key = `${selected.type}:${selected.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // A marker is an entire saved view, not a clipboard annotation.
    if (selected.type === 'marker') return null;
    if (selected.type === 'tag') {
      const grid = grids.find(item => item.id === selected.id);
      if (grid) { items.push({ kind: 'grid', item: structuredClone(grid) }); continue; }
      const tag = tags.find(item => item.id === selected.id);
      if (!tag) return null;
      items.push({ kind: 'tag', item: structuredClone(tag) });
      continue;
    }
    if (selected.type === 'measure' && dimensions.has(selected.id)) continue;
    const payload = snapshotAnnotation(selected, measurements, areas, texts, clouds);
    if (!payload) return null;
    if (payload.kind === 'dimensions') payload.items.forEach(item => dimensions.add(item.id));
    items.push(payload);
  }
  return items.length ? items : null;
}

/** New internal ids, existing IFC references and style ids. Never copy live store references. */
export function cloneClipboardPayload(payload: DrawingClipboardPayload, viewKey: string, id: () => string): DrawingClipboardPayload {
  switch (payload.kind) {
    case 'dimensions': {
      const chainId = id();
      return { kind: 'dimensions', items: payload.items.map((item, index) => ({
        ...structuredClone(item), id: `${chainId}-${index}`, viewKey, drawOrder: undefined,
        ...(item.dimension && { dimension: { ...structuredClone(item.dimension), chainId, viewKey } }),
      })) };
    }
    case 'area': return { kind: 'area', item: { ...structuredClone(payload.item), id: id(), viewKey, drawOrder: undefined } };
    case 'text': return { kind: 'text', item: { ...structuredClone(payload.item), id: id(), viewKey, drawOrder: undefined } };
    case 'cloud': return { kind: 'cloud', item: { ...structuredClone(payload.item), id: id(), viewKey, drawOrder: undefined } };
    case 'tag': return { kind: 'tag', item: { ...structuredClone(payload.item), id: id(), drawOrder: undefined } };
    case 'grid': return { kind: 'grid', item: { ...structuredClone(payload.item), id: id() } };
  }
}
