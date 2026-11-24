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
import { createLineworkSource } from '@/lib/snap/sources/linework';
import { solveSnap } from '@/lib/snap/solve';
import type { SnapProfile, SnapResult, Vec2 } from '@/lib/snap/types';

export const DEFAULT_OBJECT_SNAPS = { endpoint: true, midpoint: false, intersection: false, nearest: true };
export type DrawingObjectSnaps = typeof DEFAULT_OBJECT_SNAPS;

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
  const previousSnap = useRef<SnapResult | null>(null);
  const [draft, setDraft] = useState(EMPTY_DIMENSION_DRAFT);
  const [cursor, setCursor] = useState<{ point: Point2D; snapped: boolean; alignedAxis?: Point2D } | null>(null);

  const reset = useCallback(() => {
    setDraft(EMPTY_DIMENSION_DRAFT);
    setCursor(null);
    setMeasure2DSnapPoint(null);
    pan.current = null;
    previousSnap.current = null;
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

  // Geometry is in drawing-local metres, just like the shared snap solver. Build
  // once per drawing update instead of scanning/rebuilding rings on every move.
  const snapSource = useMemo(() => {
    if (!drawing) return null;
    const segments: (readonly [Vec2, Vec2])[] = [];
    const seen = new Set<string>();
    const add = (a: Point2D, b: Point2D) => {
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || (a.x === b.x && a.y === b.y)) return;
      const ka = `${a.x},${a.y}`, kb = `${b.x},${b.y}`;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) return;
      seen.add(key);
      segments.push([[a.x, a.y], [b.x, b.y]]);
    };
    const ring = (points: readonly Point2D[]) => {
      if (points.length < 2) return;
      for (let i = 0; i < points.length; i++) add(points[i], points[(i + 1) % points.length]);
    };
    for (const { polygon } of drawing.cutPolygons) {
      ring(polygon.outer);
      for (const hole of polygon.holes) ring(hole);
    }
    for (const line of drawing.lines) {
      if (!showHiddenLines && isOccludedDrawingLine(line)) continue;
      add(line.line.start, line.line.end);
    }
    for (const contour of extraSnapContours ?? []) ring(contour);
    return createLineworkSource({ segments, midpoints: objectSnaps.midpoint });
  }, [drawing, showHiddenLines, extraSnapContours, objectSnaps.midpoint]);

  // Keep the existing four toggles. Angular constraints stay in useDrawingDirection;
  // this solver is responsible only for geometric targets and their stability.
  const snapProfile = useMemo<SnapProfile>(() => ({
    radiusPx: 12,
    hysteresisPx: 3,
    sources: ['linework'],
    tiers: [
      ...(objectSnaps.endpoint ? [['endpoint', 'vertex'] as const] : []),
      ...(objectSnaps.intersection ? [['intersection'] as const] : []),
      ...(objectSnaps.midpoint ? [['midpoint'] as const] : []),
      ...(objectSnaps.nearest ? [['edge'] as const] : []),
    ],
  }), [objectSnaps.endpoint, objectSnaps.midpoint, objectSnaps.intersection, objectSnaps.nearest]);

  useEffect(() => { previousSnap.current = null; }, [snapSource, snapProfile, drawingKey, sectionAxis]);

  const findSnapPoint = useCallback((cursor: Point2D): Point2D | null => {
    if (!snapSource || !(viewTransform.scale > 0) || !Number.isFinite(viewTransform.scale) || snapProfile.tiers.length === 0) {
      previousSnap.current = null;
      return null;
    }
    const result = solveSnap({
      cursor: [cursor.x, cursor.y], metresPerPixel: 1 / viewTransform.scale,
      anchor: null, chain: [], modifiers: { shift: false, alt: false }, locks: {},
    }, [snapSource], snapProfile, previousSnap.current ?? undefined);
    previousSnap.current = result.winner ? result : null;
    return result.winner ? { x: result.local[0], y: result.local[1] } : null;
  }, [snapSource, snapProfile, viewTransform.scale]);

  // UI-only metadata: never attach a snap kind to a Point2D persisted in the project.
  const snapKindFor = useCallback((point: Point2D | null) => {
    const result = previousSnap.current;
    if (!point || !result?.winner || result.local[0] !== point.x || result.local[1] !== point.y) return null;
    return result.winner.kind;
  }, []);

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
    previousSnap.current = null;
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

  return { handleClick, handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave, findSnapPoint, snapKindFor, draft, preview, reset };
}
