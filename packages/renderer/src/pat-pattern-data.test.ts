/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { packPatPatterns } from './pat-pattern-data.js';

test('packs signed gaps, point dashes and row offsets without shifting later patterns', () => {
  const line = { angle: 0, x: 2, y: 3, dx: 4, dy: -5, dash: [2, -1, 0, -3] };
  const { offsets, data } = packPatPatterns([
    { id: 'a', lines: [line] },
    { id: 'skipped', lines: [{ ...line, dash: Array(257).fill(1) }] },
    { id: 'b', lines: [{ ...line, dash: [] }] },
  ]);
  assert.deepEqual([...offsets], [['a', 1], ['b', 15]]);
  assert.deepEqual([...data.slice(1, 15)], [1, 1, 1, 0, 2, 3, 4, -5, 4, 6, 2, -1, 0, -3]);
});
