/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { usePublicationFillPreview } from '@/hooks/usePublicationFillPreview';
import { Spinner } from '@/components/ui/spinner';

/** The Drawing panel's canvas region (#5494): the drawing with its markup and
 *  layers, the generating / error / empty states, and the only thing that
 *  still floats over the paper, the text annotation editor. */


import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { createLineworkSource } from '@/lib/snap/sources/linework';
import { solveSnap } from '@/lib/snap/solve';
import type { SnapKind, SnapProfile, SnapResult } from '@/lib/snap/types';
import { snapDrawingAngle } from '@/lib/drawing/dimension-line';
import { useTranslation } from '@/i18n';
import { Drawing2DCanvas } from '../Drawing2DCanvas';
import { TextAnnotationEditor } from '../TextAnnotationEditor';
import { ViewMarkers } from './ViewMarkers';
import { DrawingSnapGlyph } from './DrawingSnapGlyph';
import { DrawingMovePreview } from './DrawingMovePreview';
import { DrawingElementTags } from './DrawingElementTags';
import { useDrawingModelSelection } from './DrawingModelSelection';
import { PlaceVerticalView, type VerticalViewKind } from './PlaceVerticalView';
import { drawingAnnotationVisible } from '@/store/savedSectionCutsStore';
import { textAnnotationScreenSize } from '@/lib/drawing/annotation-types';
import type { DrawingViewModel } from './useDrawingViewModel';
import type { DrawingLayers } from './useDrawingLayers';

