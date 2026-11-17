/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Drawing pan and dimension placement, sharing the existing model snap. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isOccludedDrawingLine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { axisFlipForSection } from '@/hooks/pdfSectionLayout';
import { KEYBOARD_PRIORITY, registerKeyboardCommand } from '@/lib/commands/dispatcher';
import { clickDimension, dimensionSegments, EMPTY_DIMENSION_DRAFT, finishDimensionPoints, isCurvedDimension, type DimensionSegment, type DimensionType, curvedDimension, snapDrawingAngle } from '@/lib/drawing/dimension-line';
import type { Point2D } from '@/store/slices/drawing2DSlice';

interface UseMeasure2DParams {
  drawing: Drawing2D | null;
  drawingKey?: string;
  viewTransform: { x: number; y: number; scale: number };
  setViewTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  sectionAxis: 'down' | 'front' | 'side';
  containerRef: React.RefObject<HTMLDivElement | null>;
  measure2DMode: boolean;
  dimensionType: DimensionType;
  showHiddenLines?: boolean;
  setMeasure2DSnapPoint: (point: Point2D | null) => void;
  onCancel: () => void;
  onPlace: (segments: DimensionSegment[]) => void;
}

export function useMeasure2D({
  drawing, drawingKey, viewTransform, setViewTransform, sectionAxis, containerRef,
  measure2DMode, dimensionType, showHiddenLines, setMeasure2DSnapPoint, onCancel, onPlace,
}: UseMeasure2DParams) {
  const pan = useRef<Point2D | null>(null);
  const [draft, setDraft] = useState(EMPTY_DIMENSION_DRAFT);
  const [cursor, setCursor] = useState<{ point: Point2D; snapped: boolean } | null>(null);

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

  // Find snap point near cursor (check polygon vertices, edges, and line endpoints)
  const findSnapPoint = useCallback((drawingCoord: { x: number; y: number }): { x: number; y: number } | null => {
    if (!drawing) return null;

    const snapThreshold = 10 / viewTransform.scale; // 10 screen pixels
    let bestSnap: { x: number; y: number } | null = null;
    let bestDist = snapThreshold;

    // Priority 1: Check polygon vertices (endpoints are highest priority)
    for (const polygon of drawing.cutPolygons) {
      for (const pt of polygon.polygon.outer) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) { // Vertices get priority (70% threshold)
          return { x: pt.x, y: pt.y }; // Return immediately for vertex snaps
        }
      }
      for (const hole of polygon.polygon.holes) {
        for (const pt of hole) {
          const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
          if (dist < bestDist * 0.7) {
            return { x: pt.x, y: pt.y };
          }
        }
      }
    }

    // Priority 2: Check line endpoints
    for (const line of drawing.lines) {
      if (!showHiddenLines && isOccludedDrawingLine(line)) continue;
      const { start, end } = line.line;
      for (const pt of [start, end]) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) {
          return { x: pt.x, y: pt.y };
        }
      }
    }

    // Priority 3: Check polygon edges
    for (const polygon of drawing.cutPolygons) {
      const outer = polygon.polygon.outer;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        const { point, dist } = nearestPointOnSegment(drawingCoord, a, b);
        if (dist < bestDist) {
          bestDist = dist;
          bestSnap = point;
        }
      }
      for (const hole of polygon.polygon.holes) {
        for (let i = 0; i < hole.length; i++) {
          const a = hole[i];
          const b = hole[(i + 1) % hole.length];
          const { point, dist } = nearestPointOnSegment(drawingCoord, a, b);
          if (dist < bestDist) {
            bestDist = dist;
            bestSnap = point;
          }
        }
      }
    }

    // Priority 4: Check drawing lines
    for (const line of drawing.lines) {
      if (!showHiddenLines && isOccludedDrawingLine(line)) continue;
      const { start, end } = line.line;
      const { point, dist } = nearestPointOnSegment(drawingCoord, start, end);
      if (dist < bestDist) {
        bestDist = dist;
        bestSnap = point;
      }
    }

    return bestSnap;
  }, [drawing, showHiddenLines, viewTransform.scale, nearestPointOnSegment]);


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

  function anglePoint(point: { x: number; y: number }, shift: boolean) {
    if (!shift) return null;
    const [origin, firstLeg] = draft.points;
    if (!draft.placing && origin && draft.points.length === 1 && dimensionType === 'aligned') {
      return snapDrawingAngle(origin, point);
    }
    if (!draft.placing && origin && draft.points.length < 3 && dimensionType === 'angular') {
      const base = firstLeg ? Math.atan2(firstLeg.y - origin.y, firstLeg.x - origin.x) : 0;
      return snapDrawingAngle(origin, point, base);
    }
    if (draft.placing && (dimensionType === 'radius' || dimensionType === 'diameter')) {
      const center = curvedDimension(draft.points, dimensionType)?.shape?.center;
      return center ? snapDrawingAngle(center, point) : null;
    }
    return null;
  }

  function handleClick(e: React.MouseEvent) {
    if (!measure2DMode || !drawing || e.button !== 0) return;
    const point = drawingPoint(e);
    if (!point) return;
    const angular = anglePoint(point, e.shiftKey);
    const snapped = angular ?? (draft.placing || choosingAngularSide ? null : findSnapPoint(point));
    const next = clickDimension(draft, dimensionType, snapped ?? point, snapped !== null);
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
      const angular = anglePoint(point, e.shiftKey);
      const snapped = angular ?? (draft.placing || choosingAngularSide ? null : findSnapPoint(point));
      setCursor({ point: snapped ?? point, snapped: snapped !== null });
      setMeasure2DSnapPoint(angular ? null : snapped);
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
    return dimensionSegments(points, dimensionType, draft.placing ? cursor?.point : undefined, side);
  }, [choosingAngularSide, cursor, dimensionType, draft, measure2DMode]);

  return { handleClick, handleMouseDown, handleMouseMove, handleMouseUp, handleMouseLeave, draft, preview, reset };
}
