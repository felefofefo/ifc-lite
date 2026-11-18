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
import type { AngularSnap } from '@/hooks/useDrawingDirection';
import { useViewerStore } from '@/store';
import { selectActiveSavedView, setDrawingProjectionDisplay, useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import type { Annotation2DTool } from '@/store/slices/drawing2DSlice';
import type { DrawingInspectorTab } from '@/store/slices/drawingInspectorSlice';
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
import { annotationAppearance } from '@/lib/drawing/annotation-types';
import { lineweightsAtScale } from '@/lib/drawing/lineweight-table';
import { drawnSectionPlane } from '@/lib/drawing/drawn-section-plane';

/** The settings panels beside the canvas, as inspector tabs (#5495); they
 *  share one slot. Re-exported for the drawing/ subtree's existing imports. */
export type DrawingDrawer = DrawingInspectorTab;

import { useDrawingTags } from './DrawingElementTags';

export function useDrawingViewModel() {
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
  const { annotationStyles, defaultAnnotationStyles } = useSavedSectionCuts(state => state.tagLibrary);
  const drawingPlaneId = useSavedSectionCuts(s => s.drawingPlaneId);
  const saved3D = savedView?.kind === '3d' ? savedView : undefined;
  const publicationScale = saved3D ? saved3D.publicationScale ?? displayOptions.scale
    : sheetEnabled && activeSheet ? activeSheet.scale.factor : displayOptions.scale;
  const lineweights = lineweightsAtScale(lineweightSettings.table, publicationScale);
  const titleBlockEditorVisible = useViewerStore((s) => s.titleBlockEditorVisible);
  const setTitleBlockEditorVisible = useViewerStore((s) => s.setTitleBlockEditorVisible);

  const measure2DMode = useViewerStore((s) => s.measure2DMode);
  const [dimensionType, setDimensionType] = useState<DimensionType>('aligned');
  const [angularSnap, setAngularSnap] = useState<AngularSnap>('off');
  const [objectSnaps, setObjectSnaps] = useState(DEFAULT_OBJECT_SNAPS);
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
    objectSnaps,
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
    findSnapPoint: measureHandlers.findSnapPoint, angularSnap, lineweights,
  });

  const annotationHandlers = useAnnotation2D({
    drawing, viewTransform: markupTransform, sectionAxis: drawnPlane.axis, containerRef,
    activeTool: annotation2DActiveTool, setActiveTool: setAnnotation2DActiveTool,
    polygonArea2DPoints, addPolygonArea2DPoint,
    completePolygonArea2D: (area, perimeter) => { if (viewKey) completePolygonArea2D(area, perimeter, viewKey, defaultAnnotationStyles?.area); }, cancelPolygonArea2D,
    textAnnotations2D: displayOptions.showAnnotations ? textAnnotations2D : [],
    addTextAnnotation2D: annotation => { if (viewKey) addTextAnnotation2D({ ...annotation, viewKey, appearanceId: defaultAnnotationStyles?.text }); }, setTextAnnotation2DEditing,
    cloudAnnotation2DPoints, cloudAnnotations2D: displayOptions.showAnnotations ? cloudAnnotations2D : [], addCloudAnnotation2DPoint,
    completeCloudAnnotation2D: label => { if (viewKey) completeCloudAnnotation2D(label, viewKey, defaultAnnotationStyles?.cloud); }, cancelCloudAnnotation2D,
    measure2DResults: displayOptions.showAnnotations ? measure2DResults : [], polygonArea2DResults: displayOptions.showAnnotations ? polygonArea2DResults : [],
    pickDimensionLabel: displayOptions.showAnnotations ? dimensions.pickDimensionLabel : undefined,
    selectedAnnotation2D, setSelectedAnnotation2D, deleteSelectedAnnotation2D, moveAnnotation2D,
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

  // Text editor handlers
  const handleTextConfirm = useCallback((id: string, text: string) => {
    updateTextAnnotation2D(id, { text });
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

  const dimensionTypeOverride = savedView?.annotationOptions?.styleIds?.dimensions;
  const displayedMeasurements = dimensionTypeOverride && dimensionSettings.styles.has(dimensionTypeOverride)
    ? measure2DResults.map(item => item.dimension ? { ...item, dimension: { ...item.dimension, styleId: dimensionTypeOverride } } : item)
    : measure2DResults;

  function styledMarkup<T extends { appearanceId?: string }>(kind: 'area' | 'text' | 'cloud', items: T[]) {
    const options = savedView?.annotationOptions;
    return items.flatMap(item => {
      const id = options?.styleIds?.[kind] ?? item.appearanceId;
      if (!drawingAnnotationVisible(savedView, kind, id)) return [];
      const appearance = annotationAppearance(kind, id, annotationStyles, options?.styles?.[kind]);
      return [appearance ? { ...item, appearance } : item];
    });
  }
  const styledAreas = styledMarkup('area', polygonArea2DResults);
  const styledNotes = styledMarkup('text', textAnnotations2D);
  const styledClouds = styledMarkup('cloud', cloudAnnotations2D);

  return {
    runtime, geometryResult, models,
    drawing, sourceDrawing, hasReferences, visibleRasterReferenceCount, dxfUnderlayData, status, progress, progressPhase, drawingError,
    displayOptions, unitDisplayOverrides, typeVisibility,
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
    tags, canvasMouseHandlers: {
      ...canvasMouseHandlers,
      onMouseDown: (e: React.MouseEvent) => tags.active || canvasMouseHandlers.onMouseDown(e),
      onMouseMove: (e: React.MouseEvent) => { if (!tags.move(e)) canvasMouseHandlers.onMouseMove(e); },
      onMouseLeave: () => { tags.leave(); canvasMouseHandlers.onMouseLeave(); },
      onClick: (e: React.MouseEvent) => { if (!tags.click(e)) canvasMouseHandlers.onClick(e); },
    }, cursorClass: tags.active ? 'cursor-crosshair' : cursorClass,
    measure2DMode, measure2DResults, displayedMeasurements, styledAreas, styledNotes, styledClouds, measure2DSnapPoint, dimensionType, selectDimensionType, angularSnap, setAngularSnap,
    objectSnaps, setObjectSnaps, findSnapPoint: measureHandlers.findSnapPoint,
    dimensionDraft: measureHandlers.draft, dimensionPreview: measureHandlers.preview,
    annotation2DActiveTool, selectTool, annotation2DCursorPos,
    polygonArea2DPoints, polygonArea2DResults,
    textAnnotations2D, textAnnotation2DEditing, handleTextConfirm, handleTextCancel,
    cloudAnnotation2DPoints, cloudAnnotations2D,
    selectedAnnotation2D, clearAllAnnotations2D: () => { if (tags.clear()) dimensions.clearAllAnnotations2D(); },
    markupCounts, hasMarkup: hasMarkup || tags.items.length > 0,
    toggleIfcAnnotations, toggleConstructionProjection, toggleOverheadProjection, toggle3DOverlay, toggleSymbolicRepresentations,
    togglePrintPreview, paperTheme,
  };
}

export type DrawingViewModel = ReturnType<typeof useDrawingViewModel>;
