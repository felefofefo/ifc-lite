/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for 2D annotation tools (polygon area, text, cloud) and
 * annotation selection/drag/delete.
 *
 * The existing useMeasure2D hook continues to handle linear distance
 * measurements and panning.
 */

import { useCallback, useEffect, useRef } from 'react';
import { registerKeyboardCommand, registerKeyboardKeyUp } from '@/lib/commands/dispatcher';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { snapDrawingAngle } from '@/lib/drawing/dimension-line';
import type {
  Annotation2DTool, Point2D, TextAnnotation2D,
  SelectedAnnotation2D, Measure2DResult, PolygonArea2DResult, CloudAnnotation2D,
} from '@/store/slices/drawing2DSlice';
import { computePolygonArea, computePolygonPerimeter } from '@/components/viewer/tools/computePolygonArea';
import { nearestPointOnSegment, hitTestAnnotations as hitTestAnnotationsPure } from '@/hooks/annotation2DHitTest';
import { useDrawingDirection } from '@/hooks/useDrawingDirection';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface UseAnnotation2DParams {
  drawing: Drawing2D | null;
  viewTransform: { x: number; y: number; scale: number };
  sectionAxis: 'down' | 'front' | 'side';
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Same paper-unit conversion used by Drawing2DCanvas for text styles. */
  paperUnit?: number;
  activeTool: Annotation2DTool;
  setActiveTool: (tool: Annotation2DTool) => void;
  // Polygon area state
  polygonArea2DPoints: Point2D[];
  /** Respect the Endpoint switch for draft polygon vertices. */
  areaEndpointSnaps?: boolean;
  addPolygonArea2DPoint: (pt: Point2D) => void;
  completePolygonArea2D: (area: number, perimeter: number) => void;
  cancelPolygonArea2D: () => void;
  // Text state
  textAnnotations2D: TextAnnotation2D[];
  addTextAnnotation2D: (annotation: TextAnnotation2D) => void;
  setTextAnnotation2DEditing: (id: string | null) => void;
  // Cloud state
  cloudAnnotation2DPoints: Point2D[];
  cloudAnnotations2D: CloudAnnotation2D[];
  addCloudAnnotation2DPoint: (pt: Point2D) => void;
  completeCloudAnnotation2D: (label?: string) => void;
  cancelCloudAnnotation2D: () => void;
  // Completed results (for hit testing)
  measure2DResults: Measure2DResult[];
  polygonArea2DResults: PolygonArea2DResult[];
  // Selection
  selectedAnnotation2D: SelectedAnnotation2D | null;
  /** Editing/dragging is opt-in. The first click only selects. */
  editableAnnotationId?: string | null;
  snapForDrag?: (point: Point2D) => Point2D | null;
  angularSnap?: 'off' | '15' | '90';
  pickDimensionLabel?: (x: number, y: number) => string | undefined;
  setSelectedAnnotation2D: (sel: SelectedAnnotation2D | null) => void;
  moveAnnotation2D: (sel: SelectedAnnotation2D, newOrigin: Point2D) => void;
  // Cursor and snap
  setAnnotation2DCursorPos: (pos: Point2D | null) => void;
  setMeasure2DSnapPoint: (pt: Point2D | null) => void;
}

