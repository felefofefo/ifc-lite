/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Measure2DResult, PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';

/** The order of authored marks within their own view and rendering layer. */
export type DrawingArrangeAction = 'front' | 'forward' | 'backward' | 'back';

/**
 * Reorder one item without moving markup belonging to other drawing views.
 * The last item in a layer is painted on top. Does not mutate store arrays.
 */
export function arrangeDrawingItems<T extends { id: string; viewKey?: string }>(
  items: readonly T[], selectedId: string | readonly string[], action: DrawingArrangeAction,
): T[] {
  const ids = new Set(typeof selectedId === 'string' ? [selectedId] : selectedId);
  const selected = items.find(item => ids.has(item.id));
  if (!selected) return [...items];
  const slots: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].viewKey === selected.viewKey) slots.push(i);
  }
  const group = slots.map(index => items[index]);
  const first = group.findIndex(item => ids.has(item.id));
  let last = first;
  for (let i = group.length - 1; i >= 0; i--) {
    if (ids.has(group[i].id)) { last = i; break; }
  }
  if (first < 0) return [...items];
  const movable = group.filter(item => ids.has(item.id));
  const others = group.filter(item => !ids.has(item.id));
  const beforeFirst = group.slice(0, first).filter(item => !ids.has(item.id)).length;
  const beforeLast = group.slice(0, last + 1).filter(item => !ids.has(item.id)).length;
  const insertAt = action === 'front' ? others.length
    : action === 'back' ? 0
      : action === 'forward' ? Math.min(beforeLast + 1, others.length)
        : Math.max(beforeFirst - 1, 0);
  others.splice(insertAt, 0, ...movable);
  const result = [...items];
  slots.forEach((slot, index) => { result[slot] = others[index]; });
  return result;
}

export type CanvasMarkupEntry =
  | { type: 'measure'; item: Measure2DResult }
  | { type: 'polygon'; item: PolygonArea2DResult }
  | { type: 'text'; item: TextAnnotation2D }
  | { type: 'cloud'; item: CloudAnnotation2D };

function markupKey(entry: CanvasMarkupEntry): string {
  return entry.type === 'measure' && entry.item.dimension?.chainId
    ? `chain:${entry.item.dimension.chainId}` : `${entry.type}:${entry.item.id}`;
}

/** One ordered group per authored object. A dimension chain is one object,
 * even when a new segment has been appended without an explicit order. */
export function canvasMarkupGroups(
  measures: readonly Measure2DResult[], areas: readonly PolygonArea2DResult[],
  texts: readonly TextAnnotation2D[], clouds: readonly CloudAnnotation2D[],
) {
  const entries: CanvasMarkupEntry[] = [
    ...measures.map(item => ({ type: 'measure' as const, item })),
    ...areas.map(item => ({ type: 'polygon' as const, item })),
    ...texts.map(item => ({ type: 'text' as const, item })),
    ...clouds.map(item => ({ type: 'cloud' as const, item })),
  ];
  const groups = new Map<string, { id: string; order: number; entries: CanvasMarkupEntry[] }>();
  for (const entry of entries) {
    const id = markupKey(entry);
    let group = groups.get(id);
    if (!group) { group = { id, order: Infinity, entries: [] }; groups.set(id, group); }
    group.entries.push(entry);
    const order = entry.item.drawOrder;
    if (typeof order === 'number' && Number.isFinite(order)) group.order = Math.min(group.order, order);
  }
  // Stable sort preserves legacy paint order when no explicit rank exists;
  // newly created objects without a rank appear above arranged objects.
  return [...groups.values()].sort((a, b) => a.order === b.order ? 0 : a.order < b.order ? -1 : 1);
}

/** Resolve all selected segments to their whole chain before reordering. */
export function canvasArrangeRanks(
  groups: ReturnType<typeof canvasMarkupGroups>, selected: { type: CanvasMarkupEntry['type']; id: string },
  action: DrawingArrangeAction,
): Map<string, number> | null {
  const group = groups.find(group => group.entries.some(entry => entry.type === selected.type && entry.item.id === selected.id));
  if (!group) return null;
  const reordered = arrangeDrawingItems(groups, group.id, action);
  if (reordered.every((entry, index) => entry === groups[index])) return null;
  return new Map(reordered.flatMap((group, rank) => group.entries.map(entry => [`${entry.type}:${entry.item.id}`, rank] as const)));
}
