/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { createDrawingModelIndex } from '@/lib/drawing/drawing-model-pick';
import { useViewerStore } from '@/store';
import type { DrawingViewModel } from './useDrawingViewModel';

const PICK_RADIUS_PX = 6;
const DRAG_THRESHOLD_PX = 4;

export function useDrawingModelSelection(vm: DrawingViewModel, enabled: boolean) {
  const { drawing, markupTransform, drawnPlane, displayOptions } = vm;
  const index = useMemo(() => drawing ? createDrawingModelIndex(drawing, displayOptions.showHiddenLines) : null,
    [drawing, displayOptions.showHiddenLines]);
  const primary = useViewerStore(s => s.selectedEntityId);
  const selectedIds = useViewerStore(s => s.selectedEntityIds);
  const [hover, setHover] = useState<number>();
  const candidates = useRef<number[]>([]);
  const cycled = useRef<number | undefined>(undefined);
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  function clearHover() {
    candidates.current = [];
    cycled.current = undefined;
    setHover(undefined);
  }

  useEffect(() => {
    candidates.current = [];
    cycled.current = undefined;
    press.current = null;
    setHover(undefined);
  }, [enabled, index, drawnPlane.id]);

  useEffect(() => {
    if (!enabled) return;
    const doc = vm.containerRef.current?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    function keydown(event: KeyboardEvent) {
      const list = candidates.current;
      const focus = doc.activeElement;
      // Preserve ordinary Tab navigation across controls and editors.
      if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey
        || list.length < 2 || (focus !== doc.body && focus !== vm.containerRef.current)) return;
      event.preventDefault();
      const current = cycled.current === undefined ? 0 : list.indexOf(cycled.current);
      const next = list[(current + (event.shiftKey ? -1 : 1) + list.length) % list.length];
      cycled.current = next;
      setHover(next);
    }
    view.addEventListener('keydown', keydown);
    return () => view.removeEventListener('keydown', keydown);
  }, [enabled, vm.containerRef]);

  const { x, y, scale } = markupTransform;
  const sx = drawnPlane.axis === 'side' ? -scale : scale;
  const sy = drawnPlane.axis === 'down' ? scale : -scale;

  function canvasPoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - x) / sx, y: (event.clientY - rect.top - y) / sy };
  }

  function pick(event: MouseEvent<HTMLDivElement>) {
    if (!index || !(scale > 0)) return undefined;
    const list = index.pick(canvasPoint(event), PICK_RADIUS_PX / scale);
    const manual = cycled.current;
    if (manual !== undefined && !list.includes(manual)) cycled.current = undefined;
    candidates.current = list;
    return cycled.current ?? list[0];
  }

  const mouse = vm.canvasMouseHandlers;
  const isCanvas = (event: MouseEvent<HTMLDivElement>) => (event.target as Element).tagName === 'CANVAS';
  const mouseHandlers = {
    ...mouse,
    onMouseDown(event: MouseEvent<HTMLDivElement>) {
      const consumed = mouse.onMouseDown(event);
      press.current = enabled && isCanvas(event) && event.button === 0 && !consumed
        ? { x: event.clientX, y: event.clientY, dragged: false } : null;
      if (!press.current) clearHover();
    },
    onMouseMoveCapture(event: MouseEvent<HTMLDivElement>) {
      if (!isCanvas(event) && candidates.current.length) clearHover();
    },
    onMouseMove(event: MouseEvent<HTMLDivElement>) {
      mouse.onMouseMove(event);
      const down = press.current;
      if (down && (event.buttons & 1) && Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_THRESHOLD_PX) {
        down.dragged = true;
      }
      if (event.buttons === 1 && down && !down.dragged) return;
      if (!enabled || !isCanvas(event) || event.buttons) {
        clearHover();
        return;
      }
      setHover(pick(event));
    },
    onMouseLeave() {
      mouse.onMouseLeave();
      press.current = null;
      clearHover();
    },
    onClick(event: MouseEvent<HTMLDivElement>) {
      const down = press.current;
      press.current = null;
      if (!enabled || !isCanvas(event) || event.button !== 0 || !down || down.dragged
        || Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_THRESHOLD_PX) {
        mouse.onClick(event);
        return;
      }
      const id = pick(event);
      const state = useViewerStore.getState();
      state.clearEntitySelection();
      if (id !== undefined) state.setSelectedEntityId(id);
      // Clicking consumes the cycle; the next hover starts with its nearest candidate.
      clearHover();
    },
  };

  const ids = useMemo(() => new Set(primary === null ? selectedIds : [...selectedIds, primary]), [primary, selectedIds]);
  const toScreen = (point: Point2D) => `${point.x * sx + x},${point.y * sy + y}`;
  const path = (points: readonly Point2D[]) => points.length ? `M${points.map(toScreen).join('L')}Z` : '';

  function highlight(id: number, preview: boolean) {
    const shape = index?.byId.get(id);
    if (!shape) return null;
    return <g key={id} data-drawing-model-highlight={preview ? 'preview' : 'selected'}
      className="text-primary" opacity={preview ? 0.55 : 1}>
      {shape.faces.map((face, i) => {
        const d = [face.polygon.outer, ...face.polygon.holes].map(path).join('');
        return <path key={i} d={d} fill="currentColor" fillOpacity={0.18} fillRule="evenodd"
          stroke={face.isCut && !face.cutOutline ? 'currentColor' : undefined} strokeWidth={2} />;
      })}
      <path d={[...shape.lines.map(line => line.line), ...shape.faces.flatMap(face => face.cutOutline ?? [])]
        .map(line => `M${toScreen(line.start)}L${toScreen(line.end)}`).join('')}
        fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </g>;
  }

  return {
    mouseHandlers,
    overlay: index && (ids.size > 0 || (enabled && hover !== undefined)) ? (
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
        {Array.from(ids, id => highlight(id, false))}
        {enabled && hover !== undefined && !ids.has(hover) && highlight(hover, true)}
      </svg>
    ) : null,
  };
}
