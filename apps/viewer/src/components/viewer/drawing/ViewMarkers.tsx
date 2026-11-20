/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { snapDrawingAngle } from '@/lib/drawing/dimension-line';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { PlaceVerticalView } from './PlaceVerticalView';
import { collectViewMarkers, DEFAULT_VIEW_MARKERS, markerHeadPoint, markerLineDash, markerLineWidth, markerTraceLines } from '@/lib/drawing/view-markers';
import { resolveMarkerHeads } from '@/lib/drawing/drawing-tag-library';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { applySavedSectionCut, editSavedViewTrace, setViewMarkerStyle, selectActiveSavedView, drawingAnnotationVisible, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';

export function ViewMarkers({ vm }: { vm: DrawingViewModel }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>();
  const [editId, setEditId] = useState<string>();
  const [failed, setFailed] = useState(false);
  const markerDrag = useRef<{ pointerId: number; id: string; clientX: number; clientY: number;
    start: Point2D; end: Point2D; reverse: boolean; moved: boolean } | null>(null);
  const [markerPreview, setMarkerPreview] = useState<{
    id: string; start: Point2D; end: Point2D; reference: Point2D | null;
  } | null>(null);
  const views = useSavedSectionCuts(s => s.cuts);
  const { templates, markerStyles } = useSavedSectionCuts(s => s.tagLibrary);
  const annotationView = useSavedSectionCuts(selectActiveSavedView);
  const { drawing, viewTransform, drawnPlane } = vm;
  useEffect(() => { setSelectedId(undefined); setEditId(undefined); setFailed(false); vm.setSelectedMarker(null); }, [annotationView?.id]);
  useEffect(() => { if (!vm.selectedMarker) setSelectedId(undefined); }, [vm.selectedMarker?.id]);
  const bounds = vm.runtime.geometryResult?.coordinateInfo.shiftedBounds;
  const markers = useMemo(() => {
    if (!bounds || drawnPlane.axis !== 'down' || drawnPlane.custom) return [];
    const flags = annotationView?.annotationOptions ? DEFAULT_VIEW_MARKERS : annotationView?.markers ?? DEFAULT_VIEW_MARKERS;
    return collectViewMarkers(views, bounds, drawnPlane.flipped, flags).map(mark => {
      const override = annotationView?.annotationOptions?.styleIds?.[mark.kind];
      return override && markerStyles?.some(style => style.id === override && style.kind === mark.kind)
        ? { ...mark, styleId: override } : mark;
    }).filter(mark => drawingAnnotationVisible(annotationView, mark.kind, mark.styleId)).map(mark => {
      const angle = Math.atan2(mark.direction.y, mark.direction.x) * 180 / Math.PI;
      const line = mark.kind === 'section' ? markerStyles?.find(style => style.id === mark.styleId && style.kind === mark.kind)?.line : undefined;
      return { ...mark, angle, line, heads: resolveMarkerHeads(templates, mark, markerStyles, angle) };
    });
  }, [views, annotationView, bounds, drawnPlane.axis, drawnPlane.custom, drawnPlane.flipped, templates, markerStyles]);
  if (!drawing || !bounds || drawnPlane.axis !== 'down' || drawnPlane.custom) return null;
  // A Move command needs unobstructed clicks on the drawing surface.
  const placingDimension = vm.annotation2DActiveTool === 'measure' || vm.annotation2DActiveTool === 'move';
  const editing = placingDimension ? undefined : markers.find(marker => marker.id === editId);
  if (editing) {
    const dx = editing.end.x - editing.start.x, dy = editing.end.y - editing.start.y;
    const reverse = -dy * editing.direction.x + dx * editing.direction.y < 0;
    return <PlaceVerticalView key={editing.id} kind={editing.kind} vm={vm}
      edit={{ ...editing, reverse, distant: views.find(view => view.id === editing.id)?.display?.distantElements }} close={() => setEditId(undefined)} />;
  }
  const sheet = vm.sheetEnabled && vm.activeSheet ? resolveSheetTransform({
    sheet: vm.activeSheet, axis: 'down', isPinned: vm.isPinned, cached: vm.cachedSheetTransformRef.current,
    drawingBounds: { minX: drawing.bounds.min.x, minY: drawing.bounds.min.y, maxX: drawing.bounds.max.x, maxY: drawing.bounds.max.y },
  }).transform : null;
  const scale = viewTransform.scale * (sheet?.scaleFactor ?? 1);
  const tx = viewTransform.x + (sheet?.translateX ?? 0) * viewTransform.scale;
  const ty = viewTransform.y + (sheet?.translateY ?? 0) * viewTransform.scale;
  const paperUnit = sheet ? viewTransform.scale : scale * vm.publicationScale / 1000;
  const selected = placingDimension ? undefined : markers.find(mark => mark.id === selectedId);
  function updateMarkerDrag(event: PointerEvent<SVGGElement>, finish = false) {
    const drag = markerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const dx = (event.clientX - drag.clientX) / scale;
    const dy = (event.clientY - drag.clientY) / scale;
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) {
      if (finish) { markerDrag.current = null; setMarkerPreview(null); }
      return;
    }
    drag.moved = true;
    const raw: Point2D = { x: drag.start.x + dx, y: drag.start.y + dy };
    const reference = vm.findSnapPoint(raw);
    const angled = vm.angularSnap !== 'off'
      ? snapDrawingAngle(drag.start, raw, 0, Number(vm.angularSnap)) : null;
    const next = reference && (!angled || Math.hypot(reference.x - angled.x, reference.y - angled.y) < 1e-8)
      ? reference : angled ?? reference ?? raw;
    const delta = { x: next.x - drag.start.x, y: next.y - drag.start.y };
    const shifted: typeof markerPreview = { id: drag.id,
      start: { x: drag.start.x + delta.x, y: drag.start.y + delta.y },
      end: { x: drag.end.x + delta.x, y: drag.end.y + delta.y },
      reference: reference ?? (angled ? next : null) };
    if (!finish) { setMarkerPreview(shifted); return; }
    markerDrag.current = null;
    setMarkerPreview(null);
    try {
      const world = (p: Point2D) => ({ x: drawnPlane.flipped ? -p.x : p.x, y: p.y });
      editSavedViewTrace(drag.id, [world(shifted.start), world(shifted.end)],
        drawnPlane.flipped !== drag.reverse);
      vm.setSelectedMarker(current => current?.id === drag.id
        ? { ...current, start: shifted.start, end: shifted.end } : current);
    } catch (error) { console.warn('Could not move section/elevation trace', error); setFailed(true); }
  }
  return <>
  <svg className="pointer-events-none absolute inset-0 h-full w-full text-primary">
    {markers.map(original => {
      const mark = markerPreview && markerPreview.id === original.id
        ? { ...original, start: markerPreview.start, end: markerPreview.end } : original;
      const { kind, angle, heads, line } = mark;
      const x1 = mark.start.x * scale + tx, x2 = mark.end.x * scale + tx;
      const y1 = mark.start.y * scale + ty, y2 = mark.end.y * scale + ty;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const distant = views.find(view => view.id === mark.id)?.display?.distantElements;
      const dx = mark.direction.x * (distant?.offset ?? 0) * scale;
      const dy = mark.direction.y * (distant?.offset ?? 0) * scale;
      const open = () => applySavedSectionCut(mark.id);
      const select = () => {
        vm.tags.clearSelection();
        vm.clearAnnotationSelection();
        setSelectedId(mark.id);
        const dx = mark.end.x - mark.start.x, dy = mark.end.y - mark.start.y;
        vm.setSelectedMarker({ id: mark.id, start: mark.start, end: mark.end,
          reverse: -dy * mark.direction.x + dx * mark.direction.y < 0, distant });
      };
      return <ContextMenu key={mark.id}><ContextMenuTrigger asChild><g role="button" tabIndex={placingDimension ? -1 : 0} aria-label={`${mark.code} ${mark.name}`} aria-pressed={selectedId === mark.id}
        className={selectedId === mark.id ? 'cursor-grab touch-none outline-none focus-visible:opacity-60' : 'cursor-pointer outline-none focus-visible:opacity-60'}
        onPointerDown={event => {
          if (event.button !== 0 || placingDimension || vm.annotation2DActiveTool !== 'none' || selectedId !== mark.id) return;
          event.stopPropagation();
          markerDrag.current = { pointerId: event.pointerId, id: mark.id, clientX: event.clientX, clientY: event.clientY,
            start: original.start, end: original.end,
            reverse: -((original.end.y - original.start.y) * original.direction.x)
              + (original.end.x - original.start.x) * original.direction.y < 0, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => updateMarkerDrag(event)}
        onPointerUp={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          updateMarkerDrag(event, true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { markerDrag.current = null; setMarkerPreview(null); }}
        onLostPointerCapture={() => { markerDrag.current = null; setMarkerPreview(null); }}
        onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); select(); }} onDoubleClick={e => { e.stopPropagation(); open(); }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Enter') open();
            else select();
          }
        }}>
        <title>{mark.name}</title>
        {distant && <line x1={x1 + dx} y1={y1 + dy} x2={x2 + dx} y2={y2 + dy} stroke="currentColor" strokeDasharray="5 5" opacity="0.55" />}
        <line className={placingDimension ? undefined : "pointer-events-auto"} x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="20" />
        {markerTraceLines(mark, paperUnit / scale, line).map(([a, b], index) => (
          <line key={index} x1={a.x * scale + tx} y1={a.y * scale + ty} x2={b.x * scale + tx} y2={b.y * scale + ty}
            stroke={selectedId === mark.id ? 'currentColor' : line?.color ?? 'currentColor'}
            strokeWidth={line ? Math.max(0.65, markerLineWidth(line, vm.lineweights) * paperUnit) + (selectedId === mark.id ? 1 : 0) : selectedId === mark.id ? 2.5 : 1.5}
            strokeDasharray={line ? markerLineDash(line, kind).map(value => value * paperUnit).join(' ') || undefined
              : kind === 'elevation' ? '4 4' : '12 4'} />
        ))}
        {heads.length ? heads.map(({ slot, graphic }) => {
          const point = markerHeadPoint(mark, slot);
          return <image key={slot} href={graphic.href}
            className={placingDimension ? undefined : 'pointer-events-auto'}
            transform={`translate(${point.x * scale + tx} ${point.y * scale + ty}) rotate(${graphic.directional ? 0 : angle})`}
            x={-graphic.anchor.x * paperUnit} y={-graphic.anchor.y * paperUnit}
            width={graphic.width * paperUnit} height={graphic.height * paperUnit} />;
        }) : <>
          <path transform={`translate(${mx} ${my}) rotate(${angle})`} d="M0 0H19m-6-4 6 4-6 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <text className={`fill-current stroke-background [paint-order:stroke] [stroke-width:3px] text-xs font-semibold ${placingDimension ? '' : 'pointer-events-auto'}`}
            x={mx + mark.direction.x * 25} y={my + mark.direction.y * 25} textAnchor="middle" dominantBaseline="central">{mark.code}</text>
        </>}
      </g></ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setEditId(mark.id)}>{t('section2d.create.editLine')}</ContextMenuItem>

        </ContextMenuContent>
      </ContextMenu>;
    })}
  </svg>
  {markerPreview?.reference && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full"
    fill="none" stroke="#4CAF50" strokeWidth={1.5}>
    <g transform={`translate(${markerPreview.reference.x * scale + tx} ${markerPreview.reference.y * scale + ty})`}>
      <path d="M-12 0H12M0-12V12" /><circle r="6" />
    </g>
  </svg>}
  {failed && <p role="alert" className="absolute left-3 top-3 rounded-md border bg-background px-2 py-1 text-xs text-destructive">
    {t('section2d.tagLibrary.saveFailed')}
  </p>}
  {selected && <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-background p-1 shadow-sm"
    onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
    <span className="max-w-36 truncate px-2 text-xs font-medium">
      {t(`section2d.annotationKind.${selected.kind}`)} · {selected.code}
    </span>
    <Select disabled={!!annotationView?.annotationOptions?.styleIds?.[selected.kind]} value={selected.styleId ?? (selected.symbolId ? 'legacy' : 'default')} onValueChange={value => {
      try {
        setViewMarkerStyle(selected.id, value === 'default' ? undefined : value);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }}>
      <SelectTrigger className="h-7 w-36 text-xs" aria-label={t('section2d.markerStyles.title')}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="default">{t('section2d.markerStyles.default')}</SelectItem>
        {selected.symbolId && !selected.styleId && <SelectItem value="legacy" disabled>{t('section2d.markerStyles.legacy')}</SelectItem>}
        {markerStyles?.filter(style => style.kind === selected.kind).map(style => (
          <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Button size="sm" variant="ghost" onClick={() => setEditId(selected.id)}>{t('section2d.tools.edit')}</Button>
    <Button size="sm" variant="ghost" onClick={() => { setSelectedId(undefined); vm.setSelectedMarker(null); }}>{t('section2d.create.cancel')}</Button>
  </div>}
  </>;
}
