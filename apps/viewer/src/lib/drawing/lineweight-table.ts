/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { COMMON_SCALES, formatScaleFactorLabel, LINE_WEIGHT_VALUES, type DrawingScale, type LineWeightPreset } from '@ifc-lite/drawing-2d';

export type LineweightRow = Readonly<Record<LineWeightPreset, number>>;
export type LineweightTable = Readonly<Partial<Record<number, LineweightRow>>>;

export const LINEWEIGHT_PRESETS = ['heavy', 'medium', 'light', 'hairline'] as const;
const GENERAL_WEIGHTS: LineweightRow = { heavy: 0.35, medium: 0.25, light: 0.18, hairline: 0.13 };

export function isCustomScale(factor: number): boolean {
  return Number.isFinite(factor) && factor >= 0.01 && factor <= 100_000 && Number(factor.toFixed(2)) === factor;
}

export function drawingLineweightScales(table: LineweightTable, current: number, added: readonly number[]): DrawingScale[] {
  const scales = new Map(COMMON_SCALES.map((scale) => [scale.factor, scale]));
  for (const factor of [current, ...Object.keys(table).map(Number), ...added.filter(isCustomScale)]) {
    if (Number.isFinite(factor) && factor > 0 && !scales.has(factor)) {
      scales.set(factor, { factor, name: `1:${formatScaleFactorLabel(factor)}`, useCase: '' });
    }
  }
  return [...scales.values()].sort((a, b) => a.factor - b.factor);
}

export function lineweightsAtScale(table: LineweightTable, scale: number): LineweightRow {
  return table[scale] ?? (scale >= 100 ? GENERAL_WEIGHTS : LINE_WEIGHT_VALUES);
}

export function lineweightTableKey(projectId: string): string {
  return `ifc-lite:drawing-lineweights:v1:${projectId}`;
}

export function readLineweightTable(raw: string | null): LineweightTable {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const entries = Object.entries(value as Record<string, unknown>).filter(([scale, row]) => {
      if (!Number.isFinite(Number(scale)) || Number(scale) <= 0 || !row || typeof row !== 'object') return false;
      const weights = row as Record<string, unknown>;
      return LINEWEIGHT_PRESETS.every((preset) => {
        const weight = weights[preset];
        return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0.05 && weight <= 2.11;
      });
    });
    return Object.fromEntries(entries) as LineweightTable;
  } catch (error) {
    console.warn('Could not read drawing lineweights', error);
    return {};
  }
}
