/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readMaterialHatches, type MaterialHatches } from './material-hatches';
import { readLineweightTable } from './lineweight-table';
import type { ImportedPattern } from './pattern-library';

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;

function pattern(value: unknown): value is ImportedPattern {
  return object(value) && typeof value.id === 'string' && /^pat:.{1,100}$/.test(value.id)
    && typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 80
    && (value.repeatScale === undefined || finite(value.repeatScale) && value.repeatScale >= 0.01 && value.repeatScale <= 100)
    && Array.isArray(value.lines) && value.lines.length > 0 && value.lines.length <= 64
    && value.lines.every(line => object(line) && ['angle', 'x', 'y', 'dx'].every(key => finite(line[key]))
      && finite(line.dy) && Math.abs(line.dy) >= 0.001 && Array.isArray(line.dash)
      && line.dash.length <= 256 && line.dash.every(finite) && (!line.dash.length || line.dash.some(d => d !== 0)));
}

export function materialSettingsFile(materials: MaterialHatches, patterns: readonly ImportedPattern[], joinUnassigned = false) {
  const used = new Set(Object.values(materials).flatMap(style => [
    style?.foreground?.pattern, style?.surface?.foreground?.pattern,
  ]));
  return { version: 1, kind: 'ifc-lite-materials', joinUnassigned, materials, patterns: patterns.filter(item => used.has(item.id)) };
}

function envelope(raw: string, kind: string): Record<string, unknown> {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.version !== 1 || data.kind !== kind) throw new Error('Unsupported drawing settings file.');
  return data;
}

export function readMaterialSettingsFile(raw: string) {
  const data = envelope(raw, 'ifc-lite-materials');
  if (!object(data.materials) || !Array.isArray(data.patterns) || !data.patterns.every(pattern)
    || new Set(data.patterns.map(item => item.id)).size !== data.patterns.length
    || (data.joinUnassigned !== undefined && typeof data.joinUnassigned !== 'boolean')) {
    throw new Error('Invalid material settings.');
  }
  const materials = readMaterialHatches(JSON.stringify(data.materials));
  if (Object.keys(materials).length !== Object.keys(data.materials).length) throw new Error('Invalid material association.');
  return { materials, patterns: data.patterns, joinUnassigned: data.joinUnassigned as boolean | undefined };
}

export function readLineweightSettingsFile(raw: string) {
  const data = envelope(raw, 'ifc-lite-lineweights');
  if (!object(data.scales)) throw new Error('Invalid lineweight table.');
  const table = readLineweightTable(JSON.stringify(data.scales));
  if (Object.keys(table).length !== Object.keys(data.scales).length) throw new Error('Invalid lineweight row.');
  return table;
}
