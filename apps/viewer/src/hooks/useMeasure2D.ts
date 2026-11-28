/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Drawing pan and dimension placement, sharing the existing model snap. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isOccludedDrawingLine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { useDrawingDirection, type AngularSnap } from '@/hooks/useDrawingDirection';
import { axisFlipForSection } from '@/hooks/pdfSectionLayout';
import { KEYBOARD_PRIORITY, registerKeyboardCommand } from '@/lib/commands/dispatcher';
import { clickDimension, continueLinearDimension, editLinearDimensionChain, type DimensionChainMode, dimensionAlignmentPoint, dimensionSnapVertices, parallelDimensionPoint, type DimensionAlignment, dimensionSegments, EMPTY_DIMENSION_DRAFT, finishDimensionPoints, isCurvedDimension, type DimensionSegment, type DimensionType, curvedDimension } from '@/lib/drawing/dimension-line';
import type { Point2D, Measure2DResult } from '@/store/slices/drawing2DSlice';
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
  extraSnapPaths?: readonly { points: readonly Point2D[]; closed: boolean }[];
  alignmentDimensions?: readonly Measure2DResult[];
  /** Undefined for normal creation; an empty array blocks an invalid continuation. */
  continuationDimensions?: readonly Measure2DResult[];
  chainMode?: DimensionChainMode;
  onContinue?: (point: Point2D) => boolean;
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
  drawing, drawingKey, objectSnaps = DEFAULT_OBJECT_SNAPS, extraSnapContours, extraSnapPaths, alignmentDimensions, continuationDimensions, chainMode = 'continue', onContinue, viewTransform, setViewTransform, sectionAxis, containerRef,
  measure2DMode, dimensionType, angularSnap = 'off', showHiddenLines, setMeasure2DSnapPoint, onCancel, onPlace,
}: UseMeasure2DParams) {
  const pan = useRef<Point2D | null>(null);
  const previousSnap = useRef<SnapResult | null>(null);
  const alignmentSnap = useRef<DimensionAlignment | null>(null);
  const chainEditSnap = useRef<Point2D | null>(null);
  const [draft, setDraft] = useState(EMPTY_DIMENSION_DRAFT);
  const [cursor, setCursor] = useState<{ point: Point2D; snapped: boolean; alignedAxis?: Point2D } | null>(null);

  const reset = useCallback(() => {
    setDraft(EMPTY_DIMENSION_DRAFT);
    setCursor(null);
    setMeasure2DSnapPoint(null);
    pan.current = null;
    previousSnap.current = null;
    alignmentSnap.current = null;
    chainEditSnap.current = null;
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
    for (const path of extraSnapPaths ?? []) {
      if (path.closed) ring(path.points);
      else for (let i = 1; i < path.points.length; i++) add(path.points[i - 1], path.points[i]);
    }
    return createLineworkSource({ segments, midpoints: objectSnaps.midpoint });
  }, [drawing, showHiddenLines, extraSnapContours, extraSnapPaths, objectSnaps.midpoint]);

  // Keep the existing four toggles. Angular constraints stay in useDrawingDirection;
  // this solver is responsible only for geometric targets and their stability.
  const snapProfile = useMemo<SnapProfile>(() => ({
    radiusPx: 12,
    // A held target has a slightly wider exit radius than its entry radius.
    hysteresisPx: 4,
    sources: ['linework'],
    tiers: [
      ...(objectSnaps.endpoint ? [['endpoint', 'vertex'] as const] : []),
      ...(objectSnaps.intersection ? [['intersection'] as const] : []),
      ...(objectSnaps.midpoint ? [['midpoint'] as const] : []),
      ...(objectSnaps.nearest ? [['edge'] as const] : []),
    ],
  }), [objectSnaps.endpoint, objectSnaps.midpoint, objectSnaps.intersection, objectSnaps.nearest]);

  useEffect(() => { previousSnap.current = null; }, [snapSource, snapProfile, drawingKey, sectionAxis]);

  const dimensionVertices = useMemo(() => dimensionSnapVertices(alignmentDimensions ?? []), [alignmentDimensions]);
  const findSnapPoint = useCallback((cursor: Point2D, referenceVertices?: readonly Vec2[], excludedChains?: ReadonlySet<string>): Point2D | null => {
    alignmentSnap.current = null;
    chainEditSnap.current = null;
    if (!snapSource || !(viewTransform.scale > 0) || !Number.isFinite(viewTransform.scale) || snapProfile.tiers.length === 0) {
      previousSnap.current = null;
      return null;
    }
    // Dimension bases and tick nodes are available to all drawing tools.
    const vertices = objectSnaps.endpoint ? (excludedChains?.size
      ? dimensionSnapVertices(alignmentDimensions ?? [], excludedChains) : dimensionVertices) : [];
    const sources = [snapSource];
    if (vertices.length) sources.push(createLineworkSource({ vertices }));
    if (objectSnaps.endpoint && referenceVertices?.length) sources.push(createLineworkSource({ vertices: referenceVertices }));
    const result = solveSnap({
      cursor: [cursor.x, cursor.y], metresPerPixel: 1 / viewTransform.scale,
      anchor: null, chain: [], modifiers: { shift: false, alt: false }, locks: {},
    }, sources, snapProfile, previousSnap.current ?? undefined);
    previousSnap.current = result.winner ? result : null;
    return result.winner ? { x: result.local[0], y: result.local[1] } : null;
  }, [snapSource, snapProfile, viewTransform.scale, objectSnaps.endpoint, alignmentDimensions, dimensionVertices]);

  const alignmentEnabled = objectSnaps.nearest || objectSnaps.endpoint;
  const alignmentTolerance = 18 / viewTransform.scale;
  const findDimensionAlignment = useCallback((axis: Point2D, point: Point2D, excludedChains?: ReadonlySet<string>) => {
    const reference = alignmentEnabled && viewTransform.scale > 0
      ? parallelDimensionPoint(axis, point, alignmentDimensions ?? [], alignmentTolerance, excludedChains) : null;
    previousSnap.current = null;
    alignmentSnap.current = reference;
    return reference?.point ?? null;
  }, [alignmentEnabled, viewTransform.scale, alignmentDimensions, alignmentTolerance]);

  // UI-only metadata: never attach a snap kind to a persisted drawing point.
  const snapDisplayPoint = useCallback((point: Point2D): Point2D => {
    const aligned = alignmentSnap.current;
    return aligned && aligned.point.x === point.x && aligned.point.y === point.y
      ? aligned.reference : point;
  }, []);
  const snapKindFor = useCallback((point: Point2D | null) => {
    if (point && chainEditSnap.current?.x === point.x && chainEditSnap.current.y === point.y) return 'vertex' as const;
    const aligned = alignmentSnap.current;
    if (point && aligned?.point.x === point.x && aligned.point.y === point.y) return 'parallel' as const;
    const result = previousSnap.current;
    if (!point || !result?.winner || result.local[0] !== point.x || result.local[1] !== point.y) return null;
    return result.winner.kind;
  }, []);

  useEffect(() => {
    if (!measure2DMode) return;
    return registerKeyboardCommand('drawing2d.cancel', (event) => {
      if (event.repeat) return;
      const placing = continuationDimensions || isCurvedDimension(dimensionType) ? null : finishDimensionPoints(draft);
      if (placing) {
        setDraft(placing);
        setMeasure2DSnapPoint(null);
      } else {
        reset();
        onCancel();
      }
    }, { allowInTextEntry: true, ignoreModifiers: true, priority: KEYBOARD_PRIORITY.drawingMeasure });
  }, [measure2DMode, dimensionType, draft, continuationDimensions, onCancel, reset, setMeasure2DSnapPoint]);

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
    alignmentSnap.current = null;
    if (draft.placing && !isCurvedDimension(dimensionType)) {
      const reference = alignmentEnabled && viewTransform.scale > 0
        ? dimensionAlignmentPoint(draft, dimensionType, point, alignmentDimensions ?? [], alignmentTolerance)
        : null;
      previousSnap.current = null;
      alignmentSnap.current = reference;
      return { point: reference?.point ?? point, snapped: reference !== null,
        reference: reference?.point ?? null, alignedAxis: draft.alignedAxis };
    }
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

  function chainInput(raw: Point2D) {
    const chain = continuationDimensions ?? [];
    if (chainMode === 'remove') {
      // Removal is an explicit node pick, independent of global snap switches.
      previousSnap.current = null;
      alignmentSnap.current = null;
      const edit = editLinearDimensionChain(chain, raw, 'remove', 12 / viewTransform.scale);
      const reference = edit?.reference ?? null;
      chainEditSnap.current = reference;
      return { point: raw, reference, valid: !!edit };
    }
    const reference = findSnapPoint(raw);
    const point = reference ?? raw;
    const valid = chainMode === 'insert' ? !!editLinearDimensionChain(chain, point, 'insert', 0)
      : !!continueLinearDimension(chain, point);
    return { point, reference, valid };
  }

  function handleClick(e: React.MouseEvent) {
    if (!measure2DMode || !drawing || e.button !== 0) return;
    const point = drawingPoint(e);
    if (!point) return;
    if (continuationDimensions) {
      const input = chainInput(point);
      if (input.valid && onContinue?.(input.point)) {
        setCursor(null);
        chainEditSnap.current = null;
        setMeasure2DSnapPoint(null);
      }
      return;
    }
    const input = dimensionInput(point, e.shiftKey);
    const next = clickDimension(draft, dimensionType, input.point, input.snapped, input.alignedAxis);
    if (draft.placing && isCurvedDimension(dimensionType) && !next.segments.length) return;
    setDraft(next.draft);
    if (next.draft.placing) {
      const reference = alignmentEnabled && viewTransform.scale > 0
        ? dimensionAlignmentPoint(next.draft, dimensionType, point, alignmentDimensions ?? [], alignmentTolerance) : null;
      previousSnap.current = null;
      alignmentSnap.current = reference;
      setCursor({ point: reference?.point ?? point, snapped: reference !== null });
      setMeasure2DSnapPoint(reference?.point ?? null);
    }
    if (next.segments.length) {
      alignmentSnap.current = null;
      setMeasure2DSnapPoint(null);
      onPlace(next.segments);
    }
  }

  function handleMouseDown(e: React.MouseEvent) {
    // 2D CAD navigation: middle button pans, left button is reserved for tools/selection.
    if (e.button === 1) {
      e.preventDefault(); // Suppress the browser's middle-click auto-scroll.
      pan.current = { x: e.clientX, y: e.clientY };
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (pan.current && (e.buttons & 4)) {
      const dx = e.clientX - pan.current.x;
      const dy = e.clientY - pan.current.y;
      pan.current = { x: e.clientX, y: e.clientY };
      setViewTransform(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (pan.current) pan.current = null;
    if (measure2DMode && drawing) {
      const point = drawingPoint(e);
      if (!point) return;
      if (continuationDimensions) {
        const input = chainInput(point);
        setCursor({ point: input.point, snapped: !!input.reference });
        setMeasure2DSnapPoint(input.reference);
        return;
      }
      const { reference, ...input } = dimensionInput(point, e.shiftKey);
      setCursor(input);
      setMeasure2DSnapPoint(reference);
    }
  }

  function handleMouseUp() {
    pan.current = null;
  }

  function handleMouseLeave() {
    if (continuationDimensions) setCursor(null);
    chainEditSnap.current = null;
    pan.current = null;
    previousSnap.current = null;
    alignmentSnap.current = null;
    setMeasure2DSnapPoint(null);
  }

  const chainEditPreview = useMemo(() => measure2DMode && continuationDimensions && cursor && chainMode !== 'continue'
    ? editLinearDimensionChain(continuationDimensions, cursor.point, chainMode, 12 / viewTransform.scale) : null,
    [measure2DMode, continuationDimensions, cursor, chainMode, viewTransform.scale]);
  const preview = useMemo(() => {
    if (!measure2DMode) return [];
    if (continuationDimensions) {
      if (chainMode !== 'continue') return chainEditPreview?.segments ?? [];
      const segment = cursor && continueLinearDimension(continuationDimensions, cursor.point);
      return segment ? [segment] : [];
    }
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
  }, [choosingAngularSide, cursor, dimensionType, draft, measure2DMode, continuationDimensions, chainMode, chainEditPreview]);

  return { handleClick, handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave, findSnapPoint, findDimensionAlignment, snapKindFor, snapDisplayPoint, draft, preview, chainEditPreview, reset };
}
