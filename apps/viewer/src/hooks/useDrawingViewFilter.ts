/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useState } from 'react';
import { evaluateFilterGroupsFederated, resolveCapturedEntityScope } from '@ifc-lite/rules';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { definedModelTagIdsOf, evaluatorModelsFromState } from '@/lib/model-tags/evaluator-models';

export function useDrawingViewFilter() {
  const filter = useSavedSectionCuts(s => s.cuts.find(c => c.id === s.activeCutId)?.filter);
  const models = useViewerStore(s => s.models);
  const legacy = useViewerStore(s => s.ifcDataStore);
  const revision = useViewerStore(s => s.mutationVersion);
  const tags = useViewerStore(s => s.modelTagAssignments);
  const definitions = useViewerStore(s => s.modelTags);
  const lenses = useViewerStore(s => s.savedLenses);
  const [result, setResult] = useState<{ filter: typeof filter; ids?: Set<number>; failed?: boolean }>();
  useEffect(() => {
    if (!filter) return;
    const abort = new AbortController();
    const state = useViewerStore.getState();
    const inputs = evaluatorModelsFromState(state).filter(m => m.store);
    if (!models.size && legacy) inputs.push({ id: 'legacy', store: legacy });
    void (async () => {
      try {
        const scope = filter.preset.capturedScope;
        const matches = await evaluateFilterGroupsFederated(inputs, filter.preset.groups, {
          limit: Infinity, chunkSize: 500, signal: abort.signal, definedModelTagIds: definedModelTagIdsOf(state),
          candidateExpressIdsByModel: scope ? resolveCapturedEntityScope(scope, inputs) : undefined,
        });
        if (!abort.signal.aborted) setResult({ filter, ids: new Set(matches.map(m => toGlobalIdFromModels(models, m.modelId, m.expressId))) });
      } catch (error) {
        if (!abort.signal.aborted) {
          console.warn('Could not evaluate saved drawing filter', error);
          setResult({ filter, failed: true });
        }
      }
    })();
    return () => abort.abort();
  }, [filter, models, legacy, revision, tags, definitions, lenses]);
  return filter && result?.filter === filter
    ? { mode: filter.mode, ids: result.ids, failed: result.failed }
    : null;
}
