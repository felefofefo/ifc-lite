/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { RelationshipType } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GraphicOverrideRule } from '@ifc-lite/drawing-2d';
import { evaluateFilterGroupsFederated, resolveCapturedEntityScope } from '@ifc-lite/rules';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { definedModelTagIdsOf, evaluatorModelsFromState } from '@/lib/model-tags/evaluator-models';
import { decodeSavedFilter } from '@/lib/search/saved-filters';
import { decodeViewTemplates, encodeViewTemplates, type ViewTemplate } from '@/lib/drawing/view-templates';

const key = 'ifc-lite:drawing-view-templates:v1';
const EMPTY_TEMPLATES: ViewTemplate[] = [];
const EMPTY_RULES: GraphicOverrideRule[] = [];
const catalog = create<{ templates?: ViewTemplate[] }>(() => ({}));
export function useViewTemplates() {
  const templates = catalog(s => s.templates);
  const initial = useMemo(() => {
    try { const raw = localStorage.getItem(key); return raw ? decodeViewTemplates(raw).templates : EMPTY_TEMPLATES; }
    catch (error) { console.warn('Could not read drawing templates', error); return EMPTY_TEMPLATES; }
  }, []);
  return {
    templates: templates ?? initial,
    save(next: ViewTemplate[]) {
      localStorage.setItem(key, encodeViewTemplates(next, []));
      catalog.setState({ templates: next });
    },
  };
}

export function useDrawingTypeRows() {
  const models = useViewerStore(s => s.models);
  const legacy = useViewerStore(s => s.ifcDataStore);
  const revision = useViewerStore(s => s.mutationVersion);
  const geometry = useViewerStore(s => s.geometryResult);
  return useMemo(() => {
    const classes = new Map<string, Map<string, number[]>>();
    const stores: [string, IfcDataStore][] = [...models].flatMap(([id, model]) => model.ifcDataStore ? [[id, model.ifcDataStore]] : []);
    if (!models.size && legacy) stores.push(['legacy', legacy]);
    for (const [model, store] of stores) {
      const ids = new Set<number>();
      for (const mesh of model === 'legacy' ? geometry?.meshes ?? [] : models.get(model)?.geometryResult?.meshes ?? []) ids.add(mesh.expressId);
      // Include semantic occurrences even on instanced or server-backed loads.
      for (const id of store.entities?.expressId.subarray(0, store.entities.count) ?? []) {
        const ifcClass = store.entities.getTypeName(id);
        const type = store.relationships?.getRelated(id, RelationshipType.DefinesByType, 'inverse')[0];
        const globalId = toGlobalIdFromModels(models, model, id);
        if (!type && !ids.has(id) && !ids.has(globalId)) continue;
        const name = type ? store.entities.getName(type) : '';
        let types = classes.get(ifcClass);
        if (!types) classes.set(ifcClass, types = new Map());
        if (name) {
          const matches = types.get(name);
          if (matches) matches.push(globalId);
          else types.set(name, [globalId]);
        }
      }
    }
    return classes;
  }, [models, legacy, revision, geometry]);
}

export function useDrawingTemplateRules() {
  const { templates } = useViewTemplates();
  const classes = useDrawingTypeRows();
  const id = useViewerStore(s => s.activePresetId);
  const custom = useViewerStore(s => s.customOverrideRules);
  const enabled = useViewerStore(s => s.overridesEnabled);
  const models = useViewerStore(s => s.models);
  const legacy = useViewerStore(s => s.ifcDataStore);
  const revision = useViewerStore(s => s.mutationVersion);
  const tags = useViewerStore(s => s.modelTagAssignments);
  const lenses = useViewerStore(s => s.savedLenses);
  const tagDefinitions = useViewerStore(s => s.modelTags);
  const legacyRules = useViewerStore(s => s.graphicOverridePresets);
  const filters = useMemo(() => custom.map(rule => [rule, decodeSavedFilter(rule.savedFilter)] as const).filter(([rule, preset]) => rule.enabled && preset), [custom]);
  const [result, setResult] = useState<{ filters: typeof filters; models: typeof models; matches: Map<string, number[]> }>();
  useEffect(() => {
    if (!enabled || !filters.length) return;
    const controller = new AbortController();
    const state = useViewerStore.getState();
    const inputs = evaluatorModelsFromState(state).filter(m => m.store);
    if (!models.size && legacy) inputs.push({ id: 'legacy', store: legacy });
    void Promise.all(filters.map(async ([rule, preset]) => {
      try {
        if (!preset) return [rule.id, [] as number[]] as const;
        const matches = await evaluateFilterGroupsFederated(inputs, preset.groups, {
          limit: Infinity, signal: controller.signal, chunkSize: 500, definedModelTagIds: definedModelTagIdsOf(state),
          candidateExpressIdsByModel: preset.capturedScope ? resolveCapturedEntityScope(preset.capturedScope, inputs) : undefined,
        });
        return [rule.id, matches.map(m => toGlobalIdFromModels(models, m.modelId, m.expressId))] as const;
      } catch (error) {
        if (!controller.signal.aborted) console.warn('Could not evaluate drawing override filter', error);
        return [rule.id, [] as number[]] as const;
      }
    })).then(entries => { if (!controller.signal.aborted) setResult({ filters, models, matches: new Map(entries) }); });
    return () => controller.abort();
  }, [enabled, filters, models, legacy, revision, tags, lenses, tagDefinitions]);
  const graphicRules = useMemo(() => {
    if (!enabled) return EMPTY_RULES;
    const template = templates.find(t => t.id === id);
    const base = template?.rows.map<GraphicOverrideRule>((row, index) => ({
      id: `${id}:${index}`, name: row.typeName ?? row.ifcClass, enabled: true, priority: row.typeName ? 1 : 0,
      criteria: row.typeName ? { type: 'expressId', expressIds: classes.get(row.ifcClass)?.get(row.typeName) ?? [] }
        : { type: 'ifcType', ifcTypes: [row.ifcClass], includeSubtypes: false },
      style: row.style,
    })) ?? legacyRules.find(preset => preset.id === id)?.rules ?? [];
    const matches = result?.filters === filters && result.models === models ? result.matches : undefined;
    return [...base, ...custom.flatMap<GraphicOverrideRule>(rule => {
      const withFilter = rule.savedFilter !== undefined;
      const ids = matches?.get(rule.id);
      if (withFilter && !ids?.length) return [];
      return [{ ...rule, priority: rule.priority + 1000,
        criteria: withFilter ? { type: 'expressId' as const, expressIds: ids } : rule.criteria }];
    })];
  }, [enabled, templates, id, custom, legacyRules, classes, filters, models, result]);
  return { graphicRules, pending: enabled && filters.length > 0 && (result?.filters !== filters || result.models !== models) };
}
