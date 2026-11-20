/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeDrawingItems } from './drawing-arrange.js';

const ids = (items: readonly { id: string }[]) => items.map(item => item.id);

test('moves authored drawing objects one step or to either end', () => {
  const items = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  assert.deepEqual(ids(arrangeDrawingItems(items, 'b', 'front')), ['a', 'c', 'd', 'b']);
  assert.deepEqual(ids(arrangeDrawingItems(items, 'c', 'back')), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(arrangeDrawingItems(items, 'b', 'forward')), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids(arrangeDrawingItems(items, 'c', 'backward')), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids(items), ['a', 'b', 'c', 'd']);
});

test('keeps annotations of other saved views in their original positions', () => {
  const items = [
    { id: 'a', viewKey: 'A' }, { id: 'x', viewKey: 'B' },
    { id: 'b', viewKey: 'A' }, { id: 'y', viewKey: 'B' },
    { id: 'c', viewKey: 'A' },
  ];
  assert.deepEqual(ids(arrangeDrawingItems(items, 'a', 'front')), ['b', 'x', 'c', 'y', 'a']);
  assert.deepEqual(ids(arrangeDrawingItems(items, 'x', 'front')), ['a', 'y', 'b', 'x', 'c']);
  assert.deepEqual(ids(arrangeDrawingItems(items, 'missing', 'front')), ids(items));
});

test('does not disturb a selected element already at a layer boundary', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(arrangeDrawingItems(items, 'a', 'back'), items);
  assert.deepEqual(arrangeDrawingItems(items, 'b', 'forward'), items);
});

test('keeps every segment of a dimension chain together', () => {
  const items = ['a', 'segment-1', 'x', 'segment-2', 'b'].map(id => ({ id }));
  assert.deepEqual(ids(arrangeDrawingItems(items, ['segment-1', 'segment-2'], 'front')),
    ['a', 'x', 'b', 'segment-1', 'segment-2']);
  assert.deepEqual(ids(arrangeDrawingItems(items, ['segment-1', 'segment-2'], 'back')),
    ['segment-1', 'segment-2', 'a', 'x', 'b']);
});
