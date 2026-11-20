/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, useRef } from 'react';
import { DEFAULT_SECTION_CONFIG, type Drawing2D } from '@ifc-lite/drawing-2d';
import { cleanup, press, render } from '@/test/render.js';
import type { DimensionSegment } from '@/lib/drawing/dimension-line';
import { useMeasure2D } from './useMeasure2D';

const drawing: Drawing2D = {
  config: { ...DEFAULT_SECTION_CONFIG, plane: { axis: 'z', position: 0, flipped: false }, scale: 100 },
  lines: [{
    line: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    category: 'cut', visibility: 'visible', entityId: 1, ifcType: 'IfcWall', modelIndex: 0, depth: 0,
  }],
  cutPolygons: [],
  projectionPolygons: [],
  bounds: { min: { x: 0, y: 0 }, max: { x: 5, y: 1 } },
  stats: { cutLineCount: 1, projectionLineCount: 0, hiddenLineCount: 0, silhouetteLineCount: 0,
    polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
};
const noop = () => {};

function Probe({ onCancel, onPlace }: { onCancel: () => void; onPlace: (segments: DimensionSegment[]) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dimension = useMeasure2D({
    drawing, viewTransform: { x: 20, y: 30, scale: 50 }, setViewTransform: noop,
    sectionAxis: 'down', containerRef, measure2DMode: true, dimensionType: 'aligned',
    setMeasure2DSnapPoint: noop, onCancel, onPlace,
  });
  return <div ref={containerRef} onMouseDown={dimension.handleMouseDown} onMouseUp={dimension.handleMouseUp}
    onMouseMove={dimension.handleMouseMove} onClick={dimension.handleClick}>
    <output>{dimension.draft.placing ? 'offset' : dimension.draft.points.length}</output>
  </div>;
}

function mouse(target: HTMLElement, type: string, clientX: number, clientY: number) {
  act(() => target.dispatchEvent(new window.MouseEvent(type, { button: 0, clientX, clientY, bubbles: true })));
}

afterEach(cleanup);

it('records points only on click, collects a third point, and previews before placing with a final click', () => {
  const placed: DimensionSegment[][] = [];
  const ui = render(<Probe onPlace={segments => placed.push(segments)} onCancel={noop} />);
  const canvas = ui.firstElementChild as HTMLElement;

  mouse(canvas, 'mousedown', 22, 32);
  mouse(canvas, 'mouseup', 22, 32);
  assert.equal(canvas.textContent, '0');
  mouse(canvas, 'click', 22, 32);
  mouse(canvas, 'click', 170, 32);
  mouse(canvas, 'click', 269, 32);
  assert.equal(canvas.textContent, '3');

  press(window, 'Escape');
  assert.equal(canvas.textContent, 'offset');
  mouse(canvas, 'mousemove', 40, 100);
  assert.equal(placed.length, 0);
  mouse(canvas, 'click', 52, 130);
  assert.equal(placed.length, 1);
  assert.deepEqual(placed[0].map(segment => segment.distance), [3, 2]);
  assert.deepEqual(placed[0][0].start, { x: 0, y: 2 });
});

it('cancels when Escape is pressed before the second point', () => {
  let cancels = 0;
  const ui = render(<Probe onPlace={() => assert.fail('an incomplete dimension cannot be placed')} onCancel={() => { cancels++; }} />);
  const canvas = ui.firstElementChild as HTMLElement;
  mouse(canvas, 'click', 22, 32);
  press(window, 'Escape');
  assert.equal(cancels, 1);
  assert.equal(canvas.textContent, '0');
});
