/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@/test/render.js';
import { DrawingSnapGlyph } from './DrawingSnapGlyph.js';

afterEach(cleanup);

it('draws recognizable SVG symbols for each geometric snap, plus a neutral angle fallback', () => {
  for (const [kind, expected, tag] of [
    ['endpoint', 'endpoint', 'rect'], ['vertex', 'endpoint', 'rect'],
    ['midpoint', 'midpoint', 'polygon'], ['intersection', 'intersection', 'path'],
    ['edge', 'nearest', 'path'], [null, 'angle', 'circle'],
  ] as const) {
    const svg = render(<svg><DrawingSnapGlyph kind={kind} /></svg>);
    const marker = svg.querySelector(`[data-drawing-snap-kind="${expected}"]`);
    assert.ok(marker, String(kind));
    assert.ok(marker.querySelector(tag), `${String(kind)} draws ${tag}`);
    cleanup();
  }
});
