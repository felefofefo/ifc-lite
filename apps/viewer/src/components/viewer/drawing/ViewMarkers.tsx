/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useEffect, useState } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';
import { PlaceVerticalView } from './PlaceVerticalView';
import { collectViewMarkers, DEFAULT_VIEW_MARKERS } from '@/lib/drawing/view-markers';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { applySavedSectionCut, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';

export function ViewMarkers({ vm }: { vm: DrawingViewModel }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>();
  const [editId, setEditId] = useState<string>();
  const views = useSavedSectionCuts(s => s.cuts);
  const active = useSavedSectionCuts(s => s.activeCutId);
  const { drawing, viewTransform, drawnPlane } = vm;
  useEffect(() => { setSelectedId(undefined); setEditId(undefined); }, [active]);
  const bounds = vm.runtime.geometryResult?.coordinateInfo.shiftedBounds;
  if (!drawing || !bounds || drawnPlane.axis !== 'down' || drawnPlane.custom) return null;
  const flags = views.find(v => v.id === active)?.markers ?? DEFAULT_VIEW_MARKERS;
  const markers = collectViewMarkers(views, bounds, drawnPlane.flipped, flags);
  const editing = markers.find(marker => marker.id === editId);
  if (editing) {
    const dx = editing.end.x - editing.start.x, dy = editing.end.y - editing.start.y;
    const reverse = -dy * editing.direction.x + dx * editing.direction.y < 0;
    return <PlaceVerticalView key={editing.id} kind={editing.kind} vm={vm}
      edit={{ ...editing, reverse }} close={() => setEditId(undefined)} />;
  }
  const sheet = vm.sheetEnabled && vm.activeSheet ? resolveSheetTransform({
    sheet: vm.activeSheet, axis: 'down', isPinned: vm.isPinned, cached: vm.cachedSheetTransformRef.current,
    drawingBounds: { minX: drawing.bounds.min.x, minY: drawing.bounds.min.y, maxX: drawing.bounds.max.x, maxY: drawing.bounds.max.y },
  }).transform : null;
  const scale = viewTransform.scale * (sheet?.scaleFactor ?? 1);
  const tx = viewTransform.x + (sheet?.translateX ?? 0) * viewTransform.scale;
  const ty = viewTransform.y + (sheet?.translateY ?? 0) * viewTransform.scale;
  const selected = markers.find(mark => mark.id === selectedId);
  return <>
  <svg className="pointer-events-none absolute inset-0 h-full w-full text-primary">
    {markers.map(mark => {
      const { kind } = mark;
      const x1 = mark.start.x * scale + tx, x2 = mark.end.x * scale + tx;
      const y1 = mark.start.y * scale + ty, y2 = mark.end.y * scale + ty;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const angle = Math.atan2(mark.direction.y, mark.direction.x) * 180 / Math.PI;
      const open = () => applySavedSectionCut(mark.id);
      return <ContextMenu key={mark.id}><ContextMenuTrigger asChild><g role="button" tabIndex={0} aria-label={`${mark.code} ${mark.name}`} aria-pressed={selectedId === mark.id}
        className="cursor-pointer outline-none focus-visible:opacity-60"
        onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); setSelectedId(mark.id); }} onDoubleClick={e => { e.stopPropagation(); open(); }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault(); e.stopPropagation();
            if (e.key === 'Enter') open();
            else setSelectedId(mark.id);
          }
        }}>
        <title>{mark.name}</title>
        <line className="pointer-events-auto" x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="20" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={selectedId === mark.id ? 2.5 : 1.5} strokeDasharray={kind === 'elevation' ? '4 4' : '12 4'} />
        <path transform={`translate(${mx} ${my}) rotate(${angle})`} d="M0 0H19m-6-4 6 4-6 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <text className="pointer-events-auto fill-current stroke-background [paint-order:stroke] [stroke-width:3px] text-xs font-semibold"
          x={mx + mark.direction.x * 25} y={my + mark.direction.y * 25} textAnchor="middle" dominantBaseline="central">{mark.code}</text>
      </g></ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setEditId(mark.id)}>{t('section2d.create.editLine')}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>;
    })}
  </svg>
  {selected && <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md border bg-background p-1 shadow-sm"
    onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
    <span className="px-1 text-xs font-medium">{selected.code}</span>
    <Button size="sm" variant="ghost" onClick={() => setEditId(selected.id)}>{t('section2d.create.editLine')}</Button>
    <Button size="sm" variant="ghost" onClick={() => setSelectedId(undefined)}>{t('section2d.create.cancel')}</Button>
  </div>}
  </>;
}
