/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ViewerState } from '@/store';

export function drawingProjectId(s: Pick<ViewerState, 'models' | 'ifcDataStore'>): string | undefined {
  const models = [...s.models.values()];
  const anchor = models.find((model) => model.federationAlignmentStatus === 'anchor' && model.ifcDataStore);
  const store = anchor?.ifcDataStore ?? models.find((model) => model.ifcDataStore)?.ifcDataStore ?? s.ifcDataStore;
  const id = store?.spatialHierarchy?.project?.expressId;
  return id === undefined ? undefined : store?.entities?.getGlobalId(id) || undefined;
}
