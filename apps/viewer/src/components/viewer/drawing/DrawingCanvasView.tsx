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
import { useRef } from 'react';
import { useTranslation } from '@/i18n';
import { Drawing2DCanvas } from '../Drawing2DCanvas';
import { TextAnnotationEditor } from '../TextAnnotationEditor';
import { ViewMarkers } from './ViewMarkers';
import { DrawingMovePreview } from './DrawingMovePreview';
import { DrawingElementTags } from './DrawingElementTags';
import { useDrawingModelSelection } from './DrawingModelSelection';
import { PlaceVerticalView, type VerticalViewKind } from './PlaceVerticalView';
import { drawingAnnotationVisible } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';
import type { DrawingLayers } from './useDrawingLayers';

export function DrawingCanvasView({ vm, layers, placement, stopPlacement }: {
  vm: DrawingViewModel; layers: DrawingLayers; placement?: VerticalViewKind; stopPlacement: () => void;
}) {
  const fillPreview = usePublicationFillPreview();
  const { t } = useTranslation();
  const { drawing, status, drawnPlane, viewTransform, markupTransform, displayOptions } = vm;
  const selection = useDrawingModelSelection(vm,
    status === 'ready' && vm.annotation2DActiveTool === 'none' && !placement && !vm.textAnnotation2DEditing);
  const hasContent = !!drawing && (drawing.cutPolygons.length > 0 || drawing.lines?.length > 0 || layers.dxfUnderlayData.length > 0 || vm.hasReferences);
  const editingAnnotation = vm.textAnnotation2DEditing
    ? vm.textAnnotations2D.find((a) => a.id === vm.textAnnotation2DEditing) ?? null
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
          measureResults={drawingAnnotationVisible(vm.savedView, 'dimensions') ? vm.displayedMeasurements.filter(item => drawingAnnotationVisible(vm.savedView, 'dimensions', item.dimension?.styleId)) : []}
          measureSnapPoint={vm.measure2DSnapPoint}
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

      {status === 'ready' && displayOptions.showAnnotations
        && vm.savedView?.annotationOptions?.visibility?.roomBoundaries === true
        && vm.ifcSpaceRooms.length > 0 && <svg aria-label={t('section2d.viewOptions.roomBoundaries')}
          className="pointer-events-none absolute inset-0 h-full w-full text-muted-foreground"
          fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="5 3" opacity={0.65}>
          {vm.ifcSpaceRooms.flatMap(room => room.contours.map((ring, index) =>
            <path key={room.id + ':' + index} d={ring.map((point, i) =>
              (i === 0 ? 'M' : 'L') + (point.x * markupTransform.scale + markupTransform.x)
              + ' ' + (point.y * markupTransform.scale + markupTransform.y)).join(' ') + ' Z'} />
          ))}
        </svg>}
      {status === 'ready' && selection.overlay}
      {status === 'ready' && vm.editableAnnotationId && vm.selectedAnnotation2D?.type === 'cloud'
        && vm.selectedAnnotation2D.id === vm.editableAnnotationId && vm.annotation2DActiveTool === 'none'
        && <CloudResizeHandles vm={vm} id={vm.editableAnnotationId} />}
      {status === 'ready' && <DrawingMovePreview vm={vm} />}
      {status === 'ready' && vm.annotation2DActiveTool === 'move' && <div
        className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-sm"
        role="status">{t(vm.moveBase ? 'section2d.tools.moveTarget' : 'section2d.tools.moveBase')}</div>}
      {status === 'ready' && displayOptions.showAnnotations && !placement && <ViewMarkers vm={vm} />}
      {status === 'ready' && displayOptions.showAnnotations && !placement && <DrawingElementTags vm={vm} />}
      {placement && <PlaceVerticalView key={`${placement}:${drawing?.config.plane.position}:${drawnPlane.flipped}`} kind={placement} vm={vm} close={stopPlacement} />}
      {status === 'ready' && vm.selectedAnnotation2D && !vm.tags.selected && !vm.selectedMarker
        && vm.annotation2DActiveTool === 'none' && <div role="toolbar"
          aria-label={t('section2d.tools.select')}
          className="pointer-events-auto absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-md border bg-background p-1 text-xs shadow-sm"
          onMouseDown={event => event.stopPropagation()} onMouseUp={event => event.stopPropagation()}>
          <span className="max-w-36 truncate px-2 font-medium">
            {vm.selectedAnnotation2D.type === 'measure' ? t('section2d.dimensionStyle.title')
              : vm.selectedAnnotation2D.type === 'polygon' ? t('section2d.annotationKind.area')
              : vm.selectedAnnotation2D.type === 'cloud' ? t('section2d.annotationKind.cloud')
              : t('section2d.annotationKind.text')}
          </span>
          {vm.selectedAnnotationStyle && <Select disabled={vm.selectedAnnotationStyle.locked}
            value={vm.selectedAnnotationStyle.value} onValueChange={vm.changeSelectedAnnotationStyle}>
            <SelectTrigger className="h-7 w-36 text-xs" aria-label={t('section2d.annotationStyles.title')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {vm.selectedAnnotationStyle.kind !== 'dimensions' &&
                <SelectItem value="original">{t('section2d.annotationStyles.fromSymbol')}</SelectItem>}
              {vm.selectedAnnotationStyle.choices.map(option => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
            </SelectContent>
          </Select>}
          <Button size="sm" variant={vm.editableAnnotationId === vm.selectedAnnotation2D.id ? 'secondary' : 'ghost'}
            disabled={vm.editableAnnotationId === vm.selectedAnnotation2D.id}
            onClick={vm.editSelectedAnnotation}>{t('section2d.tools.edit')}</Button>
          <Button size="sm" variant="ghost" onClick={vm.clearAnnotationSelection}>{t('section2d.tags.close')}</Button>
        </div>}

      {displayOptions.showAnnotations && editingAnnotation && (() => {
        const scaleX = drawnPlane.axis === 'side' ? -markupTransform.scale : markupTransform.scale;
        const scaleY = drawnPlane.axis === 'down' ? markupTransform.scale : -markupTransform.scale;
        return (
          <TextAnnotationEditor
            annotation={editingAnnotation}
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

/** Edit a revision cloud by dragging its corners; Move remains a separate command. */
function CloudResizeHandles({ vm, id }: { vm: DrawingViewModel; id: string }) {
  const { t } = useTranslation();
  const cloud = vm.cloudAnnotations2D.find(item => item.id === id);
  const drag = useRef<{ pointerId: number; opposite: { x: number; y: number };
    original: [{ x: number; y: number }, { x: number; y: number }] } | null>(null);
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
    return vm.findSnapPoint(raw) ?? raw;
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
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          event.stopPropagation(); vm.resizeRevisionCloud(id, drag.current.original);
          drag.current = null;
        }}
        onLostPointerCapture={() => { drag.current = null; }} />;
    })}
  </svg>;
}
