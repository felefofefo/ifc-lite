/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePat } from './pattern-library.js';

test('imports PAT families and rejects invalid or duplicate definitions', () => {
  assert.deepEqual(parsePat('; comment\n*BRICK, masonry\n0, 0, 1, 1, 4, 2, -2'), [
    { id:'pat:BRICK', name:'BRICK', lines:[{angle:0,x:0,y:1,dx:1,dy:4,dash:[2,-2]}] },
  ]);
  assert.throws(() => parsePat('*A\n0,0,0,0,0'));
  assert.throws(() => parsePat('*A\n0,0,0,0,1\n*a\n0,0,0,0,1'));
});
