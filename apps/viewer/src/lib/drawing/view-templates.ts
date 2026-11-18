/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { GraphicOverrideRule, GraphicStyle } from '@ifc-lite/drawing-2d';
import { validAnnotationStyles } from './annotation-types';
import type { SavedSectionCut } from '@/store/savedSectionCutsStore';
import { decodeSavedFilter, encodeSavedFilter, type SavedFilterPreset } from '../search/saved-filters.js';

export const TEMPLATE_PREFIX = 'drawing-template:';
export const VIEW_TEMPLATES_STORAGE_KEY = 'ifc-lite:drawing-view-templates:v1';

export function readDrawingViewTemplates(): ViewTemplate[] {
  const raw = globalThis.localStorage?.getItem(VIEW_TEMPLATES_STORAGE_KEY);
  return raw ? decodeViewTemplates(raw).templates : [];
}
export interface TemplateRow { ifcClass: string; typeName?: string; style: GraphicStyle }
export const VIEW_TEMPLATE_GROUPS = ['projection', 'filters', 'graphics', 'annotations'] as const;
export type ViewTemplateGroup = typeof VIEW_TEMPLATE_GROUPS[number];
export const TEMPLATE_DISPLAY_KEYS = [
  'showConstructionProjection', 'showOverheadProjection', 'constructionProjectionDepth', 'showHiddenLines',
  'useSymbolicRepresentations', 'showSurfacePatterns3D', 'show3DOverlay', 'distantElements',
] as const;
type ProjectionSettings = Pick<NonNullable<SavedSectionCut['display']>, typeof TEMPLATE_DISPLAY_KEYS[number]>;
export interface ViewTemplate {
  id: string; name: string; revision?: string; rows: TemplateRow[]; rules?: GraphicOverrideRule[];
  groups?: ViewTemplateGroup[];
  annotations?: SavedSectionCut['annotationOptions'];
  projection?: { scale: number; display: ProjectionSettings };
  filters?: { visibility: NonNullable<SavedSectionCut['visibility']>; filter?: SavedSectionCut['filter'] };
}

export function templateProjectionDisplay(display: ProjectionSettings): ProjectionSettings {
  return {
    showConstructionProjection: display.showConstructionProjection,
    showOverheadProjection: display.showOverheadProjection,
    constructionProjectionDepth: display.constructionProjectionDepth,
    showHiddenLines: display.showHiddenLines,
    useSymbolicRepresentations: display.useSymbolicRepresentations,
    showSurfacePatterns3D: display.showSurfacePatterns3D,
    show3DOverlay: display.show3DOverlay,
    distantElements: display.distantElements,
  };
}

export function viewTemplateGroups(template: ViewTemplate): readonly ViewTemplateGroup[] {
  return template.groups ?? ['graphics'];
}

export function encodeViewTemplates(templates: ViewTemplate[], filters: SavedFilterPreset[]) {
  return JSON.stringify({ version: 1, templates: templates.map(template => ({
    ...template, filters: template.filters && { ...template.filters, filter: template.filters.filter &&
      { ...template.filters.filter, preset: encodeSavedFilter(template.filters.filter.preset) } },
  })), filters: filters.map(encodeSavedFilter) }, null, 2);
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
    && [style.hatchLineWeight, style.surfaceHatchLineWeight].every(v => isOptional(v, x => isWeight(x) || typeof x === 'string' && penWeights.has(x)))
    && [style.fillColor, style.strokeColor, style.backgroundColor, style.hatchColor, style.surfaceHatch?.foreground?.color,
      style.surfaceHatch?.background?.color].every(v => isOptional(v, isColor))
    && [style.hatchPattern, style.publicationPattern, style.hatchBackgroundPattern, style.surfaceHatch?.foreground?.pattern,
      style.surfaceHatch?.background?.pattern].every(v => isOptional(v, isPattern))
    && isOptional(style.visible, v => typeof v === 'boolean');
}

export function reusableViewRules(rules: readonly GraphicOverrideRule[]): GraphicOverrideRule[] {
  const ids = new Set<string>();
  for (const rule of rules) {
    const criteria = rule?.criteria;
    if (!rule || typeof rule.id !== 'string' || !rule.id || ids.has(rule.id) || typeof rule.name !== 'string' ||
      typeof rule.enabled !== 'boolean' || !Number.isFinite(rule.priority) || !validateStyle(rule.style) ||
      (rule.savedFilter !== undefined && !decodeSavedFilter(rule.savedFilter)) ||
      !criteria || !('type' in criteria) ||
      (criteria.type !== 'all' && (criteria.type !== 'ifcType' || !Array.isArray(criteria.ifcTypes) ||
        !criteria.ifcTypes.every(type => typeof type === 'string' && /^Ifc[A-Za-z0-9]+$/.test(type)) ||
        (criteria.includeSubtypes !== undefined && typeof criteria.includeSubtypes !== 'boolean')))) {
      throw new Error('Invalid reusable graphics rule.');
    }
    ids.add(rule.id);
  }
  return structuredClone([...rules]);
}

