/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, useRef, useState } from 'react';
import { cleanup, render } from '@/test/render.js';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { useAnnotation2D } from './useAnnotation2D.js';

const placed: Point2D[] = [];
const noop = () => {};

function AreaProbe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tool = useAnnotation2D({
    drawing: null, viewTransform: { x: 0, y: 0, scale: 1 }, sectionAxis: 'down', containerRef,
    activeTool: 'polygon-area', setActiveTool: noop,
    polygonArea2DPoints: [], addPolygonArea2DPoint: point => placed.push(point),
    completePolygonArea2D: noop, cancelPolygonArea2D: noop,
    textAnnotations2D: [], addTextAnnotation2D: noop, setTextAnnotation2DEditing: noop,
    cloudAnnotation2DPoints: [], cloudAnnotations2D: [], addCloudAnnotation2DPoint: noop,
    completeCloudAnnotation2D: noop, cancelCloudAnnotation2D: noop,
    measure2DResults: [], polygonArea2DResults: [], selectedAnnotation2D: null,
    setSelectedAnnotation2D: noop, moveAnnotation2D: noop,
    snapForDrag: () => ({ x: 9, y: 10 }),
    setAnnotation2DCursorPos: noop, setMeasure2DSnapPoint: noop,
  });
  return <div ref={containerRef} onMouseDown={tool.handleMouseDown} />;
}

afterEach(() => { cleanup(); placed.length = 0; });

function AngleAreaProbe({ angle }: { angle: 'off' | '15' | '90' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point2D[]>([]);
  const [preview, setPreview] = useState<Point2D | null>(null);
  const tool = useAnnotation2D({
    drawing: null, viewTransform: { x: 0, y: 0, scale: 100 }, sectionAxis: 'down', containerRef,
    activeTool: 'polygon-area', setActiveTool: noop, angularSnap: angle,
    polygonArea2DPoints: points, addPolygonArea2DPoint: point => setPoints(previous => [...previous, point]),
    completePolygonArea2D: noop, cancelPolygonArea2D: noop,
    textAnnotations2D: [], addTextAnnotation2D: noop, setTextAnnotation2DEditing: noop,
    cloudAnnotation2DPoints: [], cloudAnnotations2D: [], addCloudAnnotation2DPoint: noop,
    completeCloudAnnotation2D: noop, cancelCloudAnnotation2D: noop,
    measure2DResults: [], polygonArea2DResults: [], selectedAnnotation2D: null,
    setSelectedAnnotation2D: noop, moveAnnotation2D: noop,
    snapForDrag: () => null, setAnnotation2DCursorPos: setPreview, setMeasure2DSnapPoint: noop,
  });
  return <div ref={containerRef} onMouseDown={tool.handleMouseDown} onMouseMove={tool.handleMouseMove}
    data-points={JSON.stringify(points)} data-preview={JSON.stringify(preview)} />;
}

it('uses the same 15 degree angle constraint while drawing an area', () => {
  const canvas = render(<AngleAreaProbe angle="15" />).firstElementChild as HTMLElement;
  act(() => canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 0, clientY: 0 })));
  act(() => canvas.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 30 })));
  const point = JSON.parse(canvas.dataset.preview ?? 'null') as Point2D;
  assert.ok(Math.abs(Math.atan2(point.y, point.x) * 180 / Math.PI - 15) < 1e-7);
});

it('snaps to earlier vertices of the area being drawn', () => {
  const canvas = render(<AngleAreaProbe angle="off" />).firstElementChild as HTMLElement;
  for (const [x, y] of [[0, 0], [100, 0], [100, 100]]) {
    act(() => canvas.dispatchEvent(new window.MouseEvent('mousedown', { button: 0, bubbles: true, clientX: x, clientY: y })));
  }
  act(() => canvas.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 102, clientY: 1 })));
  assert.deepEqual(JSON.parse(canvas.dataset.preview ?? 'null'), { x: 1, y: 0 });
});

it('places Area vertices at the shared snapped point instead of raw cursor coordinates', () => {
  const canvas = render(<AreaProbe />).firstElementChild as HTMLElement;
  act(() => canvas.dispatchEvent(new window.MouseEvent('mousedown', {
    button: 0, clientX: 9.04, clientY: 10, bubbles: true,
  })));
  assert.deepEqual(placed, [{ x: 9, y: 10 }]);
});
