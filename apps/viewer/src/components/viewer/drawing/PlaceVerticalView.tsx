/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { useDrawingDirection } from '@/hooks/useDrawingDirection';
import { DEFAULT_DISTANT, type DistantElements } from '@/lib/drawing/distant-elements';
import type { SnapKind } from '@/lib/snap/types';
import { DrawingSnapGlyph } from './DrawingSnapGlyph';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ViewIdentityDialog } from './ViewIdentityFields';
import { nextViewCode, type MarkerTrace } from '@/lib/drawing/view-markers';
import { useTranslation } from '@/i18n';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { dragVerticalViewTrace, verticalViewPlane } from '@/lib/drawing/view-placement';
import { createDrawingView, editSavedViewTrace, selectActiveSavedView, setViewMarkerStyle, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';

export type VerticalViewKind = 'section' | 'elevation';

export function PlaceVerticalView({ kind, vm, close, edit }: {
  kind: VerticalViewKind; vm: DrawingViewModel; close: () => void;
  edit?: { id: string; start: Point2D; end: Point2D; reverse: boolean; distant?: DistantElements };
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState<Point2D | undefined>(edit?.start);
  const [cursor, setCursor] = useState<Point2D>();
  const [end, setEnd] = useState<Point2D | undefined>(edit?.end);
  const [reverse, setReverse] = useState(edit?.reverse ?? false);
  const [distant, setDistant] = useState<DistantElements | null>(edit?.distant ?? null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; grip: 'line' | 'start' | 'end' | 'distant'; trace: MarkerTrace; distant: DistantElements | null; x: number; y: number; scale: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [snap, setSnap] = useState<Point2D | null>(null);
  const [snapKind, setSnapKind] = useState<SnapKind | null>(null);
  const [naming, setNaming] = useState(false);
  const { drawing, drawnPlane, viewTransform, sheetEnabled, activeSheet, isPinned, cachedSheetTransformRef } = vm;
  const project = useSavedSectionCuts(s => s.projectId);
  const markerView = useSavedSectionCuts(s => edit && s.cuts.find(view => view.id === edit.id));
  const annotationView = useSavedSectionCuts(selectActiveSavedView);
  const markerStyles = useSavedSectionCuts(s => s.tagLibrary.markerStyles);
  const [styleFailed, setStyleFailed] = useState(false);
  const { resolve: resolveDirection, resetDirection } = useDrawingDirection(edit?.id ?? null, vm.angularSnap);

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
    const raw = { x, y };
    const reference = vm.findSnapPoint(raw);
    const resolved = resolveDirection(start ?? null, raw, reference, event.shiftKey) ?? raw;
    // Do not label an angle-constrained point as an object snap.
    const matches = reference && resolved.x === reference.x && resolved.y === reference.y;
    setSnap(matches ? reference : null);
    setSnapKind(matches ? vm.snapKindFor(reference) : null);
    return resolved;
  }

  const second = end ?? cursor;
  const a = start && toScreen(start);
  const b = second && toScreen(second);
  const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const arrow = a && b && length > 0 ? {
    x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
    angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + (reverse ? -90 : 90),
  } : null;

  const direction = arrow && { x: Math.cos(arrow.angle * Math.PI / 180), y: Math.sin(arrow.angle * Math.PI / 180) };
  const offset = distant && direction && { x: direction.x * distant.offset * scale, y: direction.y * distant.offset * scale };
  const custom = start && end && verticalViewPlane(start, end, drawnPlane.flipped, reverse);
  const world = (point: Point2D) => ({ x: drawnPlane.flipped ? -point.x : point.x, y: point.y });

  function beginDrag(event: PointerEvent<SVGElement>, grip: 'line' | 'start' | 'end' | 'distant') {
    const svg = svgRef.current;
    if (!edit || !svg || !start || !end || event.button !== 0 || drag.current || !(scale > 0)) return;
    event.stopPropagation();
    event.preventDefault();
    svg.setPointerCapture(event.pointerId);
    if (grip === 'start') resetDirection(Math.atan2(start.y - end.y, start.x - end.x));
    if (grip === 'end') resetDirection(Math.atan2(end.y - start.y, end.x - start.x));
    drag.current = { id: event.pointerId, grip, trace: [start, end], distant, x: event.clientX, y: event.clientY, scale, moved: false };
    setDragging(true);
  }

  function updateDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    event.stopPropagation();
    const delta = {
      x: (event.clientX - current.x) / current.scale,
      y: (event.clientY - current.y) / current.scale,
    };
    current.moved ||= delta.x !== 0 || delta.y !== 0;
    if (!current.moved) return;
    if (current.grip === 'distant') {
      setSnap(null);
      if (current.distant && arrow) {
        const r = arrow.angle * Math.PI / 180;
        setDistant({ ...current.distant, offset: Math.max(0.01, current.distant.offset + delta.x * Math.cos(r) + delta.y * Math.sin(r)) });
      }
      return;
    }
    let offset = delta;
    if (current.grip === 'line') {
      const [from, to] = current.trace;
      const candidateA = { x: from.x + delta.x, y: from.y + delta.y };
      const candidateB = { x: to.x + delta.x, y: to.y + delta.y };
      const snapA = vm.findSnapPoint(candidateA);
      const kindA = vm.snapKindFor(snapA);
      const snapB = vm.findSnapPoint(candidateB);
      const kindB = vm.snapKindFor(snapB);
      const distanceA = snapA ? Math.hypot(snapA.x - candidateA.x, snapA.y - candidateA.y) : Infinity;
      const distanceB = snapB ? Math.hypot(snapB.x - candidateB.x, snapB.y - candidateB.y) : Infinity;
      const snapped = distanceA <= distanceB ? snapA : snapB;
      const fromPoint = distanceA <= distanceB ? from : to;
      setSnap(snapped);
      setSnapKind(distanceA <= distanceB ? kindA : kindB);
      if (snapped) offset = { x: snapped.x - fromPoint.x, y: snapped.y - fromPoint.y };
    }
    if (current.grip === 'start' || current.grip === 'end') {
      const [from, to] = current.trace;
      const anchor = current.grip === 'start' ? to : from;
      const grip = current.grip === 'start' ? from : to;
      const point = { x: grip.x + delta.x, y: grip.y + delta.y };
      const reference = vm.findSnapPoint(point);
      const constrained = resolveDirection(anchor, point, reference, event.shiftKey);
      const resolved = constrained ?? reference ?? point;
      const accepted = reference && Math.hypot(resolved.x - reference.x, resolved.y - reference.y) < 1e-8;
      setSnap(accepted ? reference : null);
      setSnapKind(accepted ? vm.snapKindFor(reference) : null);
      offset = { x: resolved.x - grip.x, y: resolved.y - grip.y };
    }
    const trace = dragVerticalViewTrace(current.trace, current.grip, offset);
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
      setDistant(current.distant);
      setStart(current.trace[0]);
      setEnd(current.trace[1]);
    } else {
      updateDrag(event);
    }
    drag.current = null;
    resetDirection();
    setSnap(null);
    setDragging(false);
  }

  return <div className="pointer-events-none absolute inset-0 z-10">
    <svg ref={svgRef} className={`pointer-events-auto absolute inset-0 h-full w-full text-primary ${edit ? 'touch-none' : 'cursor-crosshair'} ${dragging ? 'cursor-grabbing' : ''}`}
      aria-label={t(edit ? 'section2d.create.editLine' : 'section2d.create.trace')}
      onPointerMove={updateDrag}
      onPointerUp={event => finishDrag(event)}
      onPointerCancel={event => finishDrag(event, true)}
      onLostPointerCapture={event => finishDrag(event, true)}
      onMouseDown={event => {
        event.stopPropagation();
        if (event.button === 1) vm.canvasMouseHandlers.onMouseDown(event);
      }}
      onMouseUp={event => event.stopPropagation()}
      onMouseMove={event => {
        event.stopPropagation();
        if (event.buttons & 4) { vm.canvasMouseHandlers.onMouseMove(event); return; }
        if (!end) setCursor(point(event));
      }}
      onMouseLeave={() => { if (!drag.current) setSnap(null); }}
      onClick={event => {
        if (edit || naming || !(scale > 0)) return;
        const next = point(event);
        if (!start || end) { resetDirection(); setStart(next); setEnd(undefined); setCursor(next); }
        else if (verticalViewPlane(start, next, drawnPlane.flipped, reverse)) setEnd(next);
      }}>
      {a && !edit && <circle cx={a.x} cy={a.y} r="3" fill="currentColor" />}
      {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth="2" strokeDasharray={end ? undefined : '6 4'} />}
      {edit && a && b && offset && <g className="cursor-grab" onPointerDown={event => beginDrag(event, 'distant')}>
        <line x1={a.x + offset.x} y1={a.y + offset.y} x2={b.x + offset.x} y2={b.y + offset.y} stroke="transparent" strokeWidth="20" />
        <line x1={a.x + offset.x} y1={a.y + offset.y} x2={b.x + offset.x} y2={b.y + offset.y}
          stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 5" />
      </g>}
      {edit && a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="transparent" strokeWidth="22" pointerEvents="stroke"
        className="cursor-grab touch-none" onPointerDown={event => beginDrag(event, 'line')} />}
      {arrow && <path transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
        d="M0 0H24m-7-5 7 5-7 5" stroke="currentColor" strokeWidth="2" fill="none" className="pointer-events-none" />}
      {edit && a && b && (['start', 'end'] as const).map(grip => {
        const at = grip === 'start' ? a : b;
        return <circle key={grip} cx={at.x} cy={at.y} r={6}
          fill="var(--paper, #fff)" stroke="currentColor" strokeWidth={2}
          className="cursor-crosshair touch-none" pointerEvents="all"
          role="button" tabIndex={0}
          aria-label={`${t('section2d.tools.edit')} · ${grip === 'start' ? '1' : '2'}`}
          onPointerDown={event => beginDrag(event, grip)}
          onKeyDown={event => {
            if (!start || !end || dragging) return;
            const step = event.shiftKey ? 10 : 1;
            const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
            const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
            if (!dx && !dy) return;
            event.preventDefault(); event.stopPropagation();
            if (!(scale > 0)) return;
            const trace = dragVerticalViewTrace([start, end], grip, { x: dx / scale, y: dy / scale });
            if (trace) { setStart(trace[0]); setEnd(trace[1]); }
          }} />;
      })}
      {snap && <g pointerEvents="none" transform={`translate(${toScreen(snap).x} ${toScreen(snap).y})`}>
        <DrawingSnapGlyph kind={snapKind} />
      </g>}
    </svg>
    <div role="toolbar" aria-label={t(edit ? 'section2d.tools.edit' : 'section2d.create.trace')}
      className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <span className="shrink-0 px-2 font-medium" aria-live="polite">{t(edit ? 'section2d.create.editLine'
        : end ? 'section2d.create.confirmLine' : start ? 'section2d.create.second' : 'section2d.create.first')}</span>
      {edit && <Select disabled={!!annotationView?.annotationOptions?.styleIds?.[kind]}
        value={annotationView?.annotationOptions?.styleIds?.[kind] ?? markerView?.markerStyleId ?? 'default'}
        onValueChange={value => {
          try { setViewMarkerStyle(edit.id, value === 'default' ? undefined : value); setStyleFailed(false); }
          catch (error) { console.warn('Could not change marker style', error); setStyleFailed(true); }
        }}>
        <SelectTrigger className="h-7 w-24 text-xs" aria-label={t('section2d.markerStyles.title')}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t('section2d.markerStyles.default')}</SelectItem>
          {markerStyles?.filter(style => style.kind === kind).map(style => (
            <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>}
      {styleFailed && <span role="alert" className="text-destructive">{t('section2d.tagLibrary.saveFailed')}</span>}
      {edit && <label className="flex shrink-0 items-center gap-1">
        <input type="checkbox" checked={!!distant} onChange={e => setDistant(e.target.checked ? { ...DEFAULT_DISTANT } : null)} />
        {distant ? t('section2d.distant.offsetLabel', { offset: distant.offset.toFixed(2) }) : t('section2d.distant.label')}
      </label>}
      <Button size="sm" variant="outline" className="shrink-0" disabled={!start} onClick={() => setReverse(value => !value)}>{t('sectionPlanes.flip.label')}</Button>
      <Button size="sm" variant="ghost" className="shrink-0" onClick={close}>{t('section2d.create.cancel')}</Button>
      <Button size="sm" className="shrink-0" disabled={!custom || naming || dragging} onClick={() => {
        if (!edit) { setNaming(true); return; }
        if (!start || !end || useSavedSectionCuts.getState().projectId !== project) return;
        editSavedViewTrace(edit.id, [world(start), world(end)], drawnPlane.flipped !== reverse, distant);
        close();
      }}>{t('section2d.tags.apply')}</Button>

    </div>
    {naming && start && end && custom && <ViewIdentityDialog name={t(`section2d.views.type.${kind}`)}
      scale={{ value: vm.publicationScale, table: vm.lineweightSettings.table }}
      code={nextViewCode(kind, useSavedSectionCuts.getState().cuts)} close={() => setNaming(false)}
      save={(name, code, scale) => {
        if (useSavedSectionCuts.getState().projectId !== project) return;
        createDrawingView(name, kind, { axis: 'front', position: 50, custom }, undefined, code, [world(start), world(end)], scale);
        close();
      }} />}
  </div>;
}
