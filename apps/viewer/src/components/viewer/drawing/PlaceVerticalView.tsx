/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useState, type MouseEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { ViewIdentityDialog } from './ViewIdentityFields';
import { nextViewCode } from '@/lib/drawing/view-markers';
import { useTranslation } from '@/i18n';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { verticalViewPlane } from '@/lib/drawing/view-placement';
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
  const [editMode, setEditMode] = useState<'move' | 'start' | 'end'>();
  const [moveFrom, setMoveFrom] = useState<Point2D>();
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

  function editPoint(next: Point2D) {
    if (!editMode || !start || !end) return;
    if (editMode === 'move' && !moveFrom) { setMoveFrom(next); return; }
    const translate = (p: Point2D) => ({ x: p.x + next.x - moveFrom!.x, y: p.y + next.y - moveFrom!.y });
    const a = editMode === 'start' ? next : editMode === 'move' ? translate(start) : start;
    const b = editMode === 'end' ? next : editMode === 'move' ? translate(end) : end;
    if (!verticalViewPlane(a, b, drawnPlane.flipped, reverse)) return;
    setStart(a);
    setEnd(b);
    setMoveFrom(undefined);
    setEditMode(undefined);
  }

  return <div className="pointer-events-none absolute inset-0 z-10">
    <svg className="pointer-events-auto absolute inset-0 h-full w-full cursor-crosshair text-primary"
      aria-label={t('section2d.create.trace')}
      onMouseDown={event => event.stopPropagation()}
      onMouseUp={event => event.stopPropagation()}
      onMouseMove={event => { event.stopPropagation(); if (!end) setCursor(point(event)); }}
      onClick={event => {
        if (naming || !(scale > 0)) return;
        const next = point(event);
        if (edit) { editPoint(next); return; }
        if (!start || end) { setStart(next); setEnd(undefined); setCursor(next); }
        else if (verticalViewPlane(start, next, drawnPlane.flipped, reverse)) setEnd(next);
      }}>
      {a && <circle cx={a.x} cy={a.y} r="3" fill="currentColor" />}
      {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth="2" strokeDasharray={end ? undefined : '6 4'} />}
      {arrow && <path transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
        d="M0 0H24m-7-5 7 5-7 5" stroke="currentColor" strokeWidth="2" fill="none" />}
    </svg>
    <div className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <span aria-live="polite">{t(edit
        ? editMode === 'move' ? moveFrom ? 'section2d.create.moveTo' : 'section2d.create.moveFrom'
          : editMode ? 'section2d.create.adjustPoint' : 'section2d.create.editLine'
        : end ? 'section2d.create.confirmLine' : start ? 'section2d.create.second' : 'section2d.create.first')}</span>
      {edit && (['move', 'start', 'end'] as const).map(mode => (
        <Button key={mode} size="sm" variant={editMode === mode ? 'secondary' : 'outline'}
          onClick={() => { setEditMode(mode); setMoveFrom(undefined); }}>{t(`section2d.create.edit.${mode}`)}</Button>
      ))}
      <Button size="sm" variant="outline" disabled={!start} onClick={() => setReverse(value => !value)}>{t('sectionPlanes.flip.label')}</Button>
      <Button size="sm" variant="ghost" onClick={close}>{t('section2d.create.cancel')}</Button>
      <Button size="sm" disabled={!custom || naming} onClick={() => {
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
