/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Drawing pan and dimension placement, sharing the existing model snap. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isOccludedDrawingLine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { useDrawingDirection, type AngularSnap } from '@/hooks/useDrawingDirection';
import { axisFlipForSection } from '@/hooks/pdfSectionLayout';
import { KEYBOARD_PRIORITY, registerKeyboardCommand } from '@/lib/commands/dispatcher';
import { clickDimension, dimensionSegments, EMPTY_DIMENSION_DRAFT, finishDimensionPoints, isCurvedDimension, type DimensionSegment, type DimensionType, curvedDimension } from '@/lib/drawing/dimension-line';
import type { Point2D } from '@/store/slices/drawing2DSlice';

export const DEFAULT_OBJECT_SNAPS = { endpoint: true, midpoint: false, intersection: false, nearest: true };
export type DrawingObjectSnaps = typeof DEFAULT_OBJECT_SNAPS;

function segmentIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const dx = b.x - a.x, dy = b.y - a.y, ex = d.x - c.x, ey = d.y - c.y;
  const det = dx * ey - dy * ex;
  if (Math.abs(det) <= 1e-12) return null;
  const x = c.x - a.x, y = c.y - a.y;
  const t = (x * ey - y * ex) / det, u = (x * dy - y * dx) / det;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + t * dx, y: a.y + t * dy } : null;
}

interface UseMeasure2DParams {
  drawing: Drawing2D | null;
  drawingKey?: string;
  objectSnaps?: DrawingObjectSnaps;
  /** Visible extra geometry, e.g. read-only IFC room boundaries. */
  extraSnapContours?: readonly (readonly Point2D[])[];
  viewTransform: { x: number; y: number; scale: number };
  setViewTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  sectionAxis: 'down' | 'front' | 'side';
  containerRef: React.RefObject<HTMLDivElement | null>;
  measure2DMode: boolean;
  dimensionType: DimensionType;
  angularSnap?: AngularSnap;
  showHiddenLines?: boolean;
  setMeasure2DSnapPoint: (point: Point2D | null) => void;
  onCancel: () => void;
  onPlace: (segments: DimensionSegment[]) => void;
}

