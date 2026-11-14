/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GraphicStyle } from '@ifc-lite/drawing-2d';
import { decodeSavedFilter, encodeSavedFilter, type SavedFilterPreset } from '../search/saved-filters.js';

export const TEMPLATE_PREFIX = 'drawing-template:';
export interface TemplateRow { ifcClass: string; typeName?: string; style: GraphicStyle }
export interface ViewTemplate { id: string; name: string; rows: TemplateRow[] }

export function encodeViewTemplates(templates: ViewTemplate[], filters: SavedFilterPreset[]) {
  return JSON.stringify({ version: 1, templates, filters: filters.map(encodeSavedFilter) }, null, 2);
}

const penTypes = new Set(['solid', 'dashed', 'dotted', 'dashdot', 'center']);
const penWeights = new Set(['heavy', 'medium', 'light', 'hairline']);
const isColor = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
const isWeight = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0.05 && value <= 2.11;
const isOptional = (value: unknown, check: (entry: unknown) => boolean) => value === undefined || check(value);
const isPattern = (value: unknown) => typeof value === 'string'
  && (['none', 'solid', 'diagonal', 'cross-hatch'].includes(value) || /^pat:.{1,150}$/.test(value));

function validateStyle(style: GraphicStyle): boolean {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return false;
  return [style.lineWeight, style.projectionLineWeight].every(v => isOptional(v, x => isWeight(x) || typeof x === 'string' && penWeights.has(x)))
    && [style.lineStyle, style.projectionLineStyle].every(v => isOptional(v, x => typeof x === 'string' && penTypes.has(x)))
    && [style.hatchLineWeight, style.surfaceHatchLineWeight].every(v => isOptional(v, isWeight))
    && [style.fillColor, style.strokeColor, style.backgroundColor, style.hatchColor, style.surfaceHatch?.foreground?.color,
      style.surfaceHatch?.background?.color].every(v => isOptional(v, isColor))
    && [style.hatchPattern, style.publicationPattern, style.hatchBackgroundPattern, style.surfaceHatch?.foreground?.pattern,
      style.surfaceHatch?.background?.pattern].every(v => isOptional(v, isPattern))
    && isOptional(style.visible, v => typeof v === 'boolean');
}

export function decodeViewTemplates(text: string): { templates: ViewTemplate[]; filters: SavedFilterPreset[] } {
  const data: { version?: unknown; templates?: ViewTemplate[]; filters?: unknown[] } | null = JSON.parse(text);
  if (data?.version !== 1 || !Array.isArray(data.templates) || !Array.isArray(data.filters)) throw new Error('Invalid view templates file.');
  const filters = data.filters.map(value => {
    const filter = decodeSavedFilter(value);
    if (!filter) throw new Error('Invalid saved filter.');
    return filter;
  });
  const templates = data.templates.map((template: ViewTemplate) => {
    if (typeof template?.id !== 'string' || !template.id.startsWith(TEMPLATE_PREFIX) || typeof template.name !== 'string'
      || !template.name.trim() || template.name.length > 80 || !Array.isArray(template.rows) || template.rows.some(row =>
        !row || !/^Ifc[A-Za-z0-9]+$/.test(row.ifcClass) || (row.typeName !== undefined && typeof row.typeName !== 'string')
        || !validateStyle(row.style))) throw new Error('Invalid view template.');
    return template;
  });
  if (new Set(templates.map(template => template.id)).size !== templates.length) throw new Error('Duplicate view template.');
  return { templates, filters };
}
