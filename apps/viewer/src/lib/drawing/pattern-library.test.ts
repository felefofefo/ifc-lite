/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { editPattern, mergeImportedPatterns, parsePat } from './pattern-library.js';

test('imports PAT families and rejects invalid or duplicate definitions', () => {
  assert.deepEqual(parsePat('; comment\n*BRICK, masonry\n0, 0, 1, 1, 4, 2, -2'), [
    { id:'pat:BRICK', name:'BRICK', lines:[{angle:0,x:0,y:1,dx:1,dy:4,dash:[2,-2]}] },
  ]);
  assert.throws(() => parsePat('*A\n0,0,0,0,0'));
  assert.throws(() => parsePat('*A\n0,0,0,0,1\n*a\n0,0,0,0,1'));
});

test('retains assignment identity through rename and reimport, and gives copies independent settings', () => {
  const [source] = parsePat('*A\n0,0,0,0,2');
  const [renamed] = editPattern([source], source.id, 'Brick', 2);
  assert.equal(renamed.id, source.id);
  assert.equal(renamed.name, 'Brick');
  assert.equal(renamed.repeatScale, 2);
  const [original, copy] = editPattern([renamed], source.id, 'Brick fine', 0.5, true);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.repeatScale, 0.5);
  assert.deepEqual(copy.lines, original.lines);
  const [updated] = mergeImportedPatterns([original, copy], parsePat('*A\n0,0,0,0,4'));
  assert.equal(updated.name, 'Brick');
  assert.equal(updated.repeatScale, 2);
  assert.equal(updated.lines[0].dy, 4);
  assert.throws(() => editPattern([original, copy], original.id, 'brick fine', 1));
  assert.throws(() => editPattern([source], source.id, 'A', 0));
});
