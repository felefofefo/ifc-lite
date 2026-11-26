/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drawing view's model (#5494): what the store holds about the current
 * drawing, the view transform, the markup tool handlers, the display toggles
 * and the settings-drawer slot. `DrawingPanel` renders it; `useDrawingLayers`
 * builds the overlays and exports on top of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { GraphicOverrideEngine, suppressCutJoints, suppressDrawingCutJoints } from '@ifc-lite/drawing-2d';
import { useDrawingDirection, type AngularSnap } from '@/hooks/useDrawingDirection';
import * as IfcWasm from '@ifc-lite/wasm';
import { createMeshOutlineProvider, type MeshOutline2dFn } from '@/hooks/meshOutlineProvider';
import { selectModelMeshes } from '@/lib/type-view-visibility';
import { readIfcSpaceRooms } from '@/lib/drawing/ifc-space-rooms';
import { useViewerStore } from '@/store';
import { selectActiveSavedView, setDrawingProjectionDisplay, saveProjectGrid, editSavedViewTrace, updateViewSettings, removeSavedSectionCut, deleteDrawingWindowSymbols, moveDrawingWindowSymbols, pasteDrawingWindowSymbols, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { toast } from '@/components/ui/toast';
import { useDialogs } from '@/components/ui/confirm-dialog';
import { isTextEntryElement } from '@/lib/keyboard-event';
import { registerKeyboardCommand } from '@/lib/commands/dispatcher';
import { arrangeDrawingItems, type DrawingArrangeAction } from '@/lib/drawing/drawing-arrange';
import { useTranslation } from '@/i18n';
import { readDrawingTags, collectTagTargets, findTagTarget, type DrawingElementTag } from '@/lib/drawing/drawing-element-tags';
import { moveProjectGrid } from '@/lib/drawing/project-grids';
import { collectViewMarkers, DEFAULT_VIEW_MARKERS } from '@/lib/drawing/view-markers';
import type { DistantElements } from '@/lib/drawing/distant-elements';
import { cloneClipboardPayload, sameDrawingCoordinates, snapshotAnnotation, snapshotWindowClipboard, type DrawingClipboardPayload, type DrawingEditClipboard } from '@/lib/drawing/drawing-edit-clipboard';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import { isCanvasWindowAnnotation, type WindowDrawingSelection } from './drawing-annotation-window';
import type { DrawingInspectorTab } from '@/store/slices/drawingInspectorSlice';
import { temporaryDimensionViewKey } from '@/lib/drawing/dimension-view';
import { transferViewMarkup } from '@/lib/drawing/dimension-view';
import { useViewDimensions } from './useViewDimensions';
import type { DimensionType } from '@/lib/drawing/dimension-line';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { DEFAULT_OBJECT_SNAPS, useMeasure2D } from '@/hooks/useMeasure2D';
import { useAnnotation2D } from '@/hooks/useAnnotation2D';
import { useDrawingWithReferences } from '@/hooks/useReferenceImagesForDrawing';
import { useDxfUnderlaysForDrawing } from '@/hooks/useDxfUnderlay';
import { drawingWithDxfBounds, referenceOnlyBounds } from '@/hooks/dxfDrawingBounds';
import { useViewControls } from '@/hooks/useViewControls';
import { useDrawingRuntime } from '@/lib/drawing/drawing-runtime';
import type { CachedSheetTransform } from '@/lib/drawing/sheet-geometry-key';
import { resolveDrawingPaperTheme } from './paper-theme';
import { overheadProjectionEnabled, toggledConstructionProjection } from '@/lib/drawing/construction-projection';
import { useDrawingLineweights } from './DrawingLineweights';
import { useDrawingDimensionStyle } from '@/hooks/useDrawingDimensionStyle';
import { useDrawingMaterials } from '@/hooks/useDrawingMaterials';
import { useDrawingCutJointMaterial } from '@/hooks/useDrawingCutJoints';
import { applyDistantZone } from '@/lib/drawing/distant-elements';
import { drawingAnnotationVisible } from '@/store/savedSectionCutsStore';
import { editedPolygonAreaVertex } from '@/components/viewer/tools/computePolygonArea';
import { annotationAppearance } from '@/lib/drawing/annotation-types';
import { lineweightsAtScale } from '@/lib/drawing/lineweight-table';
import { drawnSectionPlane } from '@/lib/drawing/drawn-section-plane';

/** The settings panels beside the canvas, as inspector tabs (#5495); they
 *  share one slot. Re-exported for the drawing/ subtree's existing imports. */
export type DrawingDrawer = DrawingInspectorTab;

import { useDrawingTags } from './DrawingElementTags';

export function useDrawingViewModel() {
  const { t } = useTranslation();
  const { confirmDialog } = useDialogs();
  const runtime = useDrawingRuntime();
  const { geometryResult } = runtime;

  const sourceDrawing = useViewerStore((s) => s.drawing2D);
  const models = useViewerStore((s) => s.models);
  const lineweightSettings = useDrawingLineweights();
  const dimensionSettings = useDrawingDimensionStyle(lineweightSettings.projectId);
  const materialSettings = useDrawingMaterials(lineweightSettings.projectId);
  const cutJointMaterial = useDrawingCutJointMaterial();
  const joinedDrawing = useMemo(() => {
    if (!sourceDrawing) return sourceDrawing;
    const { plane } = sourceDrawing.config;
    const geometry = plane.axis === 'y' && !plane.customPlane
      ? suppressDrawingCutJoints(sourceDrawing, cutJointMaterial)
      : { cutPolygons: suppressCutJoints(sourceDrawing.cutPolygons, cutJointMaterial), lines: sourceDrawing.lines };
    if (geometry.lines === sourceDrawing.lines) return { ...sourceDrawing, cutPolygons: geometry.cutPolygons };
    return {
      ...sourceDrawing,
      ...geometry,
      stats: {
        ...sourceDrawing.stats,
        projectionLineCount: geometry.lines.filter(line => line.category === 'projection').length,
        hiddenLineCount: geometry.lines.filter(line => line.visibility === 'hidden').length,
      },
    };
  }, [sourceDrawing, cutJointMaterial]);
  const { drawing: rasterDrawing, hasReferences: hasRasterReferences, referenceCount: visibleRasterReferenceCount, referenceCorners } = useDrawingWithReferences(joinedDrawing);
  const setDrawing = useViewerStore((s) => s.setDrawing2D);
  const status = useViewerStore((s) => s.drawing2DStatus);
  const setDrawingStatus = useViewerStore((s) => s.setDrawing2DStatus);
  const progress = useViewerStore((s) => s.drawing2DProgress);
  const progressPhase = useViewerStore((s) => s.drawing2DPhase);
  const drawingError = useViewerStore((s) => s.drawing2DError);
  const displayOptions = useViewerStore((s) => s.drawing2DDisplayOptions);
  const updateDisplayOptions = useViewerStore((s) => s.updateDrawing2DDisplayOptions);
  const theme = useViewerStore((s) => s.theme);
  // LENGTHUNIT display override for the on-canvas measure distance/perimeter
  // labels (#2199 slice not covered by #2538 — see Drawing2DCanvas.tsx).
  const unitDisplayOverrides = useViewerStore((s) => s.unitDisplayOverrides);
  // Class-level Visibility toggles — the section honours them like the 3D
  // viewport does, so a hidden IfcSpace/IfcOpeningElement is not cut (#2060).
  const typeVisibility = useViewerStore((s) => s.typeVisibility);
  const activePresetId = useViewerStore((s) => s.activePresetId);
  const overridesEnabled = useViewerStore((s) => s.overridesEnabled);
  const graphicRules = runtime.graphicRules;
  const getActiveOverrideRules = useViewerStore(s => s.getActiveOverrideRules);
  const legacyRules = useViewerStore(s => s.customOverrideRules);
  const dxfUnderlays = useViewerStore((s) => s.dxfUnderlays);
  const pointCloudClassMask = useViewerStore((s) => s.pointCloudClassMask);
  const activeSheet = useViewerStore((s) => s.activeSheet);
  const sheetEnabled = useViewerStore((s) => s.sheetEnabled);
  const savedView = useSavedSectionCuts(selectActiveSavedView);
  const projectGrids = useSavedSectionCuts(state => state.grids);
  const drawingProjectId = useSavedSectionCuts(state => state.projectId);
  const { annotationStyles, defaultAnnotationStyles } = useSavedSectionCuts(state => state.tagLibrary);
  const drawingPlaneId = useSavedSectionCuts(s => s.drawingPlaneId);
  const saved3D = savedView?.kind === '3d' ? savedView : undefined;
  const publicationScale = saved3D ? saved3D.publicationScale ?? displayOptions.scale
    : sheetEnabled && activeSheet ? activeSheet.scale.factor : displayOptions.scale;
  const [editableAnnotationId, setEditableAnnotationId] = useState<string | null>(null);
  // One Delete route for the toolbar, context menus and keyboard shortcuts.
  const deletionRef = useRef<(() => void) | null>(null);
  useEffect(() => registerKeyboardCommand('drawing2d.delete', () => {
    if (!deletionRef.current || isTextEntryElement(document.activeElement)) return false;
    deletionRef.current();
  }, { active: () => !!deletionRef.current }), []);
  const [selectedMarker, setSelectedMarker] = useState<{
    id: string; start: { x: number; y: number }; end: { x: number; y: number };
    reverse: boolean; distant?: DistantElements | null;
  } | null>(null);
  const lineweights = lineweightsAtScale(lineweightSettings.table, publicationScale);
  const titleBlockEditorVisible = useViewerStore((s) => s.titleBlockEditorVisible);
  const setTitleBlockEditorVisible = useViewerStore((s) => s.setTitleBlockEditorVisible);

  const measure2DMode = useViewerStore((s) => s.measure2DMode);
  const [dimensionType, setDimensionType] = useState<DimensionType>('aligned');
  const [angularSnap, setAngularSnap] = useState<AngularSnap>('off');
  const [objectSnaps, setObjectSnaps] = useState(DEFAULT_OBJECT_SNAPS);
  const [selectOnly2D, setSelectOnly2D] = useState(false);
  function toggleSelectOnly2D() {
    if (!selectOnly2D) useViewerStore.getState().clearEntitySelection();
    setSelectOnly2D(!selectOnly2D);
  }
  const lastActiveSnaps = useRef({ objectSnaps: { ...DEFAULT_OBJECT_SNAPS }, angularSnap: 'off' as AngularSnap });
  const snapsEnabled = Object.values(objectSnaps).some(Boolean) || angularSnap !== 'off';
  function toggleSnaps() {
    if (snapsEnabled) {
      lastActiveSnaps.current = { objectSnaps: { ...objectSnaps }, angularSnap };
      setObjectSnaps({ endpoint: false, midpoint: false, intersection: false, nearest: false });
      setAngularSnap('off');
    } else {
      setObjectSnaps({ ...lastActiveSnaps.current.objectSnaps });
      setAngularSnap(lastActiveSnaps.current.angularSnap);
    }
  }
  const measure2DSnapPoint = useViewerStore((s) => s.measure2DSnapPoint);
  const setMeasure2DSnapPoint = useViewerStore((s) => s.setMeasure2DSnapPoint);

  const annotation2DActiveTool = useViewerStore((s) => s.annotation2DActiveTool);
  const setAnnotation2DActiveTool = useViewerStore((s) => s.setAnnotation2DActiveTool);
  const annotation2DCursorPos = useViewerStore((s) => s.annotation2DCursorPos);
  const setAnnotation2DCursorPos = useViewerStore((s) => s.setAnnotation2DCursorPos);
  const polygonArea2DPoints = useViewerStore((s) => s.polygonArea2DPoints);
  const allPolygonArea2DResults = useViewerStore((s) => s.polygonArea2DResults);
  const addPolygonArea2DPoint = useViewerStore((s) => s.addPolygonArea2DPoint);
  const completePolygonArea2D = useViewerStore((s) => s.completePolygonArea2D);
  const cancelPolygonArea2D = useViewerStore((s) => s.cancelPolygonArea2D);
  const allTextAnnotations2D = useViewerStore((s) => s.textAnnotations2D);
  const textAnnotation2DEditing = useViewerStore((s) => s.textAnnotation2DEditing);
  const addTextAnnotation2D = useViewerStore((s) => s.addTextAnnotation2D);
  const updateTextAnnotation2D = useViewerStore((s) => s.updateTextAnnotation2D);
  const removeTextAnnotation2D = useViewerStore((s) => s.removeTextAnnotation2D);
  const setTextAnnotation2DEditing = useViewerStore((s) => s.setTextAnnotation2DEditing);
  const cloudAnnotation2DPoints = useViewerStore((s) => s.cloudAnnotation2DPoints);
  const allCloudAnnotations2D = useViewerStore((s) => s.cloudAnnotations2D);
  const addCloudAnnotation2DPoint = useViewerStore((s) => s.addCloudAnnotation2DPoint);
  const completeCloudAnnotation2D = useViewerStore((s) => s.completeCloudAnnotation2D);
  const cancelCloudAnnotation2D = useViewerStore((s) => s.cancelCloudAnnotation2D);
  const setSelectedAnnotation2D = useViewerStore((s) => s.setSelectedAnnotation2D);
  const deleteSelectedAnnotation2D = useViewerStore((s) => s.deleteSelectedAnnotation2D);
  const moveAnnotation2D = useViewerStore((s) => s.moveAnnotation2D);

  const sectionPlane = useViewerStore((s) => s.sectionPlane);
  // Everything drawn with or exported from the drawing follows the cut it was generated at.
  const drawnPlane = useViewerStore(drawnSectionPlane);
  const temporaryKey = temporaryDimensionViewKey(drawnPlane);
  const temporaryOptions = useSavedSectionCuts(state => state.temporaryOptions[temporaryKey]);
  const viewAnnotationOptions = savedView?.annotationOptions ?? temporaryOptions?.annotationOptions;
  const annotationView = savedView ?? (viewAnnotationOptions ? { annotationOptions: viewAnnotationOptions } : undefined);
  const dimensions = useViewDimensions(drawnPlane, sectionPlane.id, saved3D ? undefined : savedView?.id, drawingPlaneId, dimensionSettings.library.defaultId);
  const { viewKey, measure2DResults } = dimensions;
  const polygonArea2DResults = useMemo(() => allPolygonArea2DResults.filter(item => item.viewKey === viewKey), [allPolygonArea2DResults, viewKey]);
  const textAnnotations2D = useMemo(() => allTextAnnotations2D.filter(item => item.viewKey === viewKey), [allTextAnnotations2D, viewKey]);
  const cloudAnnotations2D = useMemo(() => allCloudAnnotations2D.filter(item => item.viewKey === viewKey), [allCloudAnnotations2D, viewKey]);
  const selection = dimensions.selectedAnnotation2D;
  const selectedAnnotation2D = selection && (selection.type === 'measure' ||
    (selection.type === 'text' ? textAnnotations2D : selection.type === 'cloud' ? cloudAnnotations2D : polygonArea2DResults)
      .some(item => item.id === selection.id)) ? selection : null;
  useEffect(() => {
    if (status !== 'ready' || !viewKey || saved3D) return;
    const state = useViewerStore.getState();
    // Older markup had no view identity. Adopt it once in the first ready drawing.
    if (state.measure2DResults.some(item => !(item.dimension?.viewKey ?? item.viewKey))
      || state.polygonArea2DResults.some(item => !item.viewKey)
      || state.textAnnotations2D.some(item => !item.viewKey)
      || state.cloudAnnotations2D.some(item => !item.viewKey)) {
      useViewerStore.setState(transferViewMarkup(state, undefined, viewKey));
    }
  }, [status, viewKey, saved3D]);
  const dxfUnderlayData = useDxfUnderlaysForDrawing({enabled:status==='ready', plane:sourceDrawing?.config.plane,
    sectionAxis:drawnPlane.axis,isCustomPlane:drawnPlane.custom!==undefined,flipped:drawnPlane.flipped,coordinateInfo:geometryResult?.coordinateInfo});
  const drawing = useMemo(() => {
    const result = drawingWithDxfBounds(rasterDrawing, dxfUnderlayData, hasRasterReferences);
    return applyDistantZone(result, displayOptions.distantElements);
  }, [rasterDrawing, dxfUnderlayData, hasRasterReferences, drawnPlane.axis, displayOptions.distantElements]);
  const ifcSpaceRooms = useMemo(() => {
    const outlineFn = (IfcWasm as unknown as { meshOutline2d?: MeshOutline2dFn }).meshOutline2d;
    if (!drawing || !geometryResult?.meshes || typeof outlineFn !== 'function') return [];
    return readIfcSpaceRooms(selectModelMeshes(geometryResult.meshes), drawing.config.plane,
      createMeshOutlineProvider(outlineFn));
  }, [drawing?.config.plane, geometryResult]);
  const roomSnapContours = useMemo(() =>
    status === 'ready' && displayOptions.showAnnotations
      && viewAnnotationOptions?.visibility?.roomBoundaries === true
      ? ifcSpaceRooms.flatMap(room => room.contours) : [],
    [status, displayOptions.showAnnotations, viewAnnotationOptions?.visibility?.roomBoundaries, ifcSpaceRooms]);
  const hasReferences = hasRasterReferences || dxfUnderlayData.some(r=>r.lines.length>0 || r.fills.length>0 || r.texts.length>0);
  // The references' own extent, which Fit always frames (#8802).
  const referenceBounds = useMemo(() => referenceOnlyBounds(sourceDrawing, referenceCorners, dxfUnderlayData), [sourceDrawing, referenceCorners, dxfUnderlayData]);


  const [isPinned, setIsPinned] = useState(true); // Default ON: keep position on regenerate
  const containerRef = useRef<HTMLDivElement>(null);
  // Cache sheet drawing transform when pinned (to keep model fixed in place)
  const cachedSheetTransformRef = useRef<CachedSheetTransform | null>(null);

  // The inspector column's tabs share one slot (#5495): a single persisted
  // store field, not a per-drawer `useState`. `sheetPanelVisible` (keyboard
  // shortcuts, teardown) stays in step with it via `registerDrawingInspectorSheetSync`
  // in `store/index.ts`.
  const openDrawer = useViewerStore((s) => s.drawingInspectorTab);
  const toggleDrawingInspectorTab = useViewerStore((s) => s.toggleDrawingInspectorTab);
  const closeDrawingInspector = useViewerStore((s) => s.closeDrawingInspector);
  const toggleDrawer = useCallback((drawer: DrawingDrawer) => {
    toggleDrawingInspectorTab(drawer);
  }, [toggleDrawingInspectorTab]);
  const closeDrawer = useCallback(() => {
    closeDrawingInspector();
  }, [closeDrawingInspector]);

  const overrideEngine = useMemo(() => new GraphicOverrideEngine(graphicRules ?? getActiveOverrideRules(), lineweights), [graphicRules, lineweights, getActiveOverrideRules, legacyRules, activePresetId, overridesEnabled]);

  // Build entity color map from mesh material colors (for "Use IFC Materials" mode)
  const entityColorMap = useMemo(() => {
    const map = new Map<number, [number, number, number, number]>();
    if (geometryResult?.meshes) {
      for (const mesh of geometryResult.meshes) {
        if (mesh.expressId && mesh.color) map.set(mesh.expressId, mesh.color);
      }
    }
    return map;
  }, [geometryResult]);

  const { viewTransform, setViewTransform, zoomIn, zoomOut, fitToView } = useViewControls({
    drawing, sectionPlane: drawnPlane, containerRef,
    // Mounted means on screen: the host only renders this view while it shows.
    panelVisible: true, status, sheetEnabled, activeSheet,
    isPinned, cachedSheetTransformRef, referenceBounds,
  });

  let markupTransform = viewTransform;
  if (sheetEnabled && activeSheet && drawing) {
    const { min, max } = drawing.bounds;
    const { transform } = resolveSheetTransform({
      sheet: activeSheet, axis: drawnPlane.axis, isPinned, cached: cachedSheetTransformRef.current,
      drawingBounds: { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y },
    });
    markupTransform = {
      x: viewTransform.x + transform.translateX * viewTransform.scale,
      y: viewTransform.y + transform.translateY * viewTransform.scale,
      scale: viewTransform.scale * transform.scaleFactor,
    };
  }

  const finishDimension = useCallback(() => setAnnotation2DActiveTool('none'), [setAnnotation2DActiveTool]);
  const measureHandlers = useMeasure2D({
    objectSnaps, extraSnapContours: roomSnapContours,
    drawing: status === 'ready' && viewKey ? drawing : null,
    drawingKey: viewKey ?? undefined,
    viewTransform: markupTransform, setViewTransform, sectionAxis: drawnPlane.axis, containerRef,
    measure2DMode: measure2DMode && !saved3D, dimensionType, angularSnap,
    showHiddenLines: displayOptions.showHiddenLines, setMeasure2DSnapPoint,
    onCancel: finishDimension, onPlace: dimensions.placeDimension,
  });

  const tags = useDrawingTags({
    view: savedView && !saved3D && viewKey === 'view:' + savedView.id ? savedView : undefined,
    drawing: status === 'ready' ? drawing : null,
    transform: markupTransform, axis: drawnPlane.axis, container: containerRef,
    tool: annotation2DActiveTool, setTool: setAnnotation2DActiveTool,
    showHidden: displayOptions.showHiddenLines, scale: publicationScale,
    findSnapPoint: measureHandlers.findSnapPoint, angularSnap, lineweights, roomContours: ifcSpaceRooms,
  });

  // Hit-testing and canvas painting use the same styled, visible text annotations.
  const styledNotes = styledMarkup('text', textAnnotations2D);
  const textPaperUnit = sheetEnabled && activeSheet ? viewTransform.scale
    : markupTransform.scale * (publicationScale || 100) / 1000;
  const annotationHandlers = useAnnotation2D({
    drawing, viewTransform: markupTransform, sectionAxis: drawnPlane.axis, containerRef,
    paperUnit: textPaperUnit,
    activeTool: annotation2DActiveTool, setActiveTool: setAnnotation2DActiveTool,
    polygonArea2DPoints, addPolygonArea2DPoint,
    areaEndpointSnaps: objectSnaps.endpoint,
    completePolygonArea2D: (area, perimeter) => { if (viewKey) completePolygonArea2D(area, perimeter, viewKey, defaultAnnotationStyles?.area); }, cancelPolygonArea2D,
    textAnnotations2D: displayOptions.showAnnotations ? styledNotes : [],
    addTextAnnotation2D: annotation => { if (viewKey) addTextAnnotation2D({ ...annotation, viewKey, appearanceId: defaultAnnotationStyles?.text }); }, setTextAnnotation2DEditing,
    cloudAnnotation2DPoints, cloudAnnotations2D: displayOptions.showAnnotations ? cloudAnnotations2D : [], addCloudAnnotation2DPoint,
    completeCloudAnnotation2D: label => { if (viewKey) completeCloudAnnotation2D(label, viewKey, defaultAnnotationStyles?.cloud); }, cancelCloudAnnotation2D,
    measure2DResults: displayOptions.showAnnotations ? measure2DResults : [], polygonArea2DResults: displayOptions.showAnnotations ? polygonArea2DResults : [],
    pickDimensionLabel: displayOptions.showAnnotations ? dimensions.pickDimensionLabel : undefined,
    selectedAnnotation2D, editableAnnotationId, setSelectedAnnotation2D, moveAnnotation2D,
    snapForDrag: measureHandlers.findSnapPoint, angularSnap,
    setAnnotation2DCursorPos, setMeasure2DSnapPoint,
  });

  // Unified mouse handlers that dispatch to the right tool
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (annotation2DActiveTool === 'measure') return;
    if (annotation2DActiveTool === 'none') {
      // Try annotation selection/drag first; if it consumed the click, don't pan
      const consumed = annotationHandlers.handleMouseDown(e);
      if (!consumed) measureHandlers.handleMouseDown(e);
      return consumed;
    } else {
      annotationHandlers.handleMouseDown(e);
    }
  }, [annotation2DActiveTool, measureHandlers, annotationHandlers]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // If dragging an annotation, let the annotation handler handle it
    if (annotationHandlers.isDraggingRef.current) {
      annotationHandlers.handleMouseMove(e);
      return;
    }
    if (annotation2DActiveTool === 'measure' || annotation2DActiveTool === 'none') {
      measureHandlers.handleMouseMove(e);
    } else {
      annotationHandlers.handleMouseMove(e);
    }
  }, [annotation2DActiveTool, measureHandlers, annotationHandlers]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    annotationHandlers.handleMouseUp(e);
    measureHandlers.handleMouseUp();
  }, [measureHandlers, annotationHandlers]);

  const canvasMouseHandlers = useMemo(() => ({
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onClick: measureHandlers.handleClick,
    onMouseLeave: measureHandlers.handleMouseLeave,
    onDoubleClick: annotation2DActiveTool === 'measure' ? undefined : annotationHandlers.handleDoubleClick,
  }), [annotation2DActiveTool, handleMouseDown, handleMouseMove, handleMouseUp, measureHandlers, annotationHandlers]);

  // Display toggles. Symbolic and construction projection change which geometry
  // the generator emits, so they clear the drawing to force a regenerate.
  const toggleIfcAnnotations = useCallback(() => {
    updateDisplayOptions({ showIfcAnnotations: !displayOptions.showIfcAnnotations });
  }, [displayOptions.showIfcAnnotations, updateDisplayOptions]);

  const toggleConstructionProjection = useCallback(() => {
    const { showConstructionProjection, showOverheadProjection } = displayOptions;
    setDrawingProjectionDisplay({
      showConstructionProjection: toggledConstructionProjection(showConstructionProjection, sectionPlane),
      ...(sectionPlane.axis === 'down' && !sectionPlane.custom && showOverheadProjection === undefined
        ? { showOverheadProjection: overheadProjectionEnabled(undefined, showConstructionProjection, sectionPlane) }
        : {}),
    });
    setDrawing(null);
    setDrawingStatus('idle');
  }, [displayOptions, sectionPlane, setDrawing, setDrawingStatus]);

  const toggleOverheadProjection = useCallback(() => {
    setDrawingProjectionDisplay({
      showOverheadProjection: !overheadProjectionEnabled(
        displayOptions.showOverheadProjection, displayOptions.showConstructionProjection, sectionPlane,
      ),
    });
    setDrawing(null);
    setDrawingStatus('idle');
  }, [displayOptions, sectionPlane, setDrawing, setDrawingStatus]);

  const toggle3DOverlay = useCallback(() => {
    updateDisplayOptions({ show3DOverlay: !displayOptions.show3DOverlay });
  }, [displayOptions.show3DOverlay, updateDisplayOptions]);

  const toggleSymbolicRepresentations = useCallback(() => {
    updateDisplayOptions({ useSymbolicRepresentations: !displayOptions.useSymbolicRepresentations });
    setDrawing(null);
    setDrawingStatus('idle');
  }, [displayOptions.useSymbolicRepresentations, updateDisplayOptions, setDrawing, setDrawingStatus]);

  // Print preview (#5496): a display toggle, not a regenerate — it only
  // changes the canvas's paper/ink, never the cut geometry.
  const togglePrintPreview = useCallback(() => {
    updateDisplayOptions({ showPrintPreview: !displayOptions.showPrintPreview });
  }, [displayOptions.showPrintPreview, updateDisplayOptions]);

  // The canvas's paper/ink (#5496): dark paper in dark theme, forced white by
  // print preview, always white in sheet mode (Drawing2DCanvas decides that
  // last part itself since it also owns the desk colour).
  const paperTheme = useMemo(
    () => resolveDrawingPaperTheme(theme, displayOptions.showPrintPreview),
    [theme, displayOptions.showPrintPreview],
  );

  const togglePinned = useCallback(() => setIsPinned((prev) => !prev), []);

  const resetDimension = measureHandlers.reset;
  const selectTool = useCallback((tool: Annotation2DTool) => {
    if (tool !== 'none' && !displayOptions.showAnnotations) {
      setDrawingProjectionDisplay({ showAnnotations: true });
    }
    if (tool === 'measure') resetDimension();
    setAnnotation2DActiveTool(tool);
  }, [displayOptions.showAnnotations, resetDimension, setAnnotation2DActiveTool]);

  const selectDimensionType = useCallback((type: DimensionType) => {
    setDimensionType(type);
    selectTool('measure');
  }, [selectTool]);

  // Editing operates exclusively on authored markup and global datums, never IFC meshes.
  const [clipboard, setClipboard] = useState<DrawingEditClipboard | null>(null);
  const [moveBase, setMoveBase] = useState<{ x: number; y: number } | null>(null);
  const { resolve: resolveMoveDirection } = useDrawingDirection(
    annotation2DActiveTool === 'move' && moveBase ? 'drawing-move-target' : null, angularSnap);
  type MoveItem = {
    annotation?: NonNullable<typeof selectedAnnotation2D>;
    tag?: DrawingElementTag;
    marker?: NonNullable<typeof selectedMarker>;
    snapshot?: DrawingClipboardPayload;
  };
  const moveTarget = useRef<MoveItem & {
    projectId?: string;
    viewKey: string | null;
    viewId?: string;
    batch?: MoveItem[];
  } | null>(null);
  const [moveCursor, setMoveCursor] = useState<{
    point: { x: number; y: number }; reference: { x: number; y: number } | null;
  } | null>(null);
  // Window selection is view-local, not persisted. Never use a representative
  // single annotation for a batch operation.
  const [windowAnnotations, setWindowAnnotationsState] = useState<WindowDrawingSelection[]>([]);
  const windowAnnotationsRef = useRef<WindowDrawingSelection[]>([]);
  const clearWindowAnnotations = useCallback(() => {
    if (!windowAnnotationsRef.current.length) return;
    windowAnnotationsRef.current = [];
    setWindowAnnotationsState([]);
  }, []);
  function selectWindowAnnotations(items: WindowDrawingSelection[]) {
    setSelectedAnnotation2D(null);
    setEditableAnnotationId(null);
    tags.clearSelection();
    setSelectedMarker(null);
    windowAnnotationsRef.current = items;
    setWindowAnnotationsState(items);
  }
  useEffect(() => { clearWindowAnnotations(); }, [viewKey, drawingProjectId, annotation2DActiveTool, displayOptions.showAnnotations, viewAnnotationOptions, status, clearWindowAnnotations]);
  useEffect(() => {
    if (selectedAnnotation2D || tags.selected || selectedMarker || textAnnotation2DEditing) clearWindowAnnotations();
  }, [selectedAnnotation2D, tags.selected?.id, selectedMarker?.id, textAnnotation2DEditing, clearWindowAnnotations]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isTextEntryElement(document.activeElement)) clearWindowAnnotations();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [clearWindowAnnotations]);
  const selectedTag = tags.selected ?? (tags.draft?.mode === 'edit' ? tags.draft.tag : undefined);
  const annotationPayload = useMemo(() => selectedAnnotation2D
    ? snapshotAnnotation(selectedAnnotation2D, measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D)
    : null, [selectedAnnotation2D, measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D]);
  const canEdit = windowAnnotations.length > 0 || !!selectedTag || !!annotationPayload || !!selectedMarker;
  const canCopyWindow = windowAnnotations.length > 0 && windowAnnotations.every(item => item.type !== 'marker');
  const canCopy = windowAnnotations.length ? canCopyWindow : !!selectedTag || !!annotationPayload;
  const windowCanvasAnnotations = useMemo(() => windowAnnotations.filter(isCanvasWindowAnnotation), [windowAnnotations]);
  const canDelete = windowAnnotations.length > 0 || !!selectedTag || !!annotationPayload || !!selectedMarker;
  const canArrange = !!annotationPayload || (!!selectedTag && !projectGrids.some(grid => grid.id === selectedTag.id));
  const canCut = windowAnnotations.length
    ? canCopyWindow && !windowAnnotations.some(item => item.type === 'tag' && projectGrids.some(grid => grid.id === item.id))
    : !!annotationPayload || (!!selectedTag && !projectGrids.some(grid => grid.id === selectedTag.id));
  useEffect(() => { setEditableAnnotationId(null); }, [selectedAnnotation2D?.id]);
  useEffect(() => { setSelectedMarker(null); }, [savedView?.id]);
  useEffect(() => { if (selectedAnnotation2D) tags.clearSelection(); }, [selectedAnnotation2D?.id]);
  useEffect(() => { if (tags.selected || selectedAnnotation2D) setSelectedMarker(null); }, [tags.selected?.id, selectedAnnotation2D?.id]);
  const newDrawingId = () => globalThis.crypto?.randomUUID?.() ?? `drawing-${Date.now()}-${Math.random()}`;

  function windowClipboard(): DrawingEditClipboard | null {
    const plane = drawing?.config.plane;
    if (!plane || !canCopyWindow) return null;
    const items = snapshotWindowClipboard(windowAnnotations, measure2DResults, polygonArea2DResults,
      textAnnotations2D, cloudAnnotations2D, tags.items.map(entry => entry.tag), projectGrids);
    return items ? { projectId: drawingProjectId, plane: structuredClone(plane), payload: { kind: 'batch', items } } : null;
  }

  function copySelection(): boolean {
    const plane = drawing?.config.plane;
    if (!plane) return false;
    if (windowAnnotations.length) {
      const copied = windowClipboard();
      if (!copied) return false;
      setClipboard(copied);
      return true;
    }
    if (selectedTag) {
      const grid = projectGrids.find(grid => grid.id === selectedTag.id);
      const payload: DrawingClipboardPayload = grid
        ? { kind: 'grid', item: structuredClone(grid) }
        : { kind: 'tag', item: structuredClone(selectedTag) };
      setClipboard({ projectId: drawingProjectId, plane: structuredClone(plane), payload });
      return true;
    }
    if (!annotationPayload) return false;
    setClipboard({ projectId: drawingProjectId, plane: structuredClone(plane), payload: structuredClone(annotationPayload) });
    return true;
  }

  function removeTag(tag: DrawingElementTag) {
    try {
      const grid = useSavedSectionCuts.getState().grids.find(item => item.id === tag.id);
      if (grid) saveProjectGrid(grid, true);
      else if (savedView) {
        const latest = useSavedSectionCuts.getState().cuts.find(cut => cut.id === savedView.id);
        if (!latest) return;
        updateViewSettings(latest.id, { elementTags: readDrawingTags(latest.elementTags).filter(item => item.id !== tag.id) });
      }
      tags.close();
      tags.clearSelection();
    } catch (error) {
      console.warn('Could not delete drawing symbol', error);
      toast.error(t('section2d.tools.editError'));
    }
  }

  function deleteSelection() {
    if (selectedTag) { removeTag(selectedTag); return; }
    if (selectedMarker) {
      try {
        removeSavedSectionCut(selectedMarker.id);
        setSelectedMarker(null);
      } catch (error) {
        console.warn('Could not delete drawing view', error);
        toast.error(t('section2d.tools.editError'));
      }
      return;
    }
    if (annotationPayload) deleteSelectedAnnotation2D();
  }

  async function requestDeleteTag(tag: DrawingElementTag): Promise<boolean> {
    const projectId = drawingProjectId, viewId = savedView?.id;
    const isGrid = useSavedSectionCuts.getState().grids.some(item => item.id === tag.id);
    if (!await confirmDialog({
      description: t(isGrid ? 'section2d.grid.deleteEverywhere' : 'section2d.tools.deleteConfirm'),
      destructive: true,
    })) return false;
    if (useSavedSectionCuts.getState().projectId !== projectId
      || useSavedSectionCuts.getState().activeCutId !== viewId) return false;
    removeTag(tag);
    return true;
  }

  async function requestDeleteMarker(id: string): Promise<boolean> {
    const projectId = drawingProjectId, viewId = savedView?.id;
    if (!await confirmDialog({ description: t('section2d.tools.deleteViewConfirm'), destructive: true })) return false;
    const state = useSavedSectionCuts.getState();
    if (state.projectId !== projectId || state.activeCutId !== viewId || !state.cuts.some(view => view.id === id)) return false;
    try {
      removeSavedSectionCut(id);
      if (selectedMarker?.id === id) setSelectedMarker(null);
      return true;
    } catch (error) {
      console.warn('Could not delete drawing view', error);
      toast.error(t('section2d.tools.editError'));
      return false;
    }
  }

  async function requestDeleteSelection() {
    if (!canDelete) return;
    if (windowAnnotations.length) {
      const batch = windowAnnotations;
      const projectAtRequest = drawingProjectId;
      const viewAtRequest = useSavedSectionCuts.getState().activeCutId;
      const livePlane = useViewerStore.getState().sectionPlane.id;
      const tagIds = new Set(batch.filter(item => item.type === 'tag').map(item => item.id));
      const markerIds = new Set(batch.filter(item => item.type === 'marker').map(item => item.id));
      const hasGrids = useSavedSectionCuts.getState().grids.some(grid => tagIds.has(grid.id));
      const description = [t('section2d.tools.deleteConfirm'),
        ...(hasGrids ? [t('section2d.grid.deleteEverywhere')] : []),
        ...(markerIds.size ? [t('section2d.tools.deleteViewConfirm')] : []),
      ].join(' ');
      if (!viewKey || !await confirmDialog({ description, destructive: true })) return;
      if (windowAnnotationsRef.current !== batch || useSavedSectionCuts.getState().projectId !== projectAtRequest
        || useSavedSectionCuts.getState().activeCutId !== viewAtRequest
        || useViewerStore.getState().sectionPlane.id !== livePlane) return;
      // Persist shared objects first. If storage fails, leave canvas markup intact.
      try {
        deleteDrawingWindowSymbols(viewAtRequest, tagIds, markerIds);
      } catch (error) {
        console.warn('Could not delete drawing selection', error);
        toast.error(t('section2d.tools.editError'));
        return;
      }
      const measureIds = new Set(batch.filter(item => item.type === 'measure').map(item => item.id));
      const areaIds = new Set(batch.filter(item => item.type === 'polygon').map(item => item.id));
      const textIds = new Set(batch.filter(item => item.type === 'text').map(item => item.id));
      const cloudIds = new Set(batch.filter(item => item.type === 'cloud').map(item => item.id));
      useViewerStore.setState(state => {
        const scopedMeasure = (item: typeof state.measure2DResults[number]) => (item.dimension?.viewKey ?? item.viewKey) === viewKey;
        const chains = new Set(state.measure2DResults.filter(item => scopedMeasure(item) && measureIds.has(item.id))
          .map(item => item.dimension?.chainId).filter(Boolean));
        return {
          measure2DResults: state.measure2DResults.filter(item => !scopedMeasure(item)
            || (!measureIds.has(item.id) && !(item.dimension?.chainId && chains.has(item.dimension.chainId)))),
          polygonArea2DResults: state.polygonArea2DResults.filter(item => item.viewKey !== viewKey || !areaIds.has(item.id)),
          textAnnotations2D: state.textAnnotations2D.filter(item => item.viewKey !== viewKey || !textIds.has(item.id)),
          cloudAnnotations2D: state.cloudAnnotations2D.filter(item => item.viewKey !== viewKey || !cloudIds.has(item.id)),
        };
      });
      clearWindowAnnotations();
      return true;
    }
    if (selectedTag) { await requestDeleteTag(selectedTag); return; }
    if (selectedMarker) { await requestDeleteMarker(selectedMarker.id); return; }
    const id = selectedAnnotation2D?.id, viewAtRequest = useSavedSectionCuts.getState().activeCutId, projectAtRequest = drawingProjectId;
    if (!id || !await confirmDialog({ description: t('section2d.tools.deleteConfirm'), destructive: true })) return;
    if (useSavedSectionCuts.getState().projectId !== projectAtRequest || useSavedSectionCuts.getState().activeCutId !== viewAtRequest
      || useViewerStore.getState().selectedAnnotation2D?.id !== id) return;
    deleteSelectedAnnotation2D();
  }

  deletionRef.current = canDelete ? () => { void requestDeleteSelection(); } : null;

  function arrangeSelection(action: DrawingArrangeAction) {
    if (selectedTag && !projectGrids.some(grid => grid.id === selectedTag.id) && savedView) {
      const latest = useSavedSectionCuts.getState().cuts.find(view => view.id === savedView.id);
      if (!latest) return;
      try {
        updateViewSettings(latest.id, { elementTags: arrangeDrawingItems(readDrawingTags(latest.elementTags), selectedTag.id, action) });
      } catch (error) { console.warn('Could not arrange drawing tag', error); toast.error(t('section2d.tools.editError')); }
      return;
    }
    if (!selectedAnnotation2D || !annotationPayload) return;
    const id = selectedAnnotation2D.id;
    useViewerStore.setState(state => {
      switch (selectedAnnotation2D.type) {
        case 'measure': {
          const selected = state.measure2DResults.find(item => item.id === id);
          const chain = selected?.dimension?.chainId;
          const ids = chain ? state.measure2DResults.filter(item => item.viewKey === selected?.viewKey
            && item.dimension?.chainId === chain).map(item => item.id) : [id];
          return { measure2DResults: arrangeDrawingItems(state.measure2DResults, ids, action) };
        }
        case 'polygon': return { polygonArea2DResults: arrangeDrawingItems(state.polygonArea2DResults, id, action) };
        case 'text': return { textAnnotations2D: arrangeDrawingItems(state.textAnnotations2D, id, action) };
        case 'cloud': return { cloudAnnotations2D: arrangeDrawingItems(state.cloudAnnotations2D, id, action) };
      }
    });
  }

  function cutSelection() {
    // A grid is a project datum: deleting it everywhere is never implicit in Cut.
    if (!canCut) return;
    if (windowAnnotations.length) {
      const copied = windowClipboard();
      if (!copied) return;
      // Reuse the scoped, confirmed batch deletion. Keep the old clipboard if
      // the user cancels or persistence fails.
      void requestDeleteSelection().then(deleted => { if (deleted) setClipboard(copied); });
      return;
    }
    if (copySelection()) deleteSelection();
  }

  function pasteSelection() {
    if (!clipboard || !drawing || !viewKey) return;
    try {
      if (clipboard.projectId !== drawingProjectId) {
        toast.error(t('section2d.tools.pasteDifferentProject')); return;
      }
      if (clipboard.payload.kind === 'batch') {
        const payloads = clipboard.payload.items;
        if (payloads.some(item => item.kind !== 'grid') && !sameDrawingCoordinates(clipboard.plane, drawing.config.plane)) {
          toast.error(t('section2d.tools.pasteDifferentPlane')); return;
        }
        const copies = payloads.map(item => cloneClipboardPayload(item, viewKey, newDrawingId));
        const pastedTags = copies.flatMap(item => item.kind === 'tag' ? [item.item] : []);
        const pastedGrids = copies.flatMap(item => item.kind === 'grid' ? [item.item] : []);
        if (pastedTags.length) {
          if (!savedView || useSavedSectionCuts.getState().activeCutId !== savedView.id) {
            toast.error(t('section2d.tags.saveView')); return;
          }
          const targets = collectTagTargets(drawing, displayOptions.showHiddenLines, ifcSpaceRooms);
          if (pastedTags.some(item => !item.free && !findTagTarget(targets, item))) {
            toast.error(t('section2d.tools.pasteMissingTarget')); return;
          }
        }
        // Validate the entire batch before persisting symbols. A failed symbol
        // write must not leave behind a partial set of canvas annotations.
        const pastedMeasures = copies.flatMap(item => item.kind === 'dimensions' ? item.items : []);
        const pastedAreas = copies.flatMap(item => item.kind === 'area' ? [item.item] : []);
        const pastedTexts = copies.flatMap(item => item.kind === 'text' ? [item.item] : []);
        const pastedClouds = copies.flatMap(item => item.kind === 'cloud' ? [item.item] : []);
        pasteDrawingWindowSymbols(savedView?.id ?? null, pastedTags, pastedGrids);
        useViewerStore.setState(state => ({
          measure2DResults: [...state.measure2DResults, ...pastedMeasures],
          polygonArea2DResults: [...state.polygonArea2DResults, ...pastedAreas],
          textAnnotations2D: [...state.textAnnotations2D, ...pastedTexts],
          cloudAnnotations2D: [...state.cloudAnnotations2D, ...pastedClouds],
        }));
        selectWindowAnnotations(copies.flatMap((item): WindowDrawingSelection[] => {
          switch (item.kind) {
            case 'dimensions': return item.items[0] ? [{ type: 'measure', id: item.items[0].id }] : [];
            case 'area': return [{ type: 'polygon', id: item.item.id }];
            case 'text': return [{ type: 'text', id: item.item.id }];
            case 'cloud': return [{ type: 'cloud', id: item.item.id }];
            case 'tag': case 'grid': return [{ type: 'tag', id: item.item.id }];
          }
        }));
        return;
      }
      if (clipboard.payload.kind !== 'grid' && !sameDrawingCoordinates(clipboard.plane, drawing.config.plane)) {
        toast.error(t('section2d.tools.pasteDifferentPlane')); return;
      }
      const pasted = cloneClipboardPayload(clipboard.payload, viewKey, newDrawingId);
      switch (pasted.kind) {
        case 'dimensions':
          useViewerStore.setState(state => ({ measure2DResults: [...state.measure2DResults, ...pasted.items] }));
          if (pasted.items[0]) setSelectedAnnotation2D({ type: 'measure', id: pasted.items[0].id });
          break;
        case 'area':
          useViewerStore.setState(state => ({ polygonArea2DResults: [...state.polygonArea2DResults, pasted.item] }));
          setSelectedAnnotation2D({ type: 'polygon', id: pasted.item.id });
          break;
        case 'text':
          useViewerStore.getState().addTextAnnotation2D(pasted.item);
          setSelectedAnnotation2D({ type: 'text', id: pasted.item.id });
          break;
        case 'cloud':
          useViewerStore.setState(state => ({ cloudAnnotations2D: [...state.cloudAnnotations2D, pasted.item] }));
          setSelectedAnnotation2D({ type: 'cloud', id: pasted.item.id });
          break;
        case 'tag': {
          if (!savedView) return;
          const item = pasted.item;
          if (!item.free && !findTagTarget(collectTagTargets(drawing, displayOptions.showHiddenLines, ifcSpaceRooms), item)) {
            toast.error(t('section2d.tools.pasteMissingTarget')); return;
          }
          const current = useSavedSectionCuts.getState().cuts.find(cut => cut.id === savedView.id);
          if (!current || useSavedSectionCuts.getState().activeCutId !== savedView.id) return;
          updateViewSettings(current.id, { elementTags: [...readDrawingTags(current.elementTags), item] });
          tags.selectById(item.id);
          break;
        }
        case 'grid': {
          const existing = useSavedSectionCuts.getState().grids;
          const base = pasted.item.name + ' Copy';
          let name = base, number = 2;
          while (existing.some(grid => grid.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${base} ${number++}`;
          saveProjectGrid({ ...pasted.item, name });
          tags.selectById(pasted.item.id);
          break;
        }
      }
    } catch (error) { console.warn('Could not paste drawing objects', error); toast.error(t('section2d.tools.editError')); }
  }

  function startMove() {
    if (!canEdit || !drawing) return;
    if (windowAnnotations.length) {
      const batch: MoveItem[] = [];
      const seenDimensions = new Set<string>();
      const bounds = geometryResult?.coordinateInfo.shiftedBounds;
      const markers = bounds && drawnPlane.axis === 'down' && !drawnPlane.custom
        ? collectViewMarkers(useSavedSectionCuts.getState().cuts, bounds, drawnPlane.flipped, DEFAULT_VIEW_MARKERS) : [];
      for (const item of windowAnnotations) {
        if (item.type === 'tag') {
          const tag = tags.items.find(entry => entry.tag.id === item.id)?.tag;
          if (!tag) { toast.error(t('section2d.tools.editError')); return; }
          batch.push({ tag: structuredClone(tag) });
        } else if (item.type === 'marker') {
          const marker = markers.find(entry => entry.id === item.id);
          if (!marker) { toast.error(t('section2d.tools.editError')); return; }
          const dx = marker.end.x - marker.start.x, dy = marker.end.y - marker.start.y;
          batch.push({ marker: { id: marker.id, start: marker.start, end: marker.end,
            reverse: -dy * marker.direction.x + dx * marker.direction.y < 0 } });
        } else {
          const snapshot = snapshotAnnotation(item, measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D);
          if (!snapshot) { toast.error(t('section2d.tools.editError')); return; }
          if (snapshot.kind === 'dimensions') {
            if (snapshot.items.some(segment => seenDimensions.has(segment.id))) continue;
            snapshot.items.forEach(segment => seenDimensions.add(segment.id));
          }
          batch.push({ annotation: item, snapshot });
        }
      }
      if (!batch.length) return;
      moveTarget.current = { projectId: drawingProjectId, viewKey, viewId: savedView?.id, batch };
      setMoveBase(null);
      selectTool('move');
      return;
    }
    moveTarget.current = { projectId: drawingProjectId, viewKey, viewId: savedView?.id,
      ...(selectedMarker ? { marker: structuredClone(selectedMarker) }
        : selectedTag ? { tag: structuredClone(selectedTag) }
        : { annotation: selectedAnnotation2D ?? undefined, snapshot: annotationPayload ? structuredClone(annotationPayload) : undefined }) };
    // Editing properties must be committed before the general Move command.
    if (tags.draft?.mode === 'edit') tags.apply();
    setMoveBase(null);
    selectTool('move');
  }

  function mouseDrawingInput(event: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !(markupTransform.scale > 0)) return null;
    const xScale = drawnPlane.axis === 'side' ? -markupTransform.scale : markupTransform.scale;
    const yScale = drawnPlane.axis === 'down' ? markupTransform.scale : -markupTransform.scale;
    const point = { x: (event.clientX - rect.left - markupTransform.x) / xScale,
      y: (event.clientY - rect.top - markupTransform.y) / yScale };
    const reference = measureHandlers.findSnapPoint(point);
    const directed = moveBase ? resolveMoveDirection(moveBase, point, reference, event.shiftKey) : null;
    const final = directed ?? reference ?? point;
    return { point: final, reference: reference ?? (directed && angularSnap !== 'off' ? final : null) };
  }

  function moveClick(event: React.MouseEvent) {
    if (event.button !== 0) return;
    const input = mouseDrawingInput(event);
    if (!input || !moveTarget.current) return;
    const { point, reference } = input;
    setMoveCursor(null);
    event.preventDefault();
    if (!moveBase) { setMoveBase(point); setMoveCursor({ point, reference }); return; }
    const target = moveTarget.current;
    moveTarget.current = null;
    setMoveBase(null);
    selectTool('none');
    if (target.projectId !== drawingProjectId || target.viewKey !== viewKey || target.viewId !== savedView?.id) return;
    const delta = { x: point.x - moveBase.x, y: point.y - moveBase.y };
    try {
      if (target.batch) {
        // Validate every canvas item before changing any shared object.
        const state = useViewerStore.getState();
        const canvasMoves = target.batch.flatMap(item => {
          const selected = item.annotation;
          if (!selected) return [];
          const result = selected.type === 'measure' ? state.measure2DResults.find(r => r.id === selected.id && (r.dimension?.viewKey ?? r.viewKey) === viewKey)
            : selected.type === 'polygon' ? state.polygonArea2DResults.find(r => r.id === selected.id && r.viewKey === viewKey)
            : selected.type === 'text' ? state.textAnnotations2D.find(r => r.id === selected.id && r.viewKey === viewKey)
            : state.cloudAnnotations2D.find(r => r.id === selected.id && r.viewKey === viewKey);
          const origin = result && ('start' in result ? result.start : 'position' in result ? result.position : result.points[0]);
          if (!origin) throw new Error('Missing selected annotation');
          return [{ selected, origin }];
        });
        if (!drawing || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Invalid move');
        const tagIds = new Set(target.batch.flatMap(item => item.tag ? [item.tag.id] : []));
        const markers = target.batch.flatMap(item => item.marker ? [item.marker] : []);
        // Persist shared objects first, in one write. Reuse the existing canvas
        // action for its dimension constraints and annotation semantics.
        moveDrawingWindowSymbols(target.viewId ?? null, tagIds, markers, drawing.config.plane, drawnPlane.flipped, delta);
        for (const { selected, origin } of canvasMoves) {
          state.moveAnnotation2D(selected, { x: origin.x + delta.x, y: origin.y + delta.y });
        }
        return;
      }
      if (target.marker) {
        const marker = target.marker;
        const shift = (p: { x: number; y: number }) => ({ x: p.x + delta.x, y: p.y + delta.y });
        const world = (p: { x: number; y: number }) => ({ x: drawnPlane.flipped ? -p.x : p.x, y: p.y });
        editSavedViewTrace(marker.id, [world(shift(marker.start)), world(shift(marker.end))],
          drawnPlane.flipped !== marker.reverse, marker.distant);
      } else if (target.tag) {
        const grid = useSavedSectionCuts.getState().grids.find(grid => grid.id === target.tag?.id);
        if (grid && drawing) {
          saveProjectGrid(moveProjectGrid(grid, drawing.config.plane, delta));
        } else if (savedView) {
          const latest = useSavedSectionCuts.getState().cuts.find(view => view.id === savedView.id);
          if (latest) updateViewSettings(latest.id, { elementTags: readDrawingTags(latest.elementTags).map(tag =>
            tag.id === target.tag?.id ? { ...tag,
              position: { x: tag.position.x + delta.x, y: tag.position.y + delta.y },
              anchorOffset: { x: tag.anchorOffset.x + delta.x, y: tag.anchorOffset.y + delta.y },
            } : tag) });
        }
      } else if (target.annotation) {
        const selected = target.annotation;
        const state = useViewerStore.getState();
        const result = selected.type === 'measure' ? state.measure2DResults.find(item => item.id === selected.id)
          : selected.type === 'polygon' ? state.polygonArea2DResults.find(item => item.id === selected.id)
          : selected.type === 'text' ? state.textAnnotations2D.find(item => item.id === selected.id)
          : state.cloudAnnotations2D.find(item => item.id === selected.id);
        const origin = result && ('start' in result ? result.start : 'position' in result ? result.position : result.points[0]);
        if (origin) state.moveAnnotation2D(selected, { x: origin.x + delta.x, y: origin.y + delta.y });
      }
    } catch (error) { console.warn('Could not move drawing object', error); toast.error(t('section2d.tools.editError')); }
  }

  // Text editor handlers
  const handleTextConfirm = useCallback((id: string, text: string, format?: { bold?: boolean; italic?: boolean; align?: 'left'|'center'|'right'; widthMm?: number }) => {
    updateTextAnnotation2D(id, { text, ...format });
    setMoveCursor(null);
    setMeasure2DSnapPoint(null);
    setTextAnnotation2DEditing(null);
  }, [updateTextAnnotation2D, setTextAnnotation2DEditing]);

  const handleTextCancel = useCallback((id: string) => {
    // If text is empty (just created), remove it
    const annotation = textAnnotations2D.find((a) => a.id === id);
    if (annotation && !annotation.text.trim()) removeTextAnnotation2D(id);
    setTextAnnotation2DEditing(null);
  }, [textAnnotations2D, removeTextAnnotation2D, setTextAnnotation2DEditing]);

  const markupCounts = useMemo(() => ({
    measurements: measure2DResults.length,
    areas: polygonArea2DResults.length,
    texts: textAnnotations2D.length,
    clouds: cloudAnnotations2D.length,
  }), [measure2DResults.length, polygonArea2DResults.length, textAnnotations2D.length, cloudAnnotations2D.length]);
  const hasMarkup = markupCounts.measurements + markupCounts.areas + markupCounts.texts + markupCounts.clouds > 0;

  // Cursor style based on active tool
  const cursorClass = useMemo(() => {
    if (selectedAnnotation2D && annotation2DActiveTool === 'none') return 'cursor-move';
    switch (annotation2DActiveTool) {
      case 'move':
      case 'measure':
      case 'polygon-area':
      case 'cloud':
        return 'cursor-crosshair';
      case 'text':
        return 'cursor-text';
      default:
        return 'cursor-default';
    }
  }, [annotation2DActiveTool, selectedAnnotation2D]);
  const selectedAnnotationStyle = (() => {
    const selection = selectedAnnotation2D;
    if (!selection) return null;
    if (selection.type === 'measure') {
      const result = measure2DResults.find(item => item.id === selection.id);
      return { kind: 'dimensions' as const, value: viewAnnotationOptions?.styleIds?.dimensions ?? result?.dimension?.styleId ?? dimensionSettings.library.defaultId,
        choices: dimensionSettings.library.types.map(type => ({ id: type.id,
          name: type.name || (type.id === 'architectural' ? t('section2d.dimensionStyle.architectural') : type.id) })),
        locked: !!viewAnnotationOptions?.styleIds?.dimensions };
    }
    const kind = selection.type === 'polygon' ? 'area' : selection.type;
    const source = selection.type === 'polygon' ? polygonArea2DResults.find(item => item.id === selection.id)
      : selection.type === 'text' ? textAnnotations2D.find(item => item.id === selection.id)
      : cloudAnnotations2D.find(item => item.id === selection.id);
    return { kind, value: viewAnnotationOptions?.styleIds?.[kind] ?? source?.appearanceId ?? 'original',
      choices: (annotationStyles ?? []).filter(style => style.kind === kind).map(style => ({ id: style.id, name: style.name })),
      locked: !!viewAnnotationOptions?.styleIds?.[kind] };
  })();
  function changeSelectedAnnotationStyle(id: string) {
    const selection = selectedAnnotation2D;
    if (!selection || selectedAnnotationStyle?.locked) return;
    if (selection.type === 'measure') { dimensions.assignType(id); return; }
    const appearanceId = id === 'original' ? undefined : id;
    useViewerStore.setState(state => ({
      ...(selection.type === 'polygon' && { polygonArea2DResults: state.polygonArea2DResults.map(item => item.id === selection.id ? { ...item, appearanceId } : item) }),
      ...(selection.type === 'text' && { textAnnotations2D: state.textAnnotations2D.map(item => item.id === selection.id ? { ...item, appearanceId } : item) }),
      ...(selection.type === 'cloud' && { cloudAnnotations2D: state.cloudAnnotations2D.map(item => item.id === selection.id ? { ...item, appearanceId } : item) }),
    }));
  }
  function editSelectedAnnotation() {
    if (!selectedAnnotation2D) return;
    setEditableAnnotationId(selectedAnnotation2D.id);
    if (selectedAnnotation2D.type === 'text') setTextAnnotation2DEditing(selectedAnnotation2D.id);
  }
  function updateAreaVertex(id: string, index: number, point: { x: number; y: number }) {
    if (!viewKey || selectedAnnotation2D?.type !== 'polygon' || selectedAnnotation2D.id !== id
      || editableAnnotationId !== id) return;
    useViewerStore.setState(state => ({ polygonArea2DResults: state.polygonArea2DResults.map(item => {
      if (item.id !== id || item.viewKey !== viewKey) return item;
      const edited = editedPolygonAreaVertex(item.points, index, point);
      return edited ? { ...item, ...edited } : item;
    }) }));
  }
  function resizeRevisionCloud(id: string, points: [{ x: number; y: number }, { x: number; y: number }]) {
    if (!viewKey || selectedAnnotation2D?.type !== 'cloud' || selectedAnnotation2D.id !== id) return;
    useViewerStore.setState(state => ({ cloudAnnotations2D: state.cloudAnnotations2D.map(cloud =>
      cloud.id === id && cloud.viewKey === viewKey ? { ...cloud, points } : cloud) }));
  }
  function clearAnnotationSelection() {
    setEditableAnnotationId(null);
    setTextAnnotation2DEditing(null);
    setSelectedAnnotation2D(null);
  }
  const activeMove = annotation2DActiveTool === 'move' ? moveTarget.current : null;
  const movePreview = moveBase && moveCursor && activeMove ? {
    delta: { x: moveCursor.point.x - moveBase.x,
      y: activeMove.tag?.gridStart && drawing?.config.plane.axis !== 'y' ? 0 : moveCursor.point.y - moveBase.y },
    reference: moveCursor.reference,
    tag: activeMove.tag,
    marker: activeMove.marker,
    payload: activeMove.snapshot,
    batch: activeMove.batch?.map(item => ({ tag: item.tag, marker: item.marker, payload: item.snapshot, annotation: item.annotation })),
  } : null;
  useEffect(() => {
    if (annotation2DActiveTool !== 'move') {
      moveTarget.current = null;
      setMoveBase(null);
      setMoveCursor(null);
      setMeasure2DSnapPoint(null);
    }
  }, [annotation2DActiveTool, setMeasure2DSnapPoint]);
  useEffect(() => {
    const target = moveTarget.current;
    if (annotation2DActiveTool === 'move' && target
      && (target.projectId !== drawingProjectId || target.viewKey !== viewKey || target.viewId !== savedView?.id)) {
      selectTool('none');
    }
  }, [annotation2DActiveTool, drawingProjectId, viewKey, savedView?.id, selectTool]);

  const dimensionTypeOverride = viewAnnotationOptions?.styleIds?.dimensions;
  const displayedMeasurements = dimensionTypeOverride && dimensionSettings.styles.has(dimensionTypeOverride)
    ? measure2DResults.map(item => item.dimension ? { ...item, dimension: { ...item.dimension, styleId: dimensionTypeOverride } } : item)
    : measure2DResults;

  function styledMarkup<T extends { appearanceId?: string }>(kind: 'area' | 'text' | 'cloud', items: T[]) {
    const options = viewAnnotationOptions;
    return items.flatMap(item => {
      const id = options?.styleIds?.[kind] ?? item.appearanceId;
      if (!drawingAnnotationVisible(annotationView, kind, id)) return [];
      const appearance = annotationAppearance(kind, id, annotationStyles, options?.styles?.[kind]);
      return [appearance ? { ...item, appearance } : item];
    });
  }
  const styledAreas = styledMarkup('area', polygonArea2DResults);
  const styledClouds = styledMarkup('cloud', cloudAnnotations2D);

  return {
    runtime, geometryResult, models,
    drawing, sourceDrawing, ifcSpaceRooms, hasReferences, visibleRasterReferenceCount, dxfUnderlayData, status, progress, progressPhase, drawingError,
    displayOptions, unitDisplayOverrides, typeVisibility, viewAnnotationOptions,
    activePresetId, overridesEnabled, overrideEngine, entityColorMap,
    lineweights, lineweightSettings, materialSettings, dimensionSettings, dimensionEditing: dimensions, publicationScale, saved3D, savedView, drawingPlaneId,
    dxfUnderlays, pointCloudClassMask,
    activeSheet, sheetEnabled, titleBlockEditorVisible, setTitleBlockEditorVisible,
    sectionPlane, drawnPlane,
    // Only a drawing the canvas shows can be exported: hidden behind a progress
    // overlay or an error, the previous drawing is no longer the user's drawing.
    exportableDrawing: status === 'ready' ? drawing : null,
    isPinned, togglePinned, containerRef, cachedSheetTransformRef,
    openDrawer, toggleDrawer, closeDrawer,
    viewTransform, markupTransform, zoomIn, zoomOut, fitToView,
    tags, hitTestAnnotations: annotationHandlers.hitTestAnnotations, canvasMouseHandlers: {
      ...canvasMouseHandlers,
      onMouseDown: (e: React.MouseEvent) => {
        // Middle-button Pan must work even while a drawing tool or tag editor is active.
        if (e.button === 1) { measureHandlers.handleMouseDown(e); return true; }
        if (annotation2DActiveTool === 'move' || tags.active) return true;
        if (annotation2DActiveTool === 'none') { tags.clearSelection(); setSelectedMarker(null); }
        return canvasMouseHandlers.onMouseDown(e);
      },
      onMouseMove: (e: React.MouseEvent) => {
        if (e.buttons & 4) { measureHandlers.handleMouseMove(e); return; }
        if (annotation2DActiveTool === 'move') {
          const input = mouseDrawingInput(e);
          if (input) { setMoveCursor(input); setMeasure2DSnapPoint(input.reference); }
        } else if (!tags.move(e)) canvasMouseHandlers.onMouseMove(e);
      },
      onMouseLeave: () => { tags.leave(); canvasMouseHandlers.onMouseLeave(); },
      onClick: (e: React.MouseEvent) => {
        if (annotation2DActiveTool === 'move') moveClick(e);
        else if (!tags.click(e)) canvasMouseHandlers.onClick(e);
      },
    }, cursorClass: tags.active ? 'cursor-crosshair' : cursorClass,
    measure2DMode, measure2DResults, displayedMeasurements, styledAreas, styledNotes, styledClouds, measure2DSnapPoint, dimensionType, selectDimensionType, angularSnap, setAngularSnap,
    objectSnaps, setObjectSnaps, snapsEnabled, toggleSnaps, selectOnly2D, toggleSelectOnly2D,
    findSnapPoint: measureHandlers.findSnapPoint, snapKindFor: measureHandlers.snapKindFor,
    dimensionDraft: measureHandlers.draft, dimensionPreview: measureHandlers.preview,
    annotation2DActiveTool, selectTool, annotation2DCursorPos,
    canEdit, canCopy, canDelete, canCut, canArrange, canPaste: !!clipboard, startMove, copySelection, cutSelection, pasteSelection, deleteSelection, requestDeleteSelection, requestDeleteTag, requestDeleteMarker, arrangeSelection,
    moveBase, moveCursor, movePreview, selectedMarker, setSelectedMarker,
    selectedAnnotationStyle, changeSelectedAnnotationStyle, editSelectedAnnotation, clearAnnotationSelection,
    editableAnnotationId, resizeRevisionCloud, updateAreaVertex,
    polygonArea2DPoints, polygonArea2DResults,
    textAnnotations2D, textAnnotation2DEditing, handleTextConfirm, handleTextCancel,
    cloudAnnotation2DPoints, cloudAnnotations2D,
    windowAnnotations, windowCanvasAnnotations, selectWindowAnnotations, clearWindowAnnotations,
    selectedAnnotation2D, clearAllAnnotations2D: () => { if (tags.clear()) { dimensions.clearAllAnnotations2D(); clearWindowAnnotations(); } },
    markupCounts, hasMarkup: hasMarkup || tags.items.length > 0,
    toggleIfcAnnotations, toggleConstructionProjection, toggleOverheadProjection, toggle3DOverlay, toggleSymbolicRepresentations,
    togglePrintPreview, paperTheme,
  };
}

export type DrawingViewModel = ReturnType<typeof useDrawingViewModel>;
