/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, useRef, useState } from 'react';
import { DEFAULT_SECTION_CONFIG, type Drawing2D } from '@ifc-lite/drawing-2d';
import { cleanup, render } from '@/test/render.js';
import { useMeasure2D, type DrawingObjectSnaps } from './useMeasure2D.js';

const noop = () => {};
const allOff: DrawingObjectSnaps = { endpoint: false, midpoint: false, intersection: false, nearest: false };
const endpoint: DrawingObjectSnaps = { ...allOff, endpoint: true, nearest: true };
const nearest: DrawingObjectSnaps = { ...allOff, nearest: true };
type Pt = { x: number; y: number };
type Segment = { a: Pt; b: Pt; hidden?: boolean };
const seg = (x1: number, y1: number, x2: number, y2: number, hidden = false): Segment => ({
  a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, hidden,
});

function drawingOf(segments: readonly Segment[]): Drawing2D {
  return {
    config: { ...DEFAULT_SECTION_CONFIG, plane: { axis: 'z', position: 0, flipped: false }, scale: 100 },
    lines: segments.map((s, i) => ({
      line: { start: s.a, end: s.b },
      category: s.hidden ? 'hidden' as const : 'projection' as const,
      visibility: s.hidden ? 'hidden' as const : 'visible' as const,
      entityId: i + 1, ifcType: 'IfcWall', modelIndex: 0, depth: 0,
    })),
    cutPolygons: [], projectionPolygons: [],
    bounds: { min: { x: -5, y: -5 }, max: { x: 15, y: 15 } },
    stats: { cutLineCount: 0, projectionLineCount: segments.length, hiddenLineCount: 0,
      silhouetteLineCount: 0, polygonCount: 0, totalTriangles: 0, processingTimeMs: 0 },
  };
}