export function DrawingCanvasView({ vm, layers, placement, stopPlacement }: {
  vm: DrawingViewModel; layers: DrawingLayers; placement?: VerticalViewKind; stopPlacement: () => void;
}) {
  const annotationView = vm.savedView ?? (vm.viewAnnotationOptions ? { annotationOptions: vm.viewAnnotationOptions } : undefined);
  const fillPreview = usePublicationFillPreview();
  const areaTagFilterId = useId().replace(/:/g, '');
  const { t } = useTranslation();
  const { drawing, status, drawnPlane, viewTransform, markupTransform, displayOptions } = vm;
  const selection = useDrawingModelSelection(vm,
    status === 'ready' && !vm.selectOnly2D && vm.annotation2DActiveTool === 'none' && !placement && !vm.textAnnotation2DEditing, !placement);
  const hasContent = !!drawing && (drawing.cutPolygons.length > 0 || drawing.lines?.length > 0 || layers.dxfUnderlayData.length > 0 || vm.hasReferences);
  const editingAnnotation = vm.textAnnotation2DEditing
    ? vm.styledNotes.find((a) => a.id === vm.textAnnotation2DEditing) ?? vm.textAnnotations2D.find((a) => a.id === vm.textAnnotation2DEditing) ?? null
    : null;

  return (
    <div
      ref={vm.containerRef}
      data-drawing-canvas
      className={`relative min-h-0 flex-1 overflow-hidden bg-paper ${vm.cursorClass}`}
      {...selection.mouseHandlers}
    >
      {status === 'generating' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80">
          <Spinner className="mb-4 h-8 w-8 text-primary" />
          <div className="text-sm font-medium">{vm.progressPhase}</div>
          <div className="mt-2 h-2 w-48 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all duration-200" style={{ width: `${vm.progress}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">{Math.round(vm.progress)}%</div>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-destructive">
            <p className="font-medium">{t('section2d.error.generation')}</p>
            <p className="text-sm text-muted-foreground">{vm.drawingError}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => vm.runtime.generateDrawing(false)}>
              {t('section2d.error.retry')}
            </Button>
          </div>
        </div>
      )}

      {status === 'ready' && drawing && hasContent && (
        <Drawing2DCanvas
          drawing={drawing}
          snapshotSourceDrawing={vm.sourceDrawing ?? drawing}
          transform={viewTransform}
          showHiddenLines={displayOptions.showHiddenLines}
          overrideEngine={vm.overrideEngine}
          overridesEnabled={vm.overridesEnabled}
          entityColorMap={vm.entityColorMap}
          fillPreview={fillPreview}
          lineweights={vm.lineweights}
          printPreview={displayOptions.showPrintPreview}
          useIfcMaterials={(vm.activePresetId === null || vm.activePresetId === 'preset-3d-colors' || vm.activePresetId?.startsWith('drawing-template:') === true)}
          measureMode={vm.measure2DMode}
          dimensionStyle={vm.dimensionSettings.styles.get(vm.dimensionSettings.library.defaultId)}
          dimensionStyles={vm.dimensionSettings.styles}
          dimensionLabelHits={vm.dimensionEditing.dimensionLabelHits}
          publicationScale={vm.publicationScale}
          markupTransform={markupTransform}
          dimensionPreview={vm.dimensionPreview}
          dimensionPoints={vm.dimensionDraft.points}
          measureResults={drawingAnnotationVisible(annotationView, 'dimensions') ? vm.displayedMeasurements.filter(item => drawingAnnotationVisible(annotationView, 'dimensions', item.dimension?.styleId)) : []}
          sheetEnabled={vm.sheetEnabled}
          activeSheet={vm.activeSheet}
          sectionAxis={drawnPlane.axis}
          isPinned={vm.isPinned}
          cachedSheetTransformRef={vm.cachedSheetTransformRef}
          annotation2DActiveTool={vm.annotation2DActiveTool}
          annotation2DCursorPos={vm.annotation2DCursorPos}
          polygonAreaPoints={vm.polygonArea2DPoints}
          polygonAreaResults={vm.styledAreas}
          textAnnotations={vm.styledNotes}
          textAnnotationEditing={vm.textAnnotation2DEditing}
          cloudAnnotationPoints={vm.cloudAnnotation2DPoints}
          cloudAnnotations={vm.styledClouds}
          selectedAnnotation={vm.selectedAnnotation2D}
          hoveredAnnotation={placement ? null : selection.annotationHover}
          windowAnnotations={vm.windowCanvasAnnotations}
          ifcAnnotationLines={layers.ifcAnnotationData.lines}
          ifcAnnotationTexts={layers.ifcAnnotationData.texts}
          ifcAnnotationFills={layers.ifcAnnotationData.fills}
          dxfUnderlays={layers.dxfUnderlayData}
          scanPoints={displayOptions.showScanSection ? layers.scanSectionLayer.points : undefined}
          scanOpacity={displayOptions.scanSectionOpacity}
          scanOutline={displayOptions.showScanSection ? layers.scanSectionLayer.outline?.rings : undefined}
          unitDisplayOverrides={vm.unitDisplayOverrides}
          paperTheme={vm.paperTheme}
        />
      )}

      {/* Screen-sized snap feedback; unlike model geometry it must not be exported. */}
      {status === 'ready' && vm.measure2DSnapPoint && !placement
        && (vm.measure2DMode || ['polygon-area', 'text', 'cloud', 'move'].includes(vm.annotation2DActiveTool))
        && <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <g transform={`translate(${vm.measure2DSnapPoint.x * (drawnPlane.axis === 'side' ? -markupTransform.scale : markupTransform.scale) + markupTransform.x} ${vm.measure2DSnapPoint.y * (drawnPlane.axis === 'down' ? markupTransform.scale : -markupTransform.scale) + markupTransform.y})`}>
            <DrawingSnapGlyph kind={vm.snapKindFor(vm.measure2DSnapPoint)} />
          </g>
        </svg>}

      {/* A room footprint is a screen-only reference, not an IFC cut/surface fill
          or an authored Area. Keep it independent of IFC graphic overrides. */}
      {status === 'ready' && displayOptions.showAnnotations
        && vm.viewAnnotationOptions?.visibility?.roomBoundaries === true
        && vm.ifcSpaceRooms.length > 0 && <svg aria-label={t('section2d.viewOptions.roomBoundaries')}
          className="pointer-events-none absolute inset-0 h-full w-full"
          data-room-boundaries="true" pointerEvents="none"
          fill="#0d9488" fillOpacity={0.07} fillRule="evenodd"
          stroke="#0d9488" strokeOpacity={0.65} strokeWidth={1} strokeDasharray="5 3">
          {vm.ifcSpaceRooms.flatMap(room => room.polygons.map((polygon, index) =>
            <path key={room.id + ':' + index} d={[polygon.outer, ...polygon.holes].map(ring =>
              ring.map((point, i) =>
                (i === 0 ? 'M' : 'L') + (point.x * markupTransform.scale + markupTransform.x)
                + ' ' + (point.y * markupTransform.scale + markupTransform.y)).join(' ') + ' Z'
            ).join(' ')} />
          ))}
        </svg>}
      {status === 'ready' && displayOptions.showAnnotations && vm.areaTagRects.length > 0 &&
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <defs className="text-primary">
            {(['hover', 'selected'] as const).map(state => <filter key={state} id={`${areaTagFilterId}-${state}`} colorInterpolationFilters="sRGB">
              <feFlood floodColor="currentColor" floodOpacity={state === 'hover' ? 0.55 : 1} result="tint" />
              <feBlend in="SourceGraphic" in2="tint" mode="screen" result="highlight" />
              <feComposite in="highlight" in2="SourceAlpha" operator="in" />
            </filter>)}
          </defs>
          {vm.areaTagRects.map(({ id, href, x, y, width, height }) => {
            const selected = vm.selectedAnnotation2D?.type === 'polygon' && vm.selectedAnnotation2D.id === id
              || vm.windowAnnotations.some(item => item.type === 'polygon' && item.id === id);
            const hovered = !placement && selection.annotationHover?.type === 'polygon' && selection.annotationHover.id === id;
            return <image key={id} href={href} x={x} y={y} width={width} height={height}
              filter={selected || hovered ? `url(#${areaTagFilterId}-${selected ? 'selected' : 'hover'})` : undefined} />;
          })}
        </svg>}
      {status === 'ready' && selection.overlay}
      {status === 'ready' && vm.editableAnnotationId && vm.selectedAnnotation2D?.type === 'polygon'
        && vm.selectedAnnotation2D.id === vm.editableAnnotationId && vm.annotation2DActiveTool === 'none'
        && <AreaVertexHandles vm={vm} id={vm.editableAnnotationId} />}
      {status === 'ready' && vm.editableAnnotationId && vm.selectedAnnotation2D?.type === 'cloud'
        && vm.selectedAnnotation2D.id === vm.editableAnnotationId && vm.annotation2DActiveTool === 'none'
        && <CloudResizeHandles vm={vm} id={vm.editableAnnotationId} />}
      {status === 'ready' && <DrawingMovePreview vm={vm} />}
      {status === 'ready' && vm.annotation2DActiveTool === 'move' && <div
        className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-sm"
        role="status">{t(vm.moveBase ? 'section2d.tools.moveTarget' : 'section2d.tools.moveBase')}</div>}
      {status === 'ready' && displayOptions.showAnnotations && !placement && <ViewMarkers vm={vm} cycleTarget={selection.cycleTarget} />}
      {status === 'ready' && displayOptions.showAnnotations && !placement && <DrawingElementTags vm={vm} cycleTarget={selection.cycleTarget} />}
      {placement && <PlaceVerticalView key={`${placement}:${drawing?.config.plane.position}:${drawnPlane.flipped}`} kind={placement} vm={vm} close={stopPlacement} />}
      {status === 'ready' && !placement && vm.windowAnnotations.length > 0 && vm.annotation2DActiveTool === 'none' && <div role="toolbar"
        aria-label={t('section2d.tools.select')}
        className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
        onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <span className="px-2 font-medium">{vm.windowAnnotations.length} selected</span>
        <Button size="sm" variant="ghost" onClick={vm.startMove}>{t('section2d.tools.move')}</Button>
        <Button size="sm" variant="ghost" disabled={!vm.canCopy} onClick={vm.copySelection}>{t('section2d.tools.copy')}</Button>
        <Button size="sm" variant="ghost" disabled={!vm.canCut} onClick={vm.cutSelection}>{t('section2d.tools.cut')}</Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={!vm.canDelete}
          onClick={() => { void vm.requestDeleteSelection(); }}>{t('section2d.tags.remove')}</Button>
        <Button size="sm" variant="ghost" onClick={vm.clearWindowAnnotations}>{t('section2d.tags.close')}</Button>
      </div>}
      {status === 'ready' && vm.selectedAnnotation2D && !vm.tags.selected && !vm.selectedMarker
        && vm.annotation2DActiveTool === 'none' && <div role="toolbar"
          aria-label={t('section2d.tools.select')}
          className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap rounded-md border bg-background p-1 text-xs shadow-sm"
          onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
          <span className="max-w-36 shrink-0 truncate px-2 font-medium">
            {vm.selectedAnnotation2D.type === 'measure' ? t('section2d.dimensionStyle.title')
              : vm.selectedAnnotation2D.type === 'polygon' ? t('section2d.annotationKind.area')
              : vm.selectedAnnotation2D.type === 'cloud' ? t('section2d.annotationKind.cloud')
              : t('section2d.annotationKind.text')}
          </span>
          {vm.selectedAnnotationStyle && <Select disabled={vm.selectedAnnotationStyle.locked}
            value={vm.selectedAnnotationStyle.value} onValueChange={vm.changeSelectedAnnotationStyle}>
            <SelectTrigger className="h-7 w-32 text-xs" aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {vm.selectedAnnotationStyle.kind !== 'dimensions' &&
                <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>}
              {vm.selectedAnnotationStyle.choices.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
            </SelectContent>
          </Select>}
          {vm.selectedArea && <>
            <Select value={vm.selectedArea.tagTemplateId ?? '__no_area_tag__'}
              onValueChange={id => vm.updateSelectedAreaTag({ tagTemplateId: id === '__no_area_tag__' ? undefined : id })}>
              <SelectTrigger className="h-7 w-36 text-xs" aria-label="Area tag"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__no_area_tag__">No area tag</SelectItem>
                {vm.selectedArea.tagTemplateId && !vm.areaTagTemplates.some(item => item.id === vm.selectedArea?.tagTemplateId)
                  && <SelectItem value={vm.selectedArea.tagTemplateId} disabled>Missing tag template</SelectItem>}
                {vm.areaTagTemplates.map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {vm.selectedArea.tagTemplateId && <Input className="h-7 w-32 text-xs" aria-label="Area name"
              placeholder="Area name" maxLength={200} value={vm.selectedArea.tagName ?? ''}
              onChange={event => vm.updateSelectedAreaTag({ tagName: event.target.value })} />}
          </>}
          {vm.selectedAnnotation2D.type !== 'measure' && <Button size="sm" variant={vm.editableAnnotationId === vm.selectedAnnotation2D.id ? 'secondary' : 'ghost'}
            disabled={vm.editableAnnotationId === vm.selectedAnnotation2D.id}
            onClick={vm.editSelectedAnnotation}>{t('section2d.tools.edit')}</Button>}
          {vm.editableAnnotationId === vm.selectedAnnotation2D.id
            && (vm.selectedAnnotation2D.type === 'polygon' || vm.selectedAnnotation2D.type === 'cloud')
            ? <Button size="sm" className="shrink-0" onClick={vm.clearAnnotationSelection}>{t('section2d.tags.apply')}</Button>
            : <Button size="sm" variant="ghost" onClick={vm.clearAnnotationSelection}>{t('section2d.tags.close')}</Button>}
        </div>}

      {displayOptions.showAnnotations && editingAnnotation && (() => {
        const scaleX = drawnPlane.axis === 'side' ? -markupTransform.scale : markupTransform.scale;
        const scaleY = drawnPlane.axis === 'down' ? markupTransform.scale : -markupTransform.scale;
        const paperUnit = vm.sheetEnabled && vm.activeSheet ? viewTransform.scale
          : markupTransform.scale * (vm.publicationScale || 100) / 1000;
        return (
          <TextAnnotationEditor
            annotation={editingAnnotation}
            fontSize={textAnnotationScreenSize(editingAnnotation, paperUnit)}
            screenX={editingAnnotation.position.x * scaleX + markupTransform.x}
            screenY={editingAnnotation.position.y * scaleY + markupTransform.y}
            onConfirm={vm.handleTextConfirm}
            onCancel={vm.handleTextCancel}
          />
        );
      })()}

      {status === 'ready' && drawing && !hasContent && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <p className="font-medium">{t('section2d.empty.title')}</p>
            <p className="mt-1 text-sm">{t('section2d.empty.description')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Area editing uses the existing authored polygon; room IFC meshes remain read-only. */
function AreaVertexHandles({ vm, id }: { vm: DrawingViewModel; id: string }) {
  const area = vm.polygonArea2DResults.find(item => item.id === id);
  const drag = useRef<{ pointerId: number; index: number; original: {x:number;y:number} } | null>(null);
  const heldSnap = useRef<SnapResult | null>(null);
  const [feedback, setFeedback] = useState<{ point: { x: number; y: number }; kind: SnapKind | null } | null>(null);
  if (!area || !(vm.markupTransform.scale > 0)) return null;
  const { x, y, scale } = vm.markupTransform;
  const sx = vm.drawnPlane.axis === 'side' ? -scale : scale;
  const sy = vm.drawnPlane.axis === 'down' ? scale : -scale;
  const toScreen = (p: {x:number;y:number}) => ({x:p.x*sx+x,y:p.y*sy+y});
  function setVertex(index: number, clientX: number, clientY: number) {
    if (!area) return; // Narrow the captured area inside this nested handler.
    const rect = vm.containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const raw = {x:(clientX-rect.left-x)/sx,y:(clientY-rect.top-y)/sy};
    // Reuse the exact drawing snap solver for the polygon's *other* vertices
    // and edges. Excluding edges incident to the dragged node prevents it from
    // repeatedly snapping back to its original location.
    const vertices = area.points.flatMap((p, i) => i === index ? [] : [[p.x, p.y] as const]);
    const segments = area.points.flatMap((p, i) => {
      const next = (i + 1) % area.points.length;
      return i === index || next === index ? [] : [
        [[p.x, p.y], [area.points[next].x, area.points[next].y]] as const,
      ];
    });
    const tiers: SnapProfile['tiers'] = [
      ...(vm.objectSnaps.endpoint ? [['endpoint', 'vertex'] as const] : []),
      ...(vm.objectSnaps.intersection ? [['intersection'] as const] : []),
      ...(vm.objectSnaps.midpoint ? [['midpoint'] as const] : []),
      ...(vm.objectSnaps.nearest ? [['edge'] as const] : []),
    ];
    const profile: SnapProfile = { radiusPx: 12, hysteresisPx: 4, sources: ['linework'], tiers };
    const source = createLineworkSource({ vertices, segments, midpoints: vm.objectSnaps.midpoint });
    const result = solveSnap({
      cursor: [raw.x, raw.y], metresPerPixel: 1 / scale,
      anchor: null, chain: [], modifiers: { shift: false, alt: false }, locks: {},
    }, [source], profile, heldSnap.current ?? undefined);
    heldSnap.current = result.winner ? result : null;
    const own = result.winner ? { x: result.local[0], y: result.local[1] } : null;
    const model = vm.findSnapPoint(raw);
    const priority = (kind: SnapKind | null) => kind === 'endpoint' || kind === 'vertex' ? 0
      : kind === 'intersection' ? 1 : kind === 'midpoint' ? 2 : kind === 'edge' ? 3 : 4;
    const ownTier = priority(result.winner?.kind ?? null);
    const modelTier = priority(vm.snapKindFor(model));
    const snapped = own && (!model || ownTier < modelTier || (ownTier === modelTier
      && Math.hypot(raw.x - own.x, raw.y - own.y) <= Math.hypot(raw.x - model.x, raw.y - model.y)))
      ? own : model;
    const anchor = area.points[(index + area.points.length - 1) % area.points.length];
    const increment = vm.angularSnap === 'off' ? 0 : Number(vm.angularSnap);
    const angled = increment ? snapDrawingAngle(anchor, raw, 0, increment) : null;
    const onAngle = snapped && increment
      ? snapDrawingAngle(anchor, snapped, 0, increment) : null;
    // Same contract as Move: a geometric reference wins only if it is on
    // the active angular direction; otherwise keep the angular constraint.
    const point = snapped && (!onAngle || Math.hypot(snapped.x - onAngle.x, snapped.y - onAngle.y) < 1e-8)
      ? snapped : angled ?? snapped ?? raw;
    const kind = snapped === own ? result.winner?.kind ?? null : vm.snapKindFor(model);
    setFeedback(point === snapped && kind ? { point, kind } : null);
    vm.updateAreaVertex(id,index,point);
  }
  return <svg aria-label="Edit area vertices" className="pointer-events-none absolute inset-0 z-10 h-full w-full text-primary">
    {area.points.map((point,index) => {
      const at=toScreen(point);
      return <circle key={index} cx={at.x} cy={at.y} r={6} fill="var(--paper, #fff)"
        stroke="currentColor" strokeWidth={2} className="pointer-events-auto cursor-crosshair touch-none"
        role="button" tabIndex={0} aria-label={`Edit area vertex ${index+1}`}
        onMouseDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}
        onKeyDown={event=>{
          const dx=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
          const dy=event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0;
          if (!dx && !dy) return;
          event.preventDefault();event.stopPropagation();
          const step=event.shiftKey?10:1;
          vm.updateAreaVertex(id,index,{x:point.x+dx*step/sx,y:point.y+dy*step/sy});
        }}
        onPointerDown={event=>{
          if (event.button!==0) return;
          event.preventDefault();event.stopPropagation();
          drag.current={pointerId:event.pointerId,index,original:{...point}};
          heldSnap.current = null;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event=>{
          if (drag.current?.pointerId!==event.pointerId || drag.current.index!==index) return;
          event.stopPropagation();setVertex(index,event.clientX,event.clientY);
        }}
        onPointerUp={event=>{
          if (drag.current?.pointerId!==event.pointerId || drag.current.index!==index) return;
          event.stopPropagation();setVertex(index,event.clientX,event.clientY);
          drag.current=null;heldSnap.current=null;setFeedback(null);event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={event=>{if(drag.current?.pointerId===event.pointerId){event.stopPropagation();vm.updateAreaVertex(id,index,drag.current.original);drag.current=null;heldSnap.current=null;setFeedback(null);}}}
        onLostPointerCapture={()=>{drag.current=null;heldSnap.current=null;setFeedback(null);}}
      />;
    })}
    {feedback && <g transform={`translate(${toScreen(feedback.point).x} ${toScreen(feedback.point).y})`}><DrawingSnapGlyph kind={feedback.kind} /></g>}
  </svg>;
}

/** Edit a revision cloud by dragging its corners; Move remains a separate command. */
function CloudResizeHandles({ vm, id }: { vm: DrawingViewModel; id: string }) {
  const { t } = useTranslation();
  const cloud = vm.cloudAnnotations2D.find(item => item.id === id);
  const drag = useRef<{ pointerId: number; opposite: { x: number; y: number };
    original: [{ x: number; y: number }, { x: number; y: number }] } | null>(null);
  const [feedback, setFeedback] = useState<{ point: { x: number; y: number }; kind: SnapKind | null } | null>(null);
  if (!cloud || cloud.points.length < 2 || !(vm.markupTransform.scale > 0)) return null;

  const [a, b] = cloud.points;
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const corners = [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ];
  const { x, y, scale } = vm.markupTransform;
  const sx = vm.drawnPlane.axis === 'side' ? -scale : scale;
  const sy = vm.drawnPlane.axis === 'down' ? scale : -scale;
  const screen = (p: { x: number; y: number }) => ({ x: p.x * sx + x, y: p.y * sy + y });
  const fromClient = (clientX: number, clientY: number) => {
    const rect = vm.containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const raw = { x: (clientX - rect.left - x) / sx, y: (clientY - rect.top - y) / sy };
    const snapped = vm.findSnapPoint(raw);
    const kind = vm.snapKindFor(snapped);
    setFeedback(snapped && kind ? { point: snapped, kind } : null);
    return snapped ?? raw;
  };
  const resize = (clientX: number, clientY: number) => {
    const current = drag.current;
    const point = fromClient(clientX, clientY);
    if (!current || !point) return;
    if (Math.abs(point.x - current.opposite.x) < 1e-6 || Math.abs(point.y - current.opposite.y) < 1e-6) return;
    vm.resizeRevisionCloud(id, [current.opposite, point]);
  };

  return <svg aria-label={t('section2d.tools.edit')} className="pointer-events-none absolute inset-0 z-10 h-full w-full text-primary">
    {corners.map((corner, index) => {
      const at = screen(corner);
      return <circle key={index} cx={at.x} cy={at.y} r={6} fill="var(--paper, #fff)" stroke="currentColor" strokeWidth={2}
        className="pointer-events-auto cursor-crosshair touch-none"
        role="button" tabIndex={0} aria-label={`${t('section2d.tools.edit')} · ${index + 1}`}
        onMouseDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          const step = event.shiftKey ? 10 : 1;
          const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
          const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
          if (!dx && !dy) return;
          event.preventDefault(); event.stopPropagation();
          const opposite = corners[(index + 2) % 4];
          const point = { x: corner.x + dx / sx, y: corner.y + dy / sy };
          if (Math.abs(point.x - opposite.x) > 1e-6 && Math.abs(point.y - opposite.y) > 1e-6)
            vm.resizeRevisionCloud(id, [opposite, point]);
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          drag.current = { pointerId: event.pointerId, opposite: { ...corners[(index + 2) % 4] },
            original: [{ ...cloud.points[0] }, { ...cloud.points[1] }] };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          event.stopPropagation(); resize(event.clientX, event.clientY);
        }}
        onPointerUp={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          event.stopPropagation(); resize(event.clientX, event.clientY);
          drag.current = null;
          setFeedback(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          event.stopPropagation(); vm.resizeRevisionCloud(id, drag.current.original);
          drag.current = null;
          setFeedback(null);
        }}
        onLostPointerCapture={() => { drag.current = null; setFeedback(null); }} />;
    })}
    {feedback && <g transform={`translate(${screen(feedback.point).x} ${screen(feedback.point).y})`}><DrawingSnapGlyph kind={feedback.kind} /></g>}
  </svg>;
}
