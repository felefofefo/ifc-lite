/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
