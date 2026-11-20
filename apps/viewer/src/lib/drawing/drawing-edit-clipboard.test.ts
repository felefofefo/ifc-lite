/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { cloneClipboardPayload, sameDrawingCoordinates, snapshotAnnotation } from './drawing-edit-clipboard';

const plan: SectionPlaneConfig = { axis: 'y', position: 1.2, flipped: false };

test('paste in place accepts a consistent cardinal basis but rejects changed orientation', () => {
  assert.equal(sameDrawingCoordinates(plan, { ...plan, position: 4 }), true);
  assert.equal(sameDrawingCoordinates(plan, { ...plan, flipped: true }), false);
  assert.equal(sameDrawingCoordinates(plan, { ...plan, axis: 'z' }), false);
});

test('copying one dimension captures its complete chain and gives the pasted chain a new identity', () => {
  const dimensions = [0, 1, 2].map(n => ({
    id: `dim-${n}`, start: { x: n, y: 2 }, end: { x: n + 1, y: 2 }, distance: 1,
    dimension: { anchors: [{ x: n, y: 1 }, { x: n + 1, y: 1 }] as [{ x: number; y: number }, { x: number; y: number }],
      chainId: n === 2 ? 'other' : 'chain', viewKey: 'view:original', styleId: 'style' },
  }));
  const copied = snapshotAnnotation({ type: 'measure', id: 'dim-0' }, dimensions, [], [], []);
  assert.equal(copied?.kind, 'dimensions');
  if (copied?.kind !== 'dimensions') return;
  assert.equal(copied.items.length, 2);
  const pasted = cloneClipboardPayload(copied, 'view:target', () => 'new');
  assert.equal(pasted.kind, 'dimensions');
  if (pasted.kind !== 'dimensions') return;
  assert.deepEqual(pasted.items.map(item => item.id), ['new-0', 'new-1']);
  assert.equal(pasted.items[0].dimension?.chainId, 'new');
  assert.equal(pasted.items[1].dimension?.viewKey, 'view:target');
  assert.deepEqual(pasted.items[0].dimension?.anchors, dimensions[0].dimension.anchors);
  assert.equal(dimensions[0].dimension.chainId, 'chain');
});

test('copying an IFC tag preserves the target identity while creating a new annotation', () => {
  const item = { id: 'old', globalId: 'ifc-guid', projectId: 'project', fingerprint: 'model',
    field: 'mark', position: { x: 1, y: 2 }, anchorOffset: { x: 0.5, y: 0 }, leader: true };
  const pasted = cloneClipboardPayload({ kind: 'tag', item }, 'view:target', () => 'new');
  assert.equal(pasted.kind, 'tag');
  if (pasted.kind !== 'tag') return;
  assert.equal(pasted.item.id, 'new');
  assert.equal(pasted.item.globalId, item.globalId);
  assert.equal(pasted.item.projectId, item.projectId);
  assert.equal(pasted.item.fingerprint, item.fingerprint);
  assert.notStrictEqual(pasted.item, item);
});