function Probe({ drawing, snaps, scale = 50, showHiddenLines = false, contours }: {
  drawing: Drawing2D; snaps: DrawingObjectSnaps; scale?: number; showHiddenLines?: boolean;
  contours?: readonly (readonly Pt[])[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<string>('none');
  const [kind, setKind] = useState<string>('none');
  const { findSnapPoint, snapKindFor } = useMeasure2D({
    drawing, viewTransform: { x: 0, y: 0, scale }, setViewTransform: noop,
    sectionAxis: 'down', containerRef, measure2DMode: false, dimensionType: 'aligned',
    objectSnaps: snaps, showHiddenLines, extraSnapContours: contours,
    setMeasure2DSnapPoint: noop, onCancel: noop, onPlace: noop,
  });
  return <div ref={containerRef} onMouseMove={event => {
    const hit = findSnapPoint({ x: event.clientX / scale, y: event.clientY / scale });
    setPoint(hit ? `${hit.x.toFixed(3)},${hit.y.toFixed(3)}` : 'none');
    setKind(snapKindFor(hit) ?? 'none');
  }}><output data-snap-kind={kind}>{point}</output></div>;
}

function hover(element: HTMLElement, x: number, y: number, scale = 50): string {
  act(() => element.dispatchEvent(new window.MouseEvent('mousemove', {
    bubbles: true, clientX: x * scale, clientY: y * scale,
  })));
  return element.querySelector('output')?.textContent ?? '';
}

afterEach(cleanup);

it('prefers an endpoint to a closer edge, and falls back to nearest once released', () => {
  const canvas = render(<Probe drawing={drawingOf([seg(0, 0, 5, 0)])} snaps={endpoint} />).firstElementChild as HTMLElement;
  assert.equal(hover(canvas, 0.08, 0.02), '0.000,0.000');
  assert.equal(hover(canvas, 0.4, 0.02), '0.400,0.000');
});

it('midpoint is precise when enabled, while the original nearest mode remains available', () => {
  const geometry = drawingOf([seg(0, 0, 4, 0)]);
  const middle = render(<Probe drawing={geometry} snaps={{ ...allOff, midpoint: true, nearest: true }} />).firstElementChild as HTMLElement;
  assert.equal(hover(middle, 2.06, 0.02), '2.000,0.000');
  cleanup();
  const edge = render(<Probe drawing={geometry} snaps={nearest} />).firstElementChild as HTMLElement;
  assert.equal(hover(edge, 2.06, 0.02), '2.060,0.000');
});

it('finds the crossing of two visible segments when Intersection is enabled', () => {
  const geometry = drawingOf([seg(0, 0, 4, 0), seg(2, -2, 2, 2)]);
  const canvas = render(<Probe drawing={geometry} snaps={{ ...allOff, intersection: true, nearest: true }} />).firstElementChild as HTMLElement;
  assert.equal(hover(canvas, 2.05, 0.02), '2.000,0.000');
});

it('holds the same endpoint on alternating one-pixel cursor jitter, then switches deliberately', () => {
  const geometry = drawingOf([seg(0, 0, 0, 4), seg(0.2, 0, 0.2, 4)]);
  const canvas = render(<Probe drawing={geometry} snaps={endpoint} />).firstElementChild as HTMLElement;
  assert.equal(hover(canvas, 0.095, 0.01), '0.000,0.000');
  for (let i = 0; i < 30; i++) {
    assert.equal(hover(canvas, i % 2 ? 0.095 : 0.105, 0.01), '0.000,0.000');
  }
  assert.equal(hover(canvas, 0.28, 0.01), '0.200,0.000');
  assert.equal(hover(canvas, 0.6, 0.01), 'none');
});

it('uses a pixel-based capture radius at different zooms', () => {
  const geometry = drawingOf([seg(0, 0, 5, 0)]);
  for (const scale of [25, 100]) {
    const canvas = render(<Probe drawing={geometry} snaps={{ ...allOff, endpoint: true }} scale={scale} />).firstElementChild as HTMLElement;
    assert.equal(hover(canvas, 10 / scale, 0, scale), '0.000,0.000');
    assert.equal(hover(canvas, 17 / scale, 0, scale), 'none');
    cleanup();
  }
});

it('respects hidden-line visibility, extra room contours and disabled snap switches', () => {
  const hidden = drawingOf([seg(0, 0, 5, 0, true)]);
  const invisible = render(<Probe drawing={hidden} snaps={endpoint} />).firstElementChild as HTMLElement;
  assert.equal(hover(invisible, 0.05, 0), 'none');
  cleanup();
  const visible = render(<Probe drawing={hidden} snaps={endpoint} showHiddenLines />).firstElementChild as HTMLElement;
  assert.equal(hover(visible, 0.05, 0), '0.000,0.000');
  cleanup();
  const room: readonly (readonly Pt[])[] = [[{ x: 9, y: 9 }, { x: 11, y: 9 }, { x: 11, y: 11 }, { x: 9, y: 11 }]];
  const roomCanvas = render(<Probe drawing={drawingOf([])} snaps={nearest} contours={room} />).firstElementChild as HTMLElement;
  assert.equal(hover(roomCanvas, 9.04, 10), '9.000,10.000');
  cleanup();
  const off = render(<Probe drawing={drawingOf([seg(0, 0, 5, 0)])} snaps={allOff} />).firstElementChild as HTMLElement;
  assert.equal(hover(off, 0.01, 0), 'none');
});

it('uses the middle button to pan and never pans with the left button', () => {
  function PanProbe() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState({ x: 0, y: 0, scale: 50 });
    const handlers = useMeasure2D({
      drawing: null, viewTransform: transform, setViewTransform: setTransform,
      sectionAxis: 'down', containerRef, measure2DMode: false,
      dimensionType: 'aligned', setMeasure2DSnapPoint: noop,
      onCancel: noop, onPlace: noop,
    });
    return <div ref={containerRef} data-pan-x={transform.x} data-pan-y={transform.y}
      onMouseDown={handlers.handleMouseDown} onMouseMove={handlers.handleMouseMove}
      onMouseUp={handlers.handleMouseUp} />;
  }
  const canvas = render(<PanProbe />).firstElementChild as HTMLElement;
  function mouse(type: string, button: number, buttons: number, x: number, y: number) {
    act(() => canvas.dispatchEvent(new window.MouseEvent(type, {
      bubbles: true, cancelable: true, button, buttons, clientX: x, clientY: y,
    })));
  }
  mouse('mousedown', 0, 1, 10, 20);
  mouse('mousemove', 0, 1, 40, 25);
  assert.equal(canvas.dataset.panX, '0');
  mouse('mouseup', 0, 0, 40, 25);
  mouse('mousedown', 1, 4, 10, 20);
  mouse('mousemove', 1, 4, 40, 25);
  assert.equal(canvas.dataset.panX, '30');
  assert.equal(canvas.dataset.panY, '5');
});

it('reports the exact snapped target kind to the drawing HUD', () => {
  const geometry = drawingOf([seg(0, 0, 4, 0), seg(2, -2, 2, 2)]);
  for (const [snaps, x, expected] of [
    [{ ...allOff, endpoint: true, nearest: true }, 0.08, 'endpoint'],
    [{ ...allOff, midpoint: true, nearest: true }, 2.08, 'midpoint'],
    [{ ...allOff, intersection: true, nearest: true }, 2.04, 'intersection'],
    [nearest, 1.4, 'edge'],
  ] as const) {
    const canvas = render(<Probe drawing={geometry} snaps={snaps} />).firstElementChild as HTMLElement;
    hover(canvas, x, 0.02);
    assert.equal(canvas.querySelector('output')?.getAttribute('data-snap-kind'), expected);
    cleanup();
  }
});
