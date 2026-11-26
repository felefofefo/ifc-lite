/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { createDrawingModelIndex } from '@/lib/drawing/drawing-model-pick';
import { useViewerStore } from '@/store';
import type { DrawingViewModel } from './useDrawingViewModel';
import { isCanvasWindowAnnotation, selectDrawingAnnotations, selectDrawingSymbols, type WindowDrawingSelection } from './drawing-annotation-window';
import { collectViewMarkers, DEFAULT_VIEW_MARKERS } from '@/lib/drawing/view-markers';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export type DrawingCycleTarget = WindowDrawingSelection | { type: 'ifc'; id: number };

import type { SelectedAnnotation2D } from '@/store/slices/drawing2DSlice';

const PICK_RADIUS_PX = 6;
const DRAG_THRESHOLD_PX = 4;

export function useDrawingModelSelection(vm: DrawingViewModel, enabled: boolean, allowAnnotationWindow = true) {
  const { drawing, markupTransform, drawnPlane, displayOptions } = vm;
  const index = useMemo(() => drawing ? createDrawingModelIndex(drawing, displayOptions.showHiddenLines) : null,
    [drawing, displayOptions.showHiddenLines]);
  const primary = useViewerStore(s => s.selectedEntityId);
  const selectedIds = useViewerStore(s => s.selectedEntityIds);
  const [hover, setHover] = useState<number>();
  const [annotationHover, setAnnotationHover] = useState<SelectedAnnotation2D | null>(null);
  const annotationEnabled = vm.status === 'ready' && vm.annotation2DActiveTool === 'none'
    && !vm.textAnnotation2DEditing && !vm.tags.active && vm.displayOptions.showAnnotations;
  const annotationWindowEnabled = allowAnnotationWindow && annotationEnabled && !vm.editableAnnotationId;
  const windowEnabled = !vm.editableAnnotationId && (enabled || annotationWindowEnabled);
  const [cycleTarget, setCycleTarget] = useState<DrawingCycleTarget | null>(null);
  const cycle = useRef<{ target: DrawingCycleTarget; origin: Point2D } | null>(null);
  const pointer = useRef<{ point: Point2D; symbol?: string } | null>(null);
  const suppressCycleClick = useRef(false);

  function resetCycle() {
    cycle.current = null;
    setCycleTarget(null);
  }
  const press = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const suppressClick = useRef(false);

  function clearHover() {
    resetCycle();
    setHover(undefined);
    setAnnotationHover(null);
  }

  useEffect(() => {
    cycle.current = null;
    pointer.current = null;
    setCycleTarget(null);
    suppressCycleClick.current = false;
    press.current = null;
    setSelectionBox(null);
    suppressClick.current = false;
    setHover(undefined);
    setAnnotationHover(null);
  }, [enabled, annotationEnabled, windowEnabled, index, drawnPlane.id, markupTransform.x, markupTransform.y, markupTransform.scale]);

  const { x, y, scale } = markupTransform;
  const sx = drawnPlane.axis === 'side' ? -scale : scale;
  const sy = drawnPlane.axis === 'down' ? scale : -scale;

  function canvasPoint(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left - x) / sx, y: (event.clientY - rect.top - y) / sy };
  }

  function screenPoint(clientX: number, clientY: number): Point2D {
    const rect = vm.containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }

  function boxToModel(point: Point2D): Point2D {
    return { x: (point.x - x) / sx, y: (point.y - y) / sy };
  }

  useEffect(() => {
    const doc = vm.containerRef.current?.ownerDocument;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !press.current?.dragged) return;
      press.current = null;
      suppressClick.current = true;
      setSelectionBox(null);
    };
    doc?.addEventListener('keydown', cancel);
    return () => doc?.removeEventListener('keydown', cancel);
  }, [vm.containerRef]);

  function pick(event: MouseEvent<HTMLDivElement>) {
    if (!index || !(scale > 0)) return undefined;
    return index.pick(canvasPoint(event), PICK_RADIUS_PX / scale)[0];
  }

  function candidateKey(item: DrawingCycleTarget): string {
    if (item.type === 'measure') {
      const chain = vm.displayedMeasurements.find(result => result.id === item.id)?.dimension?.chainId;
      if (chain) return `chain:${chain}`;
    }
    return `${item.type}:${item.id}`;
  }

  // Build the candidate list on Tab, not on every pointer move. Reuse the
  // existing window/crossing geometry and the IFC spatial index.
  function cycleCandidates(at: { point: Point2D; symbol?: string }): DrawingCycleTarget[] {
    const { point, symbol } = at;
    const r = PICK_RADIUS_PX;
    const a = { x: point.x + r, y: point.y - r }, b = { x: point.x - r, y: point.y + r };
    const annotations = annotationWindowEnabled ? selectDrawingAnnotations(vm, a, b).reverse() : [];
    const symbols = annotationWindowEnabled ? selectDrawingSymbols(vm.containerRef.current, a, b).reverse() : [];
    const direct = annotationWindowEnabled ? vm.hitTestAnnotations(point.x, point.y) : null;
    // Normal click precedence: actual SVG hit, canvas annotation, then IFC.
    // A dimension label is a separate editing target on normal clicks only.
    const preferred = symbol ? symbols.find(item => candidateKey(item) === symbol)
      : direct ? annotations.find(item => candidateKey(item) === candidateKey(direct)) : undefined;
    const ifc: DrawingCycleTarget[] = enabled && !vm.tags.active && index && scale > 0
      ? index.pick(boxToModel(point), r / scale).map(id => ({ type: 'ifc', id })) : [];
    const list: DrawingCycleTarget[] = [...(preferred ? [preferred] : []), ...symbols, ...annotations, ...ifc];
    const seen = new Set<string>();
    return list.filter(item => {
      const key = candidateKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function confirmCycle(item: DrawingCycleTarget) {
    const state = useViewerStore.getState();
    // Resolve a marker before clearing the old selection, in case it vanished.
    const saved = useSavedSectionCuts.getState();
    const bounds = vm.runtime.geometryResult?.coordinateInfo.shiftedBounds;
    const marker = item.type === 'marker' && bounds && drawnPlane.axis === 'down' && !drawnPlane.custom
      ? collectViewMarkers(saved.cuts, bounds, drawnPlane.flipped, DEFAULT_VIEW_MARKERS).find(mark => mark.id === item.id) : undefined;
    if (item.type === 'marker' && !marker) return;
    if (item.type === 'tag' && !vm.tags.items.some(entry => entry.tag.id === item.id)) return;
    vm.clearWindowAnnotations();
    vm.clearAnnotationSelection();
    vm.tags.clearSelection();
    vm.setSelectedMarker(null);
    state.clearEntitySelection();
    if (item.type === 'ifc') state.setSelectedEntityId(item.id);
    else if (item.type === 'tag') vm.tags.selectById(item.id);
    else if (item.type === 'marker' && marker) {
      const dx = marker.end.x - marker.start.x, dy = marker.end.y - marker.start.y;
      vm.setSelectedMarker({ id: marker.id, start: marker.start, end: marker.end,
        reverse: -dy * marker.direction.x + dx * marker.direction.y < 0,
        distant: saved.cuts.find(view => view.id === marker.id)?.display?.distantElements });
    } else if (isCanvasWindowAnnotation(item)) state.setSelectedAnnotation2D(item);
  }

  useEffect(() => {
    if (!windowEnabled || vm.tags.active) return;
    const doc = vm.containerRef.current?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { resetCycle(); return; }
      const focus = doc.activeElement;
      const at = pointer.current;
      if (event.defaultPrevented || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey
        || !at || press.current || (focus !== doc.body && focus !== vm.containerRef.current)) return;
      const list = cycleCandidates(at);
      if (list.length < 2) { resetCycle(); return; }
      event.preventDefault();
      const current = cycle.current;
      const currentIndex = current ? list.findIndex(item => candidateKey(item) === candidateKey(current.target)) : 0;
      const index = currentIndex < 0 ? 0 : currentIndex;
      const target = list[(index + (event.shiftKey ? -1 : 1) + list.length) % list.length];
      cycle.current = { target, origin: at.point };
      setCycleTarget(target);
    }
    view.addEventListener('keydown', keydown);
    return () => view.removeEventListener('keydown', keydown);
  });

  const mouse = vm.canvasMouseHandlers;
  const isCanvas = (event: MouseEvent<HTMLDivElement>) => (event.target as Element).tagName === 'CANVAS';
  function finishWindow(event: MouseEvent<HTMLDivElement>) {
    mouse.onMouseUp(event);
    const down = press.current;
    if (event.button !== 0 || !down) return;
    if (!down.dragged && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= DRAG_THRESHOLD_PX) return;
    press.current = null;
    suppressClick.current = true;
    setSelectionBox(null);
    clearHover();
    if (!windowEnabled || !(scale > 0)) return;
    const start = screenPoint(down.x, down.y);
    const end = screenPoint(event.clientX, event.clientY);
    const picked = enabled && index ? index.selectBox(boxToModel(start), boxToModel(end), end.x < start.x) : [];
    const annotations = annotationWindowEnabled ? [
      ...selectDrawingAnnotations(vm, start, end),
      ...selectDrawingSymbols(vm.containerRef.current, start, end),
    ] : [];
    const state = useViewerStore.getState();
    state.clearEntitySelection();
    state.setSelectedEntityIds(picked);
    vm.selectWindowAnnotations(annotations);
  }

  const surfaceSymbol = (target: EventTarget) => (target as Element).closest<SVGGElement>('[data-window-symbol]');
  const onSurface = (event: MouseEvent<HTMLDivElement>) => isCanvas(event) || !!surfaceSymbol(event.target);
  const mouseHandlers = {
    ...mouse,
    // SVG symbols can own pointerdown for dragging; intercept only an active
    // Tab cycle so the normal click/drag path remains unchanged otherwise.
    onPointerDownCapture(event: React.PointerEvent<HTMLDivElement>) {
      suppressCycleClick.current = false;
      if (event.button === 0 && cycle.current && onSurface(event)) event.stopPropagation();
    },
    onMouseDownCapture(event: MouseEvent<HTMLDivElement>) {
      const current = cycle.current;
      if (!current || event.button !== 0 || !onSurface(event)) return;
      const point = screenPoint(event.clientX, event.clientY);
      if (Math.hypot(point.x - current.origin.x, point.y - current.origin.y) > DRAG_THRESHOLD_PX) { resetCycle(); return; }
      event.preventDefault();
      event.stopPropagation();
      press.current = null;
      suppressClick.current = false;
      suppressCycleClick.current = true;
      confirmCycle(current.target);
      clearHover();
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!suppressCycleClick.current) return;
      suppressCycleClick.current = false;
      event.stopPropagation();
    },
    onMouseDown(event: MouseEvent<HTMLDivElement>) {
      suppressClick.current = false;
      setSelectionBox(null);
      if (event.button === 0 && isCanvas(event)) vm.clearWindowAnnotations();
      const consumed = mouse.onMouseDown(event);
      press.current = windowEnabled && !vm.tags.active && isCanvas(event) && event.button === 0 && !consumed
        ? { x: event.clientX, y: event.clientY, dragged: false } : null;
      if (!press.current) clearHover();
    },
    onMouseMoveCapture(event: MouseEvent<HTMLDivElement>) {
      if (event.buttons || !onSurface(event)) {
        pointer.current = null;
        if (!isCanvas(event)) clearHover();
        return;
      }
      const point = screenPoint(event.clientX, event.clientY);
      const group = surfaceSymbol(event.target);
      const type = group?.dataset.windowSymbol, id = group?.dataset.windowId;
      pointer.current = { point, symbol: type && id ? `${type}:${id}` : undefined };
      const current = cycle.current;
      if (current && Math.hypot(point.x - current.origin.x, point.y - current.origin.y) > DRAG_THRESHOLD_PX) resetCycle();
      if (!isCanvas(event) && !cycle.current) clearHover();
    },
    onMouseMove(event: MouseEvent<HTMLDivElement>) {
      mouse.onMouseMove(event);
      const down = press.current;
      if (down && event.buttons === 1) {
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_THRESHOLD_PX) down.dragged = true;
        if (down.dragged) {
          clearHover();
          setSelectionBox({ start: screenPoint(down.x, down.y), end: screenPoint(event.clientX, event.clientY) });
        }
        return;
      }
      if (down && event.buttons !== 1) {
        if (down.dragged) suppressClick.current = true;
        press.current = null;
        setSelectionBox(null);
      }
      if (cycle.current && !event.buttons && onSurface(event)) return;
      if (!isCanvas(event) || event.buttons) {
        clearHover();
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const hit = annotationEnabled ? vm.hitTestAnnotations(event.clientX - rect.left, event.clientY - rect.top) : null;
      setAnnotationHover(previous => previous?.id === hit?.id && previous?.type === hit?.type
        && previous?.dimensionLabel === hit?.dimensionLabel ? previous : hit);
      if (hit) {
        setHover(undefined);
      } else if (enabled) setHover(pick(event));
      else clearHover();
    },
    onMouseUpCapture(event: MouseEvent<HTMLDivElement>) {
      const down = press.current;
      if (isCanvas(event) || event.button !== 0 || !down || !down.dragged) return;
      event.stopPropagation();
      finishWindow(event);
    },
    onMouseUp(event: MouseEvent<HTMLDivElement>) {
      finishWindow(event);
    },
    onMouseLeave() {
      pointer.current = null;
      mouse.onMouseLeave();
      if (press.current?.dragged) suppressClick.current = true;
      press.current = null;
      setSelectionBox(null);
      clearHover();
    },
    onClick(event: MouseEvent<HTMLDivElement>) {
      if (suppressClick.current) { suppressClick.current = false; return; }
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

  const previewIfc = cycleTarget ? (cycleTarget.type === 'ifc' ? cycleTarget.id : undefined) : hover;
  const previewAnnotation = cycleTarget ? (cycleTarget.type !== 'ifc' && isCanvasWindowAnnotation(cycleTarget) ? cycleTarget : null) : annotationHover;
  return {
    mouseHandlers,
    cycleTarget,
    annotationHover: annotationEnabled ? previewAnnotation : null,
    overlay: (index && (ids.size > 0 || (enabled && previewIfc !== undefined))) || (windowEnabled && selectionBox) ? (
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
        {Array.from(ids, id => highlight(id, false))}
        {enabled && previewIfc !== undefined && !ids.has(previewIfc) && highlight(previewIfc, true)}
        {windowEnabled && selectionBox && <rect data-drawing-selection-box
          x={Math.min(selectionBox.start.x, selectionBox.end.x)} y={Math.min(selectionBox.start.y, selectionBox.end.y)}
          width={Math.abs(selectionBox.end.x - selectionBox.start.x)} height={Math.abs(selectionBox.end.y - selectionBox.start.y)}
          className={selectionBox.end.x < selectionBox.start.x ? 'text-green-600' : 'text-primary'}
          fill="currentColor" fillOpacity={0.09} stroke="currentColor" strokeWidth={1}
          strokeDasharray={selectionBox.end.x < selectionBox.start.x ? '5 3' : undefined} />}
      </svg>
    ) : null,
  };
}
