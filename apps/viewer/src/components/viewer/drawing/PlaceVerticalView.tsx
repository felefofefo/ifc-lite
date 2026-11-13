/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { ViewIdentityDialog } from './ViewIdentityFields';
import { nextViewCode, type MarkerTrace } from '@/lib/drawing/view-markers';
import { useTranslation } from '@/i18n';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { dragVerticalViewTrace, verticalViewPlane } from '@/lib/drawing/view-placement';
import { createDrawingView, editSavedViewTrace, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';

export type VerticalViewKind = 'section' | 'elevation';

export function PlaceVerticalView({ kind, vm, close, edit }: {
  kind: VerticalViewKind; vm: DrawingViewModel; close: () => void;
  edit?: { id: string; start: Point2D; end: Point2D; reverse: boolean };
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState<Point2D | undefined>(edit?.start);
  const [cursor, setCursor] = useState<Point2D>();
  const [end, setEnd] = useState<Point2D | undefined>(edit?.end);
  const [reverse, setReverse] = useState(edit?.reverse ?? false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; grip: 'line' | 'start' | 'end'; trace: MarkerTrace; x: number; y: number; scale: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [naming, setNaming] = useState(false);
  const { drawing, drawnPlane, viewTransform, sheetEnabled, activeSheet, isPinned, cachedSheetTransformRef } = vm;
  const project = useSavedSectionCuts(s => s.projectId);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (naming || event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [close, naming]);

  const sheet = drawing && sheetEnabled && activeSheet ? resolveSheetTransform({
    sheet: activeSheet, axis: 'down', isPinned, cached: cachedSheetTransformRef.current,
    drawingBounds: { minX: drawing.bounds.min.x, minY: drawing.bounds.min.y, maxX: drawing.bounds.max.x, maxY: drawing.bounds.max.y },
  }).transform : null;
  const scale = viewTransform.scale * (sheet?.scaleFactor ?? 1);
  const tx = viewTransform.x + (sheet?.translateX ?? 0) * viewTransform.scale;
  const ty = viewTransform.y + (sheet?.translateY ?? 0) * viewTransform.scale;
  const toScreen = (point: Point2D) => ({ x: point.x * scale + tx, y: point.y * scale + ty });

  function point(event: MouseEvent<SVGSVGElement>): Point2D {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - tx) / scale;
    const y = (event.clientY - rect.top - ty) / scale;
    if (!edit && start && event.shiftKey) {
      return Math.abs(x - start.x) >= Math.abs(y - start.y) ? { x, y: start.y } : { x: start.x, y };
    }
    return { x, y };
  }

  const second = end ?? cursor;
  const a = start && toScreen(start);
  const b = second && toScreen(second);
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const arrow = a && b && length > 0 ? {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + (reverse ? -90 : 90),
  } : null;

  const custom = start && end && verticalViewPlane(start, end, drawnPlane.flipped, reverse);
  const world = (point: Point2D) => ({ x: drawnPlane.flipped ? -point.x : point.x, y: point.y });

  function beginDrag(event: PointerEvent<SVGElement>, grip: 'line' | 'start' | 'end') {
    const svg = svgRef.current;
    if (!edit || !svg || !start || !end || event.button !== 0 || drag.current || !(scale > 0)) return;
    event.stopPropagation();
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, grip, trace: [start, end], x: event.clientX, y: event.clientY, scale };
    setDragging(true);
  }

  function updateDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    event.stopPropagation();
    const trace = dragVerticalViewTrace(current.trace, current.grip, {
      x: (event.clientX - current.x) / current.scale,
      y: (event.clientY - current.y) / current.scale,
    });
    if (trace) {
      setStart(trace[0]);
      setEnd(trace[1]);
    }
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>, canceled = false) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    event.stopPropagation();
    if (canceled) {
      setStart(current.trace[0]);
      setEnd(current.trace[1]);
    } else {
      updateDrag(event);
    }
    drag.current = null;
    setDragging(false);
  }

  return <div className="pointer-events-none absolute inset-0 z-10">
    <svg ref={svgRef} className={`pointer-events-auto absolute inset-0 h-full w-full text-primary ${edit ? 'touch-none' : 'cursor-crosshair'} ${dragging ? 'cursor-grabbing' : ''}`}
      aria-label={t(edit ? 'section2d.create.editLine' : 'section2d.create.trace')}
      onPointerMove={updateDrag}
      onPointerUp={event => finishDrag(event)}
      onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => finishDrag(event, true)}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
      onMouseMove={event => { event.stopPropagation(); if (!end) setCursor(point(event)); }}
      onClick={event => {
        if (edit || naming || !(scale > 0)) return;
        const next = point(event);
        if (!start || end) { setStart(next); setEnd(undefined); setCursor(next); }
        else if (verticalViewPlane(start, next, drawnPlane.flipped, reverse)) setEnd(next);
      }}>
      {a && !edit && <circle cx={a.x} cy={a.y} r="3" fill="currentColor" />}
      {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth="2" strokeDasharray={end ? undefined : '6 4'} />}
      {edit && a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="22"
        className={dragging ? 'cursor-grabbing' : 'cursor-grab'} onPointerDown={event => beginDrag(event, 'line')} />}
      {arrow && <path transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
        d="M0 0H24m-7-5 7 5-7 5" stroke="currentColor" strokeWidth="2" fill="none" className="pointer-events-none" />}
      {edit && a && b && ([['start', a], ['end', b]] as const).map(([grip, point]) => (
        <g key={grip} className={dragging ? 'cursor-grabbing' : 'cursor-grab'} onPointerDown={event => beginDrag(event, grip)}>
          <circle cx={point.x} cy={point.y} r="11" fill="transparent" />
          <circle cx={point.x} cy={point.y} r="5" className="fill-background stroke-current" strokeWidth="2" />
        </g>
      ))}
    </svg>
    <div className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <span aria-live="polite">{t(edit ? 'section2d.create.dragLine'
        : end ? 'section2d.create.confirmLine' : start ? 'section2d.create.second' : 'section2d.create.first')}</span>
      <Button size="sm" variant="outline" disabled={!start} onClick={() => setReverse(value => !value)}>{t('sectionPlanes.flip.label')}</Button>
      <Button size="sm" variant="ghost" onClick={close}>{t('section2d.create.cancel')}</Button>
      <Button size="sm" disabled={!custom || naming || dragging} onClick={() => {
        if (!edit) { setNaming(true); return; }
        if (!start || !end || useSavedSectionCuts.getState().projectId !== project) return;
        editSavedViewTrace(edit.id, [world(start), world(end)], drawnPlane.flipped !== reverse);
        close();
      }}>{t('section2d.views.save')}</Button>

    </div>
    {naming && start && end && custom && <ViewIdentityDialog name={t(`section2d.views.type.${kind}`)}
      code={nextViewCode(kind, useSavedSectionCuts.getState().cuts)} close={() => setNaming(false)}
      save={(name, code) => {
        if (useSavedSectionCuts.getState().projectId !== project) return;
        createDrawingView(name, kind, { axis: 'front', position: 50, custom }, undefined, code, [world(start), world(end)]);
        close();
      }} />}
  </div>;
}