export interface UseAnnotation2DResult {
  hitTestAnnotations: (screenX: number, screenY: number) => SelectedAnnotation2D | null;
  /** Returns true if the click hit an annotation (consumed the event). */
  handleMouseDown: (e: React.MouseEvent) => boolean;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: (e: React.MouseEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  /** Ref that is true while an annotation drag is in progress (read at call time). */
  isDraggingRef: React.RefObject<boolean>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CLOSE_POLYGON_THRESHOLD_PX = 12;
const HIT_TEST_RADIUS_PX = 10;

// ─── Hook implementation ────────────────────────────────────────────────────

export function useAnnotation2D({
  drawing,
  viewTransform,
  sectionAxis,
  containerRef,
  paperUnit = 1,
  activeTool,
  setActiveTool,
  polygonArea2DPoints,
  areaEndpointSnaps = true,
  addPolygonArea2DPoint,
  completePolygonArea2D,
  cancelPolygonArea2D,
  textAnnotations2D,
  addTextAnnotation2D,
  setTextAnnotation2DEditing,
  cloudAnnotation2DPoints,
  cloudAnnotations2D,
  addCloudAnnotation2DPoint,
  completeCloudAnnotation2D,
  cancelCloudAnnotation2D,
  measure2DResults,
  polygonArea2DResults,
  pickDimensionLabel,
  selectedAnnotation2D,
  editableAnnotationId,
  snapForDrag,
  angularSnap = 'off',
  setSelectedAnnotation2D,
  moveAnnotation2D,
  setAnnotation2DCursorPos,
  setMeasure2DSnapPoint,
}: UseAnnotation2DParams): UseAnnotation2DResult {

  const shiftHeldRef = useRef(false);

  // ── Ephemeral drag state as refs (no store churn during drag) ──────────
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef<Point2D | null>(null);
  const dragAnchorRef = useRef<Point2D | null>(null);
  // Keep a stable ref to the latest store mutators to avoid stale closures
  const storeRef = useRef({
    measure2DResults,
    polygonArea2DResults,
    textAnnotations2D,
    cloudAnnotations2D,
    selectedAnnotation2D,
  });
  storeRef.current = {
    measure2DResults,
    polygonArea2DResults,
    textAnnotations2D,
    cloudAnnotations2D,
    selectedAnnotation2D,
  };

  // ── Coordinate conversion (depends on individual primitives, not object) ─

  const scaleRef = useRef(viewTransform.scale);
  const txRef = useRef(viewTransform.x);
  const tyRef = useRef(viewTransform.y);
  const axisRef = useRef(sectionAxis);
  scaleRef.current = viewTransform.scale;
  txRef.current = viewTransform.x;
  tyRef.current = viewTransform.y;
  axisRef.current = sectionAxis;

  /** Convert screen px to drawing coords. Uses refs so it never goes stale. */
  const screenToDrawing = useCallback((screenX: number, screenY: number): Point2D => {
    const axis = axisRef.current;
    const scaleX = axis === 'side' ? -scaleRef.current : scaleRef.current;
    const scaleY = axis !== 'down' ? -scaleRef.current : scaleRef.current;
    return {
      x: (screenX - txRef.current) / scaleX,
      y: (screenY - tyRef.current) / scaleY,
    };
  }, []); // stable — reads from refs

  /** Convert drawing coords to screen px. */
  const drawingToScreen = useCallback((pt: Point2D): { x: number; y: number } => {
    const axis = axisRef.current;
    const scaleX = axis === 'side' ? -scaleRef.current : scaleRef.current;
    const scaleY = axis === 'down' ? scaleRef.current : -scaleRef.current;
    return {
      x: pt.x * scaleX + txRef.current,
      y: pt.y * scaleY + tyRef.current,
    };
  }, []); // stable

  // ── Orthogonal constraint (shift held) ────────────────────────────────

  const applyShiftConstraint = useCallback((anchor: Point2D, point: Point2D): Point2D => {
    const dx = Math.abs(point.x - anchor.x);
    const dy = Math.abs(point.y - anchor.y);
    return dx > dy ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
  }, []);

  // ── Snap point detection ──────────────────────────────────────────────

  const findSnapPoint = useCallback((drawingCoord: Point2D): Point2D | null => {
    // Respect shared Object Snap switches; preserve fallback for isolated hook uses.
    if (snapForDrag) return snapForDrag(drawingCoord);
    if (!drawing) return null;
    const snapThreshold = 10 / scaleRef.current;
    let bestSnap: Point2D | null = null;
    let bestDist = snapThreshold;

    // Check vertices first (early return on close match)
    for (const polygon of drawing.cutPolygons) {
      for (const pt of polygon.polygon.outer) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
      }
      for (const hole of polygon.polygon.holes) {
        for (const pt of hole) {
          const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
          if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
        }
      }
    }
    for (const line of drawing.lines) {
      for (const pt of [line.line.start, line.line.end]) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) return { x: pt.x, y: pt.y };
      }
    }

    // Then check edge proximity
    for (const polygon of drawing.cutPolygons) {
      const outer = polygon.polygon.outer;
      for (let i = 0; i < outer.length; i++) {
        const { point, dist } = nearestPointOnSegment(drawingCoord, outer[i], outer[(i + 1) % outer.length]);
        if (dist < bestDist) { bestDist = dist; bestSnap = point; }
      }
      for (const hole of polygon.polygon.holes) {
        for (let i = 0; i < hole.length; i++) {
          const { point, dist } = nearestPointOnSegment(drawingCoord, hole[i], hole[(i + 1) % hole.length]);
          if (dist < bestDist) { bestDist = dist; bestSnap = point; }
        }
      }
    }
    for (const line of drawing.lines) {
      const { point, dist } = nearestPointOnSegment(drawingCoord, line.line.start, line.line.end);
      if (dist < bestDist) { bestDist = dist; bestSnap = point; }
    }

    return bestSnap;
  }, [drawing, snapForDrag]);

  // ── Hit-testing for annotation selection ──────────────────────────────

  // One measuring context per mounted drawing; actual glyph widths match canvas painting.
  const textMeasureContext = useRef<CanvasRenderingContext2D | null>(null);
  const measureAnnotationText = useCallback((text: string, font: string): number | undefined => {
    let ctx = textMeasureContext.current;
    if (!ctx) {
      ctx = containerRef.current?.ownerDocument.createElement('canvas').getContext('2d') ?? null;
      if (!ctx) return undefined; // Non-canvas environments use the layout's size-aware fallback.
      textMeasureContext.current = ctx;
    }
    ctx.font = font;
    return ctx.measureText(text).width;
  }, [containerRef]);

  const hitTestAnnotations = useCallback((screenX: number, screenY: number): SelectedAnnotation2D | null => {
    const { textAnnotations2D: texts, cloudAnnotations2D: clouds,
      polygonArea2DResults: polys, measure2DResults: measures } = storeRef.current;
    const label = pickDimensionLabel?.(screenX, screenY);
    if (label) return { type: 'measure', id: label, dimensionLabel: true };
    return hitTestAnnotationsPure({
      screenX, screenY, threshold: HIT_TEST_RADIUS_PX, drawingToScreen,
      texts, clouds, polys, measures, paperUnit, measureText: measureAnnotationText,
    });
  }, [drawingToScreen, pickDimensionLabel, paperUnit, measureAnnotationText]); // reads annotation data from storeRef

  // ── Get annotation origin (reads latest data from refs) ───────────────

  const getAnnotationOrigin = useCallback((sel: SelectedAnnotation2D): Point2D | null => {
    const s = storeRef.current;
    switch (sel.type) {
      case 'measure': {
        const result = s.measure2DResults.find((m) => m.id === sel.id);
        if (!result) return null;
        return sel.dimensionLabel
          ? result.dimension?.textOffset ?? { x: 0, y: 0 }
          : result.dimension?.shape?.label ?? result.start;
      }
      case 'polygon': { const r = s.polygonArea2DResults.find((p) => p.id === sel.id); return r?.points[0] ?? null; }
      case 'text': { const a = s.textAnnotations2D.find((t) => t.id === sel.id); return a ? a.position : null; }
      case 'cloud': { const c = s.cloudAnnotations2D.find((cl) => cl.id === sel.id); return c?.points[0] ?? null; }
    }
    return null;
  }, []);

  // ── Commit drag position to store (stable via ref) ─────────────────

  const moveAnnotationRef = useRef(moveAnnotation2D);
  moveAnnotationRef.current = moveAnnotation2D;

  const commitDragPosition = useCallback((sel: SelectedAnnotation2D, newOrigin: Point2D) => {
    moveAnnotationRef.current(sel, newOrigin);
  }, []);

  const isNearFirstVertex = useCallback((drawingCoord: Point2D): boolean => {
    if (polygonArea2DPoints.length < 3) return false;
    const first = polygonArea2DPoints[0];
    const threshold = CLOSE_POLYGON_THRESHOLD_PX / scaleRef.current;
    const dx = drawingCoord.x - first.x;
    const dy = drawingCoord.y - first.y;
    return Math.sqrt(dx * dx + dy * dy) < threshold;
  }, [polygonArea2DPoints]);

  const { resolve: resolveAreaDirection } = useDrawingDirection(
    activeTool === 'polygon-area' && polygonArea2DPoints.length ? 'drawing-area' : null, angularSnap);

  function resolveAreaPoint(raw: Point2D, shift: boolean): { point: Point2D; reference: Point2D | null } {
    const anchor = polygonArea2DPoints[polygonArea2DPoints.length - 1] ?? null;
    // Closure wins even when the closing edge is not an angular increment.
    if (isNearFirstVertex(raw)) {
      const first = polygonArea2DPoints[0];
      return { point: first, reference: first };
    }
    let own: Point2D | null = null;
    if (areaEndpointSnaps && polygonArea2DPoints.length > 2 && scaleRef.current > 0) {
      let closest = CLOSE_POLYGON_THRESHOLD_PX / scaleRef.current;
      // Do not re-snap to the last point and create a zero-length edge.
      for (let i = 1; i < polygonArea2DPoints.length - 1; i++) {
        const vertex = polygonArea2DPoints[i];
        const distance = Math.hypot(vertex.x - raw.x, vertex.y - raw.y);
        if (distance < closest) { closest = distance; own = vertex; }
      }
    }
    const reference = own ?? findSnapPoint(raw);
    const directed = resolveAreaDirection(anchor, raw, reference, shift);
    const point = directed ?? reference ?? (shift && anchor ? applyShiftConstraint(anchor, raw) : raw);
    return { point, reference: reference ?? (directed && angularSnap !== 'off' ? directed : null) };
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────

  useEffect(() => {
    const removeShift = registerKeyboardCommand('drawing2d.orthogonal', () => {
      shiftHeldRef.current = true;
      return false; // Measurement observes the same modifier.
    }, { ignoreModifiers: true, allowInTextEntry: true });
    const removeCancel = registerKeyboardCommand('drawing2d.cancel', () => {
      if (activeTool === 'polygon-area') cancelPolygonArea2D();
      else if (activeTool === 'cloud') cancelCloudAnnotation2D();
      else if (activeTool === 'text') setTextAnnotation2DEditing(null);
      if (activeTool !== 'none') setActiveTool('none');
      if (storeRef.current.selectedAnnotation2D) setSelectedAnnotation2D(null);
    }, { active: () => activeTool !== 'none' || Boolean(storeRef.current.selectedAnnotation2D),
      allowInTextEntry: true, ignoreModifiers: true });
    const removeKeyUp = registerKeyboardKeyUp((event) => {
      if (event.key === 'Shift') shiftHeldRef.current = false;
    });
    return () => {
      removeShift(); removeCancel(); removeKeyUp();
    };
  }, [activeTool, setActiveTool, cancelPolygonArea2D, cancelCloudAnnotation2D,
    setTextAnnotation2DEditing, setSelectedAnnotation2D]);

  // ── Mouse handlers ────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent): boolean => {
    if (e.button !== 0) return false;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return false;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drawingCoord = screenToDrawing(screenX, screenY);

    // ── Tool-specific placement ─────────────────────────────────────────
    if (activeTool !== 'none' && activeTool !== 'measure') {
      const snapPoint = activeTool === 'polygon-area' ? null : findSnapPoint(drawingCoord);
      let point = snapPoint || drawingCoord;

      switch (activeTool) {
        case 'polygon-area': {
          point = resolveAreaPoint(drawingCoord, e.shiftKey || shiftHeldRef.current).point;
          if (isNearFirstVertex(drawingCoord)) {
            completePolygonArea2D(computePolygonArea(polygonArea2DPoints), computePolygonPerimeter(polygonArea2DPoints));
          } else if (!polygonArea2DPoints.some(previous => Math.hypot(previous.x - point.x, previous.y - point.y) < 1e-8)) {
            addPolygonArea2DPoint(point);
          }
          return true;
        }
        case 'text': {
          const annotation: TextAnnotation2D = {
            id: `text-${Date.now()}`,
            position: point,
            text: '',
            fontSize: 14,
            color: '#000000',
            backgroundColor: 'rgba(255,255,255,0.9)',
            borderColor: '#333333',
          };
          addTextAnnotation2D(annotation);
          setTextAnnotation2DEditing(annotation.id);
          return true;
        }
        case 'cloud': {
          if (!snapPoint && shiftHeldRef.current && cloudAnnotation2DPoints.length === 1) {
            const firstPt = cloudAnnotation2DPoints[0];
            const dx = point.x - firstPt.x;
            const dy = point.y - firstPt.y;
            const maxDelta = Math.max(Math.abs(dx), Math.abs(dy));
            point = { x: firstPt.x + Math.sign(dx) * maxDelta, y: firstPt.y + Math.sign(dy) * maxDelta };
          }
          addCloudAnnotation2DPoint(point);
          if (cloudAnnotation2DPoints.length === 1) {
            setTimeout(() => completeCloudAnnotation2D(''), 0);
          }
          return true;
        }
      }
    }

    // ── Selection / drag (tool is 'none' or 'measure') ──────────────────
    const hit = hitTestAnnotations(screenX, screenY);
    if (hit) {
      const alreadySelected = storeRef.current.selectedAnnotation2D?.id === hit.id;
      setSelectedAnnotation2D(hit);
      // Selection is immediate; dragging the already-selected object is only
      // possible outside the properties editor. A single click never moves it.
      if (alreadySelected && editableAnnotationId !== hit.id) {
        const origin = getAnnotationOrigin(hit);
        if (origin) {
          isDraggingRef.current = true;
          dragOffsetRef.current = { x: drawingCoord.x - origin.x, y: drawingCoord.y - origin.y };
          dragAnchorRef.current = origin;
        }
      }
      return true; // consumed — don't start panning
    }

    // Clicked empty space — deselect
    if (storeRef.current.selectedAnnotation2D) {
      setSelectedAnnotation2D(null);
    }
    return false; // not consumed — let panning proceed
  }, [activeTool, containerRef, screenToDrawing, findSnapPoint, isNearFirstVertex,
    applyShiftConstraint, polygonArea2DPoints, addPolygonArea2DPoint, completePolygonArea2D,
    addTextAnnotation2D, setTextAnnotation2DEditing,
    cloudAnnotation2DPoints, addCloudAnnotation2DPoint, completeCloudAnnotation2D,
    hitTestAnnotations, getAnnotationOrigin, setSelectedAnnotation2D, editableAnnotationId, resolveAreaPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drawingCoord = screenToDrawing(screenX, screenY);

    // ── Dragging: commit position directly to store ─────────────────────
    if (isDraggingRef.current && dragOffsetRef.current) {
      // Throttle: Zustand set() is synchronous, but we skip if position
      // hasn't changed meaningfully (< 0.5 screen px)
      const raw: Point2D = {
        x: drawingCoord.x - dragOffsetRef.current.x,
        y: drawingCoord.y - dragOffsetRef.current.y,
      };
      const snapped = snapForDrag?.(raw) ?? null;
      const angle = angularSnap !== 'off' && dragAnchorRef.current
        ? snapDrawingAngle(dragAnchorRef.current, raw, 0, Number(angularSnap)) : null;
      const newDrawingPos = snapped && (!angle || Math.hypot(snapped.x - angle.x, snapped.y - angle.y) < 1e-8)
        ? snapped : angle ?? snapped ?? raw;
      // We call the store action directly — it's already optimized for single-item updates
      const sel = storeRef.current.selectedAnnotation2D;
      if (sel) {
        commitDragPosition(sel, newDrawingPos);
      }
      return;
    }

    // ── Tool preview ────────────────────────────────────────────────────
    if (activeTool === 'none' || activeTool === 'measure') return;

    if (activeTool === 'polygon-area') {
      const area = resolveAreaPoint(drawingCoord, e.shiftKey || shiftHeldRef.current);
      setMeasure2DSnapPoint(area.reference);
      setAnnotation2DCursorPos(area.point);
      return;
    }
    const snapPoint = findSnapPoint(drawingCoord);
    setMeasure2DSnapPoint(snapPoint);
    let point = snapPoint || drawingCoord;

    if (!snapPoint && shiftHeldRef.current && activeTool === 'cloud' && cloudAnnotation2DPoints.length === 1) {
      const firstPt = cloudAnnotation2DPoints[0];
      const dx = point.x - firstPt.x;
      const dy = point.y - firstPt.y;
      const maxDelta = Math.max(Math.abs(dx), Math.abs(dy));
      point = { x: firstPt.x + Math.sign(dx) * maxDelta, y: firstPt.y + Math.sign(dy) * maxDelta };
    }

    setAnnotation2DCursorPos(point);
  }, [activeTool, containerRef, screenToDrawing, findSnapPoint, setMeasure2DSnapPoint,
    setAnnotation2DCursorPos, applyShiftConstraint, polygonArea2DPoints, cloudAnnotation2DPoints,
    commitDragPosition, snapForDrag, angularSnap, resolveAreaPoint]);

  const endDrag = useCallback(() => {
    isDraggingRef.current = false;
    dragOffsetRef.current = null;
    dragAnchorRef.current = null;
  }, []);
  const handleMouseUp = useCallback((_e: React.MouseEvent) => endDrag(), [endDrag]);

  // A release outside the canvas never reaches its onMouseUp (like useMeasure2D's
  // global mouseup); a lost pointer or window blur ends the drag too.
  useEffect(() => {
    const events = ['mouseup', 'pointercancel', 'blur'] as const;
    for (const type of events) window.addEventListener(type, endDrag);
    return () => { for (const type of events) window.removeEventListener(type, endDrag); };
  }, [endDrag]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'polygon-area' && polygonArea2DPoints.length >= 3) {
      e.preventDefault();
      completePolygonArea2D(computePolygonArea(polygonArea2DPoints), computePolygonPerimeter(polygonArea2DPoints));
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const hit = hitTestAnnotations(e.clientX - rect.left, e.clientY - rect.top);
    if (hit && hit.type === 'text') {
      e.preventDefault();
      setSelectedAnnotation2D(hit);
      setTextAnnotation2DEditing(hit.id);
    }
  }, [activeTool, polygonArea2DPoints, completePolygonArea2D, containerRef,
    hitTestAnnotations, setSelectedAnnotation2D, setTextAnnotation2DEditing]);

  return {
    hitTestAnnotations,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
    isDraggingRef,
  };
}

export default useAnnotation2D;