export function useMeasure2D({
  drawing, drawingKey, objectSnaps = DEFAULT_OBJECT_SNAPS, extraSnapContours, viewTransform, setViewTransform, sectionAxis, containerRef,
  measure2DMode, dimensionType, angularSnap = 'off', showHiddenLines, setMeasure2DSnapPoint, onCancel, onPlace,
}: UseMeasure2DParams) {
  const pan = useRef<Point2D | null>(null);
  const [draft, setDraft] = useState(EMPTY_DIMENSION_DRAFT);
  const [cursor, setCursor] = useState<{ point: Point2D; snapped: boolean; alignedAxis?: Point2D } | null>(null);

  const reset = useCallback(() => {
    setDraft(EMPTY_DIMENSION_DRAFT);
    setCursor(null);
    setMeasure2DSnapPoint(null);
    pan.current = null;
  }, [setMeasure2DSnapPoint]);

  useEffect(reset, [measure2DMode, dimensionType, drawing, drawingKey, sectionAxis, reset]);

  // Convert screen coordinates to drawing coordinates
  const screenToDrawing = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    // Screen coord → drawing coord
    // Apply axis-specific inverse transforms (matching canvas rendering)
    const { flipX, flipY } = axisFlipForSection(sectionAxis);

    // Inverse of: screenX = drawingX * scaleX + transform.x
    // where scaleX = flipX ? -scale : scale
    const scaleX = flipX ? -viewTransform.scale : viewTransform.scale;
    const scaleY = flipY ? -viewTransform.scale : viewTransform.scale;

    const x = (screenX - viewTransform.x) / scaleX;
    const y = (screenY - viewTransform.y) / scaleY;
    return { x, y };
  }, [viewTransform, sectionAxis]);

  // Find nearest point on a line segment
  const nearestPointOnSegment = useCallback((
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): { point: { x: number; y: number }; dist: number } => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 0.0001) {
      // Degenerate segment
      const d = Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
      return { point: a, dist: d };
    }

    // Parameter t along segment [0,1]
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const nearest = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2);

    return { point: nearest, dist };
  }, []);

  const findSnapPoint = useCallback((cursor: Point2D): Point2D | null => {
    if (!drawing || !(viewTransform.scale > 0) || !Object.values(objectSnaps).some(Boolean)) return null;
    const threshold = 10 / viewTransform.scale;
    let bestFixed: Point2D | null = null;
    let bestFixedDist = threshold * 0.7;
    let bestNearest: Point2D | null = null;
    let bestNearestDist = threshold;
    const nearby: { a: Point2D; b: Point2D; dist: number }[] = [];
    function fixed(point: Point2D) {
      const distance = Math.hypot(point.x - cursor.x, point.y - cursor.y);
      if (distance < bestFixedDist) {
        bestFixedDist = distance;
        bestFixed = point;
      }
    }
    function consider(a: Point2D, b: Point2D) {
      if (objectSnaps.endpoint) { fixed(a); fixed(b); }
      if (objectSnaps.midpoint) fixed({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      if (!(objectSnaps.nearest || objectSnaps.intersection)) return;
      const { point, dist } = nearestPointOnSegment(cursor, a, b);
      if (objectSnaps.intersection && dist < threshold) nearby.push({ a, b, dist });
      if (objectSnaps.nearest && dist < bestNearestDist) {
        bestNearestDist = dist;
        bestNearest = point;
      }
    }
    for (const { polygon } of drawing.cutPolygons) {
      for (const ring of [polygon.outer, ...polygon.holes]) {
        ring.forEach((point, index) => consider(point, ring[(index + 1) % ring.length]));
      }
    }
    for (const line of drawing.lines) {
      if (!showHiddenLines && isOccludedDrawingLine(line)) continue;
      consider(line.line.start, line.line.end);
    }
    for (const ring of extraSnapContours ?? []) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length; i++) consider(ring[i], ring[(i + 1) % ring.length]);
    }
    const candidates = nearby.sort((a, b) => a.dist - b.dist).slice(0, 64);
    for (let i = 0; i < candidates.length; i++) {
      const { a, b } = candidates[i];
      for (let j = i + 1; j < candidates.length; j++) {
        const crossing = segmentIntersection(a, b, candidates[j].a, candidates[j].b);
        if (crossing) fixed(crossing);
      }
    }
    return bestFixed ?? bestNearest;
  }, [drawing, showHiddenLines, viewTransform.scale, nearestPointOnSegment, objectSnaps, extraSnapContours]);


  useEffect(() => {
    if (!measure2DMode) return;
    return registerKeyboardCommand('drawing2d.cancel', (event) => {
      if (event.repeat) return;
      const placing = isCurvedDimension(dimensionType) ? null : finishDimensionPoints(draft);
      if (placing) {
        setDraft(placing);
        setMeasure2DSnapPoint(null);
      } else {
        reset();
        onCancel();
      }
    }, { allowInTextEntry: true, ignoreModifiers: true, priority: KEYBOARD_PRIORITY.drawingMeasure });
  }, [measure2DMode, dimensionType, draft, onCancel, reset, setMeasure2DSnapPoint]);

  function drawingPoint(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect ? screenToDrawing(e.clientX - rect.left, e.clientY - rect.top) : null;
  }

  const choosingAngularSide = dimensionType === 'angular' && draft.points.length === 3 && !draft.placing;

  const { resolve: resolveDirection, getLockedAxis } = useDrawingDirection(measure2DMode && drawing ? draft : null, angularSnap);

  function resolveDimensionSnap(point: Point2D, shift: boolean, reference: Point2D | null) {
    const [origin, firstLeg] = draft.points;
    if (!draft.placing && origin && draft.points.length === 1 && dimensionType === 'aligned') {
      return resolveDirection(origin, point, reference, shift);
    }
    if (!draft.placing && origin && draft.points.length < 3 && dimensionType === 'angular') {
      const base = firstLeg ? Math.atan2(firstLeg.y - origin.y, firstLeg.x - origin.x) : 0;
      return resolveDirection(origin, point, reference, shift, base);
    }
    if (draft.placing && (dimensionType === 'radius' || dimensionType === 'diameter')) {
      const center = curvedDimension(draft.points, dimensionType)?.shape?.center;
      return resolveDirection(center ?? null, point, reference, shift);
    }
    return reference;
  }

  function dimensionInput(point: Point2D, shift: boolean) {
    const reference = draft.placing || choosingAngularSide ? null : findSnapPoint(point);
    const lockedAligned = shift && dimensionType === 'aligned' && !draft.placing && draft.points.length === 1;
    const snapped = resolveDimensionSnap(point, shift, lockedAligned ? null : reference);
    if (lockedAligned && snapped && reference) {
      const alignedAxis = getLockedAxis();
      if (alignedAxis) {
        const normal = { x: -alignedAxis.y, y: alignedAxis.x };
        const offset = (reference.x - snapped.x) * normal.x + (reference.y - snapped.y) * normal.y;
        // The snap guides the extension only. Its tangential position cannot move the tick.
        const anchor = { x: snapped.x + offset * normal.x, y: snapped.y + offset * normal.y };
        return { point: anchor, snapped: true, alignedAxis, reference };
      }
    }
    return { point: snapped ?? point, snapped: snapped !== null, reference };
  }

  function handleClick(e: React.MouseEvent) {
    if (!measure2DMode || !drawing || e.button !== 0) return;
    const point = drawingPoint(e);
    if (!point) return;
    const input = dimensionInput(point, e.shiftKey);
    const next = clickDimension(draft, dimensionType, input.point, input.snapped, input.alignedAxis);
    if (draft.placing && isCurvedDimension(dimensionType) && !next.segments.length) return;
    setDraft(next.draft);
    if (next.draft.placing) {
      setCursor({ point, snapped: false });
      setMeasure2DSnapPoint(null);
    }
    if (next.segments.length) onPlace(next.segments);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (!measure2DMode && e.button === 0) pan.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (measure2DMode && drawing) {
      const point = drawingPoint(e);
      if (!point) return;
      const { reference, ...input } = dimensionInput(point, e.shiftKey);
      setCursor(input);
      setMeasure2DSnapPoint(reference);
    } else if (pan.current && (e.buttons & 1)) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      pan.current = { x: e.clientX, y: e.clientY };
      setViewTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    }
  }

  function handleMouseUp() {
    pan.current = null;
  }

  function handleMouseLeave() {
    pan.current = null;
    setMeasure2DSnapPoint(null);
  }

  const preview = useMemo(() => {
    if (!measure2DMode) return [];
    const canPreviewPoint = isCurvedDimension(dimensionType)
      ? draft.points.length === 2 && (dimensionType === 'angular' || cursor?.snapped)
      : draft.points.length === 1 || cursor?.snapped;
    const points = !draft.placing && cursor && canPreviewPoint
      ? [...draft.points, cursor.point] : draft.points;
    const side = choosingAngularSide ? cursor?.point : draft.angularSide;
    return dimensionSegments(
      points, dimensionType, draft.placing ? cursor?.point : undefined, side,
      draft.alignedAxis ?? cursor?.alignedAxis,
    );
  }, [choosingAngularSide, cursor, dimensionType, draft, measure2DMode]);

  return { handleClick, handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave, findSnapPoint, draft, preview, reset };
}
