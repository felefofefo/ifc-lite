/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DrawingLine } from '@ifc-lite/drawing-2d';
import { distantColor, splitDistantLine } from './distant-elements.js';

const line: DrawingLine = { category: 'projection', visibility: 'visible', entityId: 1, ifcType: 'IfcWall', modelIndex: 0,
  depth: 1, depthEnd: 5, line: { start: { x: 0, y: 0 }, end: { x: 8, y: 0 } } };

test('splits at true projection depth and leaves cut strokes outside the distant zone', () => {
  const [near, far] = splitDistantLine(line, 3);
  assert.equal(near.line.end.x, 4);
  assert.equal(near.distant, false);
  assert.deepEqual(far.line.start, near.line.end);
  assert.equal(far.distant, true);
  assert.deepEqual(splitDistantLine({ ...line, category: 'cut' }, 3), [{ ...line, category: 'cut' }]);
});

test('fades the final override colour and preserves a zero-fade colour exactly', () => {
  assert.equal(distantColor('#000000', { offset: 3, fade: 0.5 }), '#808080');
  assert.equal(distantColor('#000000', { offset: 3, fade: 0.5, color: '#ff0000' }), '#ff8080');
  assert.equal(distantColor('#123456', { offset: 3, fade: 0 }), '#123456');
});
