/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { collectMaterialLeaves, resolveAllMaterialDefIds, type IfcDataStore } from '@ifc-lite/parser';

export const MATERIAL_HATCH_PATTERNS = ['solid', 'diagonal', 'cross-hatch', 'none'] as const;
export type MaterialHatchPattern = typeof MATERIAL_HATCH_PATTERNS[number] | `pat:${string}`;
export interface FillPaint {
  pattern?: MaterialHatchPattern;
  color?: string;
}

export interface HatchPaints {
  foreground?: FillPaint;
  background?: FillPaint;
}

export interface MaterialHatchStyle extends HatchPaints {
  surface?: HatchPaints;
}

export function hasHatchPaint(paints: HatchPaints | undefined): boolean {
  return !!(paints?.foreground?.pattern || paints?.foreground?.color || paints?.background?.pattern || paints?.background?.color);
}

export type MaterialHatches = Readonly<Partial<Record<string, MaterialHatchStyle>>>;

export function isMaterialHatchPattern(value: unknown): value is MaterialHatchPattern {
  return (typeof value === 'string' && /^pat:.+/.test(value)) || MATERIAL_HATCH_PATTERNS.some((pattern) => pattern === value);
}

export function backgroundHatchPattern(value: unknown): 'solid' | 'none' | undefined {
  return value === 'none' ? 'none' : MATERIAL_HATCH_PATTERNS.some(pattern => pattern === value) ? 'solid' : undefined;
}

export function readMaterialHatches(raw: string | null): MaterialHatches {
  if (!raw) return {};
  const data: unknown = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).flatMap(([name, value]) => {
    if (isMaterialHatchPattern(value)) return [[name, { foreground: { pattern: value } }]];
    if (!value || typeof value !== 'object') return [];
    const cut = readPaints(value);
    const surface = readPaints((value as Record<string, unknown>).surface);
    return cut || surface ? [[name, surface ? { ...cut, surface } : cut]] : [];
  }));
}

function readPaints(value: unknown): HatchPaints | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const style = value as Record<string, unknown>;
  const foreground = readPaint(style.foreground);
  const background = readPaint(style.background);
  if (background) background.pattern = backgroundHatchPattern(background.pattern);
  return foreground || background ? { foreground, background } : undefined;
}

function readPaint(value: unknown): FillPaint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const paint = value as Record<string, unknown>;
  const pattern = isMaterialHatchPattern(paint.pattern) ? paint.pattern : undefined;
  const color = typeof paint.color === 'string' && /^#[0-9a-f]{6}$/i.test(paint.color) ? paint.color : undefined;
  return pattern || color ? { pattern, color } : undefined;
}

export function materialNames(stores: readonly IfcDataStore[]): string[] {
  const names = new Set<string>();
  for (const store of stores) {
    const entities = store.entities;
    if (!entities) continue;
    // IfcMaterial retains its exact name but has no dedicated enum bucket.
    for (const id of entities.expressId.subarray(0, entities.count)) {
      if (entities.getTypeName(id) !== 'IfcMaterial') continue;
      const name = entities.getName(id);
      if (name?.trim()) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function materialNameForCut(store: IfcDataStore, entityId: number, materialId?: number): string | undefined {
  const id = materialIdForCut(store, entityId, materialId);
  const name = id === undefined ? undefined : store.entities.getName(id);
  return name?.trim() ? name : undefined;
}

export function materialIdForCut(store: IfcDataStore, entityId: number, materialId?: number): number | undefined {
  if (materialId !== undefined && store.entities?.getTypeName(materialId) === 'IfcMaterial') return materialId;

  // A polygon without a stamped layer can only identify one unambiguous leaf.
  const leaves = new Set<number>();
  for (const definition of resolveAllMaterialDefIds(store, entityId)) {
    const materials = collectMaterialLeaves(store, definition);
    if (!materials.length) return undefined;
    for (const leaf of materials) {
      if (store.entities?.getTypeName(leaf.id) !== 'IfcMaterial' || !leaf.name?.trim()) return undefined;
      leaves.add(leaf.id);
    }
  }
  return leaves.size === 1 ? leaves.values().next().value : undefined;
}

export function reassignMaterialHatches(hatches: MaterialHatches, source: string, target?: string): MaterialHatches {
  if (!Object.hasOwn(hatches, source) || source === target) return hatches;
  const { [source]: style, ...remaining } = hatches;
  return target ? { ...remaining, [target]: style } : remaining;
}
