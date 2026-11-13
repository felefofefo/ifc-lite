/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { Button } from '@/components/ui/button';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { useTranslation } from '@/i18n';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { verticalViewPlane } from '@/lib/drawing/view-placement';
import { createDrawingView, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';

export type VerticalViewKind = 'section' | 'elevation';

export function PlaceVerticalView({ kind, vm, close }: {
  kind: VerticalViewKind; vm: DrawingViewModel; close: () => void;
}) {
  const { t } = useTranslation();
  const { promptDialog } = useDialogs();
  const [start, setStart] = useState<Point2D>();
  const [cursor, setCursor] = useState<Point2D>();
  const [end, setEnd] = useState<Point2D>();
  const [reverse, setReverse] = useState(false);
  const [failed, setFailed] = useState(false);
  const [naming, setNaming] = useState(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
    if (start && event.shiftKey) {
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

  async function save() {
    const custom = start && end && verticalViewPlane(start, end, drawnPlane.flipped, reverse);
    if (!custom || naming) return;
    setNaming(true);
    const name = (await promptDialog({ description: t('section2d.views.name'), defaultValue: t(`section2d.views.type.${kind}`) }))?.trim();
    if (!mounted.current) return;
    setNaming(false);
    if (!name || useSavedSectionCuts.getState().projectId !== project) return;
    try {
      createDrawingView(name, kind, { axis: 'front', position: 50, custom });
      close();
    } catch { setFailed(true); }
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
        if (!start || end) { setStart(next); setEnd(undefined); setCursor(next); setFailed(false); }
        else if (verticalViewPlane(start, next, drawnPlane.flipped, reverse)) setEnd(next);
      }}>
      {a && <circle cx={a.x} cy={a.y} r="3" fill="currentColor" />}
      {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth="2" strokeDasharray={end ? undefined : '6 4'} />}
      {arrow && <path transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
        d="M0 0H24m-7-5 7 5-7 5" stroke="currentColor" strokeWidth="2" fill="none" />}
    </svg>
    <div className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
      onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
      <span aria-live="polite">{t(end ? 'section2d.create.confirmLine' : start ? 'section2d.create.second' : 'section2d.create.first')}</span>
      <Button size="sm" variant="outline" disabled={!start} onClick={() => setReverse(value => !value)}>{t('sectionPlanes.flip.label')}</Button>
      <Button size="sm" variant="ghost" onClick={close}>{t('section2d.create.cancel')}</Button>
      <Button size="sm" disabled={!end || naming} onClick={() => void save()}>{t('section2d.views.save')}</Button>
      {failed && <span role="alert" className="text-destructive">{t('section2d.views.saveError')}</span>}
    </div>
  </div>;
}
