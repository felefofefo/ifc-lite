/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { PatternLine } from '@ifc-lite/drawing-2d';
export interface ImportedPattern { id: `pat:${string}`; name: string; lines: PatternLine[] }
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