function validateProjection(projection: NonNullable<ViewTemplate['projection']>) {
  const v = projection?.display;
  return v && Number.isFinite(projection.scale) && projection.scale > 0
    && (v.showConstructionProjection == null || typeof v.showConstructionProjection === 'boolean')
    && [v.showOverheadProjection, v.showHiddenLines, v.useSymbolicRepresentations, v.showSurfacePatterns3D, v.show3DOverlay]
      .every(flag => flag === undefined || typeof flag === 'boolean')
    && (v.constructionProjectionDepth == null || (Number.isFinite(v.constructionProjectionDepth) && v.constructionProjectionDepth > 0))
    && (v.distantElements === undefined || (!!v.distantElements
      && Number.isFinite(v.distantElements.offset) && v.distantElements.offset >= 0
      && Number.isFinite(v.distantElements.fade) && v.distantElements.fade >= 0 && v.distantElements.fade <= 1
      && isOptional(v.distantElements.color, isColor)
      && isOptional(v.distantElements.weight, weight => typeof weight === 'string' && penWeights.has(weight))));
}

function validateVisibility(visibility: NonNullable<SavedSectionCut['visibility']>) {
  const keys = (value: unknown) => Array.isArray(value) && value.every(entry =>
    entry && typeof entry.model === 'string' && typeof entry.guid === 'string');
  return visibility && keys(visibility.hidden)
    && (visibility.isolated === null || keys(visibility.isolated))
    && (visibility.classes === null || (typeof visibility.classes?.label === 'string' && keys(visibility.classes.members)))
    && visibility.types && typeof visibility.types === 'object' && !Array.isArray(visibility.types)
    && Object.values(visibility.types).every(value => typeof value === 'boolean');
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
    if (template.revision !== undefined && (typeof template.revision !== 'string' || template.revision.length > 128)) throw new Error('Invalid template revision.');
    if (template.rules !== undefined && !Array.isArray(template.rules)) throw new Error('Invalid view template rules.');
    if (template.groups !== undefined && (!Array.isArray(template.groups) ||
      template.groups.some(group => !VIEW_TEMPLATE_GROUPS.includes(group)) ||
      !template.groups.length || new Set(template.groups).size !== template.groups.length)) throw new Error('Invalid template groups.');
    const groups = viewTemplateGroups(template);
    if ((groups.includes('projection') || template.projection !== undefined) && (!template.projection || !validateProjection(template.projection))) throw new Error('Invalid projection group.');
    if ((groups.includes('filters') || template.filters !== undefined) && (!template.filters || !validateVisibility(template.filters.visibility))) throw new Error('Invalid filters group.');
    if (template.annotations !== undefined || groups.includes('annotations')) {
      const visibility = template.annotations?.visibility;
      const styleIds = template.annotations?.styleIds;
      if (styleIds !== undefined && (!styleIds || typeof styleIds !== 'object' || Array.isArray(styleIds)
        || !Object.values(styleIds).every(id => typeof id === 'string' && id.length <= 200))) throw new Error('Invalid annotation types.');
      if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility)
        || !Object.values(visibility).every(value => typeof value === 'boolean')
        || (template.annotations?.styles !== undefined && !validAnnotationStyles(template.annotations.styles))) throw new Error('Invalid annotations group.');
    }
    const filter = template.filters?.filter;
    const preset = filter && decodeSavedFilter(filter.preset);
    if (filter && (!preset || (filter.mode !== 'show' && filter.mode !== 'hide'))) throw new Error('Invalid template filter.');
    return { ...template,
      projection: template.projection ? {
        scale: template.projection.scale, display: templateProjectionDisplay(template.projection.display),
      } : undefined,
      filters: template.filters ? {
        visibility: template.filters.visibility, filter: filter && preset ? { mode: filter.mode, preset } : undefined,
      } : undefined,
      rules: template.rules && reusableViewRules(template.rules),
    };
  });
  if (new Set(templates.map(template => template.id)).size !== templates.length) throw new Error('Duplicate view template.');
  return { templates, filters };
}
