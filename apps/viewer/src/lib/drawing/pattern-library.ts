/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { PatternLine } from '@ifc-lite/drawing-2d';
export interface ImportedPattern { id: `pat:${string}`; name: string; repeatScale?: number; lines: PatternLine[] }
export function parsePat(text: string): ImportedPattern[] {
  const patterns: ImportedPattern[] = [];
  let pattern: ImportedPattern | undefined;
  for (const row of text.split(/\r?\n/)) {
    const line = row.split(';', 1)[0].trim();
    if (!line) continue;
    if (line.startsWith('*')) {
      const name = line.slice(1).split(',', 1)[0].trim();
      const id = `pat:${name.toUpperCase()}` as const;
      if (!name || name.length > 80 || patterns.some(p => p.id === id)) throw new Error('Invalid PAT name.');
      pattern = { id, name, lines: [] };
      patterns.push(pattern);
      continue;
    }
    const values = line.split(',').map(value => value.trim() ? Number(value.trim()) : NaN);
    const [angle, x, y, dx, dy, ...dash] = values;
    if (!pattern || values.length < 5 || !values.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)
      || Math.abs(dy) < 0.001 || (dash.length && !dash.some(d => d !== 0)) || pattern.lines.length >= 64) {
      throw new Error('Invalid or unsupported PAT line.');
    }
    pattern.lines.push({ angle, x, y, dx, dy, dash });
  }
  if (!patterns.length || patterns.some(p => !p.lines.length)) throw new Error('Empty PAT pattern.');
  return patterns;
}

export function editPattern(
  patterns: ImportedPattern[], id: ImportedPattern['id'], name: string, repeatScale: number, duplicate = false,
): ImportedPattern[] {
  const source = patterns.find(pattern => pattern.id === id);
  name = name.trim();
  if (!source || !name || name.length > 80 || !Number.isFinite(repeatScale) || repeatScale < 0.01 || repeatScale > 100
    || patterns.some(p => (duplicate || p.id !== id) && p.name.toUpperCase() === name.toUpperCase())) {
    throw new Error('Invalid hatch settings.');
  }
  const updated = { ...source, name, repeatScale };
  if (duplicate) return [...patterns, { ...updated, id: `pat:copy:${crypto.randomUUID()}` }];
  return patterns.map(p => p.id === id ? updated : p);
}

export function mergeImportedPatterns(current: ImportedPattern[], incoming: ImportedPattern[]): ImportedPattern[] {
  const next = new Map(current.map(pattern => [pattern.id, pattern]));
  for (const pattern of incoming) {
    const prior = next.get(pattern.id);
    next.set(pattern.id, prior ? { ...prior, lines: pattern.lines } : pattern);
  }
  return [...next.values()];
}

export function patternRepeatScale(pattern: ImportedPattern): number {
  const factor = pattern.repeatScale ?? 1;
  return Number.isFinite(factor) && factor >= 0.01 && factor <= 100 ? factor : 1;
}
