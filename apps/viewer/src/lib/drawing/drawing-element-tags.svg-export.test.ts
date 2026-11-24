/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import '@/test/setup-dom.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { drawingTagsSvg, type ResolvedDrawingTag } from './drawing-element-tags';

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const artwork = (withViewBox: boolean) => {
  const viewBox = withViewBox ? ' viewBox="0 0 100 50"' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"${viewBox}><circle cx="50" cy="25" r="15"/><text x="50" y="25">B</text></svg>`;
  return { width: 20, height: 10, anchor: { x: 10, y: 5 }, directional: false, text: 'B',
    href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
};

function tag(start = false, withViewBox = true): ResolvedDrawingTag {
  const head = artwork(withViewBox);
  return {
    tag: { id: 'grid', globalId: '', projectId: '', fingerprint: '',
      position: { x: 10, y: 8 }, anchorOffset: { x: 0, y: 0 },
      gridStart: start ? { x: 2, y: 8 } : undefined,
      free: true, leader: false, templateId: 'symbol', field: 'B' },
    text: 'B', anchor: { x: 2, y: 8 }, graphic: head,
    startGraphic: start ? head : undefined,
  };
}

describe('standalone SVG tag and grid artwork', () => {
  it('embeds the tag geometry as vector SVG instead of a nested data image', () => {
    const xml = drawingTagsSvg([tag()], (x, y) => ({ x, y }), 0.05, esc);
    const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${xml}</svg>`, 'image/svg+xml');
    assert.equal(svg.querySelector('parsererror'), null);
    assert.equal(svg.querySelectorAll('image').length, 0);
    assert.equal(svg.querySelectorAll('#ifc-tags > svg').length, 1);
    assert.equal(svg.querySelectorAll('#ifc-tags circle').length, 1);
    const embedded = svg.querySelector('#ifc-tags > svg');
    assert.equal(embedded?.getAttribute('width'), '1');
    assert.equal(embedded?.getAttribute('height'), '0.5');
  });

  it('keeps both grid heads and the leader, including artwork without viewBox', () => {
    const xml = drawingTagsSvg([tag(true, false)], (x, y) => ({ x: -x, y }), 1, esc);
    const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${xml}</svg>`, 'image/svg+xml');
    assert.equal(svg.querySelectorAll('#ifc-tags > svg').length, 2);
    assert.equal(svg.querySelectorAll('#ifc-tags circle').length, 2);
    assert.equal(svg.querySelectorAll('#ifc-tags > line').length, 1);
    assert.equal(svg.querySelector('#ifc-tags > svg')?.getAttribute('viewBox'), '0 0 100 50');
    assert.equal(svg.querySelector('image'), null);
  });
});
