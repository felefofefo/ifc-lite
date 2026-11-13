/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { FederatedModel, ViewerState } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';

type ElementKey = { model: string; guid: string };
export interface SavedViewVisibility {
  hidden: ElementKey[];
  isolated: ElementKey[] | null;
  classes: { label: string; members: ElementKey[] } | null;
  types: ViewerState['typeVisibility'];
}

function modelKey(model: FederatedModel): string {
  return model.sourceFingerprint ?? model.sourceContentHash ?? model.name;
}

export function captureViewVisibility(state: ViewerState): SavedViewVisibility {
  function capture(ids: ReadonlySet<number>): ElementKey[] {
    const result: ElementKey[] = [];
    for (const id of ids) {
      const ref = state.resolveGlobalIdFromModels(id);
      const model = ref && state.models.get(ref.modelId);
      const store = model ? model.ifcDataStore : state.models.size === 0 ? state.ifcDataStore : null;
      const guid = store?.entities.getGlobalId(ref?.expressId ?? id);
      if (guid) result.push({ model: model ? modelKey(model) : 'legacy', guid });
    }
    return result;
  }
  return {
    hidden: capture(state.hiddenEntities),
    isolated: state.isolatedEntities && capture(state.isolatedEntities),
    classes: state.classFilter && { label: state.classFilter.label, members: capture(state.classFilter.ids) },
    types: { ...state.typeVisibility },
  };
}

export function restoreViewVisibility(state: ViewerState, visibility: SavedViewVisibility) {
  const models = new Map<string, string[]>();
  for (const [id, model] of state.models) {
    const key = modelKey(model);
    const ids = models.get(key);
    if (ids) ids.push(id);
    else models.set(key, [id]);
  }
  function resolve(members: ElementKey[]): Set<number> {
    const result = new Set<number>();
    for (const { model, guid } of members) {
      if (model === 'legacy' && state.models.size === 0) {
        const id = state.ifcDataStore?.entities.getExpressIdByGlobalId(guid);
        if (id !== undefined && id > 0) result.add(id);
      } else {
        const candidates = models.get(model) ?? [];
        const matches = candidates.flatMap(id => {
          const local = state.models.get(id)?.ifcDataStore?.entities.getExpressIdByGlobalId(guid);
          return local !== undefined && local > 0 ? [toGlobalIdFromModels(state.models, id, local)] : [];
        });
        if (matches.length === 1) result.add(matches[0]);
      }
    }
    return result;
  }
  return {
    hiddenEntities: resolve(visibility.hidden),
    isolatedEntities: visibility.isolated && resolve(visibility.isolated),
    classFilter: visibility.classes && { label: visibility.classes.label, ids: resolve(visibility.classes.members) },
    typeVisibility: { ...state.typeVisibility, ...visibility.types },
    ghostExceptEntities: null,
  };
}
