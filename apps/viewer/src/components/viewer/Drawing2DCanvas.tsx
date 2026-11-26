/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { drawingPublicationStrokeStyle } from '@/hooks/drawingPublicationStrokeStyle';
import type { DimensionSegment } from '@/lib/drawing/dimension-line';
import { mapDimensionShape } from '@/lib/drawing/dimension-line';
import { DEFAULT_DIMENSION_STYLE, DIMENSION_FONTS, drawDimensionStrokes, formatDimensionLabel, resolveDimensionStyle, styledDimension, type DimensionLabelHit, type DimensionStyle } from '@/lib/drawing/dimension-style';
import type { LineweightRow } from '@/lib/drawing/lineweight-table';
import type { DrawingPolygon } from '@ifc-lite/drawing-2d';
import type { usePublicationFillPreview } from '@/hooks/usePublicationFillPreview';
import { drawPublicationCanvasFills, drawPublicationSurfaces } from './drawing/publication-canvas-fills';
import { drawDxfUnderlaysScreenSpace } from './drawing-underlays';
import { drawReferenceImages } from './drawing-reference-images';
import { useReferenceImagesForDrawing } from '@/hooks/useReferenceImagesForDrawing';
import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  GraphicOverrideEngine,
  isOccludedDrawingLine,
  type Drawing2D,
  type ElementData,
  isPolygonCutLine,
} from '@ifc-lite/drawing-2d';
import type { DrawingLine2D } from '@ifc-lite/renderer';
import { formatDistance } from './tools/formatDistance';
import { drawCloudOnCanvas } from './tools/cloudPathGenerator';
import type { PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D, Annotation2DTool, Measure2DResult, Point2D, SelectedAnnotation2D } from '@/store/slices/drawing2DSlice';
import type { DxfUnderlayRenderData } from '@/hooks/useDxfUnderlay';
import type { AnnotationFill2D, AnnotationText2D } from '@/hooks/useSymbolicAnnotations';
import type { ScanBandPoint } from '@/hooks/scanSectionMath';
import { drawScanSectionScreenSpace } from './drawing/scanSectionCanvas';
import { type CachedSheetTransform } from '@/lib/drawing/sheet-geometry-key';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import { useDrawingElementPropertiesLookup } from '@/hooks/useDrawingElementPropertiesLookup';
import { markActiveDrawingCanvasRendered, registerActiveDrawingCanvas } from '@/lib/drawing/active-canvas-snapshot';
import { textAnnotationLayout } from '@/lib/drawing/annotation-types';
import { resolveCutPolygonStyle } from './drawing/cut-polygon-style';
import { resolveDrawingPaperTheme, type DrawingPaperTheme } from './drawing/paper-theme';

// ─── IFC annotation overlay helpers (issue #812) ─────────────────────────────

/** Linear sRGB straight-alpha [0..1] tuple → CSS `rgba(...)`. */
function rgbaToCss(c: readonly [number, number, number, number]): string {
  const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, c[3]))})`;
}

/**
 * Map IFC `BoxAlignment` to canvas2d `textAlign` + `textBaseline`. Mirrors
 * the renderer's `parseBoxAlignment` semantics so the 2D overlay anchors
 * text the same way the 3D pipeline does. Unknown / empty strings default
 * to bottom-left (IFC4 IfcTextLiteralWithExtent default).
 */
function alignmentToCanvas(s: string): { align: CanvasTextAlign; baseline: CanvasTextBaseline } {
  const norm = (s ?? '').toLowerCase().trim();
  let align: CanvasTextAlign = 'left';
  let baseline: CanvasTextBaseline = 'alphabetic';
  if (norm.includes('right')) align = 'right';
  else if (norm.includes('center')) align = 'center';
  if (norm.includes('top')) baseline = 'top';
  else if (norm.includes('middle') || (norm.includes('center') && !norm.includes('center-'))) baseline = 'middle';
  return { align, baseline };
}

/**
 * Render IFC annotation fills, lines, and text into the canvas, in screen
 * pixels. The caller supplies:
 *   - `modelToScreen` – drawing-coord → screen-pixel conversion (accounts
 *     for axis flips and sheet-mode paper scale)
 *   - `mmLineToScreen` – mm line weight → screen px stroke width
 *   - `worldHeightToScreenPx` – world-units text height → screen px font size
 *
 * Called from both the sheet-mode and direct-mode render paths in
 * `Drawing2DCanvas`. Splitting it out keeps the two paths in sync without
 * duplicating ~80 lines of canvas calls.
 *
 * Text rendering uses identity transform (no canvas rotate-with-scale) so
 * `direct mode`'s y-flip doesn't mirror glyphs. The baseline direction is
 * recovered in screen space from `dirX/dirY` mapped through `modelToScreen`.
 */
function drawIfcAnnotationsScreenSpace(
  ctx: CanvasRenderingContext2D,
  lines: readonly DrawingLine2D[] | undefined,
  texts: readonly AnnotationText2D[] | undefined,
  fills: readonly AnnotationFill2D[] | undefined,
  modelToScreen: (x: number, y: number) => { x: number; y: number },
  mmLineToScreen: (mmWeight: number) => number,
  worldHeightToScreenPx: (worldHeight: number) => number,
): void {
  // Fills first so lines/text composite cleanly on top.
  if (fills && fills.length > 0) {
    for (const fill of fills) {
      const pts = fill.points;
      if (pts.length < 6) continue;
      const holes = fill.holesOffsets;

      ctx.fillStyle = rgbaToCss(fill.color);
      ctx.beginPath();

      // Outer ring runs from index 0 up to the first hole offset (or end of
      // points if no holes). Each hole offset is a vertex index where the
      // next ring starts. Path subpaths use moveTo + lineTo + closePath; the
      // even-odd fill rule handles the holes.
      const ringStarts: number[] = [0];
      for (let i = 0; i < holes.length; i++) ringStarts.push(holes[i]);
      ringStarts.push(pts.length / 2); // sentinel end

      for (let ri = 0; ri < ringStarts.length - 1; ri++) {
        const start = ringStarts[ri];
        const end = ringStarts[ri + 1];
        if (end - start < 3) continue;
        const first = modelToScreen(pts[start * 2], pts[start * 2 + 1]);
        ctx.moveTo(first.x, first.y);
        for (let i = start + 1; i < end; i++) {
          const p = modelToScreen(pts[i * 2], pts[i * 2 + 1]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }

  if (lines && lines.length > 0) {
    // Slightly heavier than the drawing-2d 'annotation' category (0.13 mm)
    // so coplanar overlays read clearly against the cut polygons beneath.
    // This is the 2D equivalent of the 3D thicker-lines suggestion in #812.
    const lineWidthMm = 0.2;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = mmLineToScreen(lineWidthMm);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const ln of lines) {
      const a = modelToScreen(ln.line.start.x, ln.line.start.y);
      const b = modelToScreen(ln.line.end.x, ln.line.end.y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  if (texts && texts.length > 0) {
    for (const t of texts) {
      if (!t.content) continue;
      const anchor = modelToScreen(t.x, t.y);
      // Recover baseline direction in SCREEN space. modelToScreen may flip
      // axes (e.g. direct-mode flips Y), so atan2(dirY, dirX) on raw model
      // dirs would draw the text mirrored on those axes.
      const baselineEnd = modelToScreen(t.x + t.dirX, t.y + t.dirY);
      const sx = baselineEnd.x - anchor.x;
      const sy = baselineEnd.y - anchor.y;
      const angle = Math.abs(sx) + Math.abs(sy) > 1e-6 ? Math.atan2(sy, sx) : 0;

      const fontPx = t.targetPx && t.targetPx > 0 ? t.targetPx : worldHeightToScreenPx(t.height);
      const { align, baseline } = alignmentToCanvas(t.alignment);
      // Multi-line literals stack downward in world Y in 3D. In 2D screen
      // space the equivalent is `+ fontPx` per line below the anchor along
      // the baseline-perpendicular (handled by the canvas rotate below).
      const lineOffsetPx = (t.lineYOffset ?? 0) * (fontPx / Math.max(1e-6, t.height));

      ctx.save();
      ctx.fillStyle = t.color ? rgbaToCss(t.color) : '#000000';
      ctx.font = `${fontPx}px system-ui, sans-serif`;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.translate(anchor.x, anchor.y);
      ctx.rotate(angle);
      ctx.fillText(t.content, 0, lineOffsetPx);
      ctx.restore();
    }
  }
}

const CANVAS_STYLE = { imageRendering: 'crisp-edges' as const };
const EMPTY_MEASURE_RESULTS: Measure2DResultData[] = [];
const EMPTY_DIMENSION_PREVIEW: DimensionSegment[] = [];
const EMPTY_DIMENSION_POINTS: Point2D[] = [];
const EMPTY_UNIT_DISPLAY_OVERRIDES: Record<string, string> = {};

export type Measure2DResultData = Measure2DResult;

interface Drawing2DCanvasProps {
  drawing: Drawing2D;
  snapshotSourceDrawing?: Drawing2D;
  transform: { x: number; y: number; scale: number };
  showHiddenLines: boolean;
  overrideEngine: GraphicOverrideEngine;
  overridesEnabled: boolean;
  entityColorMap: Map<number, [number, number, number, number]>;
  useIfcMaterials: boolean;
  lineweights?: LineweightRow;
  printPreview?: boolean;
  fillPreview?: ReturnType<typeof usePublicationFillPreview>;
  // Measure tool props
  measureMode?: boolean;
  markupTransform?: { x: number; y: number; scale: number };
  dimensionStyle?: DimensionStyle;
  dimensionStyles?: ReadonlyMap<string, DimensionStyle>;
  dimensionLabelHits?: React.RefObject<DimensionLabelHit[]>;
  publicationScale?: number;
  dimensionPreview?: DimensionSegment[];
  dimensionPoints?: Point2D[];
  measureResults?: Measure2DResultData[];
  measureSnapPoint?: { x: number; y: number } | null;
  // Sheet mode props
  sheetEnabled?: boolean;
  activeSheet?: import('@ifc-lite/drawing-2d').DrawingSheet | null;
  // Section plane info for axis-specific rendering
  sectionAxis: 'down' | 'front' | 'side';
  // Pinned mode - keep model fixed in place on sheet
  isPinned?: boolean;
  cachedSheetTransformRef?: React.MutableRefObject<CachedSheetTransform | null>;
  // Annotation props
  annotation2DActiveTool?: Annotation2DTool;
  annotation2DCursorPos?: Point2D | null;
  polygonAreaPoints?: Point2D[];
  polygonAreaResults?: PolygonArea2DResult[];
  textAnnotations?: TextAnnotation2D[];
  textAnnotationEditing?: string | null;
  cloudAnnotationPoints?: Point2D[];
  cloudAnnotations?: CloudAnnotation2D[];
  // Selection
  selectedAnnotation?: SelectedAnnotation2D | null;
  hoveredAnnotation?: SelectedAnnotation2D | null;
  windowAnnotations?: readonly SelectedAnnotation2D[];
  // IFC annotation overlay (issue #812)
  ifcAnnotationLines?: readonly DrawingLine2D[];
  ifcAnnotationTexts?: readonly AnnotationText2D[];
  ifcAnnotationFills?: readonly AnnotationFill2D[];
  // DXF reference underlays, pre-mapped to drawing space (issue #1782)
  dxfUnderlays?: readonly DxfUnderlayRenderData[];
  // Point-cloud scan overlay, already in drawing space (issue #1805)
  scanPoints?: readonly ScanBandPoint[];
  scanOpacity?: number;
  /** Traced scan outline rings in drawing space (#6871). */
  scanOutline?: readonly (readonly Point2D[])[];
  // LENGTHUNIT display override for the on-canvas measure distance/perimeter
  // labels (#2199 slice not covered by #2538, which wired every OTHER
  // measure-tool readout — MeasurePanel.tsx, MeasurementVisuals.tsx — through
  // `unitDisplayOverrides` but left this canvas's own `formatDistance()`
  // calls on the pre-#2199 no-argument (always-metric) form).
  unitDisplayOverrides?: Record<string, string>;
  // Paper/ink follow the app theme in direct mode; sheet mode's paper stays
  // white regardless (#5496). Defaults to the light-theme reading so every
  // existing caller (there is exactly one, `DrawingCanvasView`) that doesn't
  // pass it yet keeps today's white-paper look.
  paperTheme?: DrawingPaperTheme;
}

const DEFAULT_PAPER_THEME: DrawingPaperTheme = resolveDrawingPaperTheme('light', false);

export function Drawing2DCanvas({
  drawing,
  snapshotSourceDrawing = drawing,
  transform,
  showHiddenLines,
  overrideEngine,
  overridesEnabled,
  entityColorMap,
  useIfcMaterials, fillPreview, lineweights, printPreview,
  measureMode = false,
  markupTransform = transform,
  dimensionStyle = DEFAULT_DIMENSION_STYLE,
  dimensionStyles,
  dimensionLabelHits,
  publicationScale = 100,
  dimensionPreview = EMPTY_DIMENSION_PREVIEW,
  dimensionPoints = EMPTY_DIMENSION_POINTS,
  measureResults = EMPTY_MEASURE_RESULTS,
  measureSnapPoint = null,
  sheetEnabled = false,
  activeSheet = null,
  sectionAxis,
  isPinned = false,
  cachedSheetTransformRef,
  annotation2DActiveTool = 'none',
  annotation2DCursorPos = null,
  polygonAreaPoints = [],
  polygonAreaResults = [],
  textAnnotations = [],
  textAnnotationEditing = null,
  cloudAnnotationPoints = [],
  cloudAnnotations = [],
  selectedAnnotation = null,
  hoveredAnnotation = null,
  windowAnnotations,
  ifcAnnotationLines,
  ifcAnnotationTexts,
  ifcAnnotationFills,
  dxfUnderlays,
  scanPoints,
  scanOpacity = 1,
  scanOutline,
  unitDisplayOverrides = EMPTY_UNIT_DISPLAY_OVERRIDES,
  paperTheme = DEFAULT_PAPER_THEME,
}: Drawing2DCanvasProps): React.ReactElement {
  const referenceImages = useReferenceImagesForDrawing(drawing.config.plane);
  const strokeLines = useMemo(() => {
    const projection: Drawing2D['lines'] = [];
    const openCuts: Drawing2D['lines'] = [];
    for (const line of drawing.lines) {
      if (isPolygonCutLine(line)) continue;
      if (line.category === 'cut') openCuts.push(line);
      else projection.push(line);
    }
    return [...projection, ...openCuts];
  }, [drawing.lines]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // Resolved once per (model set, polygon set) change, never per draw frame.
  const getElementProperties = useDrawingElementPropertiesLookup(drawing, overrideEngine, overridesEnabled);
  useEffect(() => canvasRef.current ? registerActiveDrawingCanvas(canvasRef.current, snapshotSourceDrawing) : undefined, [snapshotSourceDrawing]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setCanvasSize((prev) => {
          // Only update if size actually changed to avoid render loops
          if (prev.width !== width || prev.height !== height) {
            return { width, height };
          }
          return prev;
        });
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (dimensionLabelHits) dimensionLabelHits.current = [];
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0 || canvasSize.height === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pen = lineweights ? drawingPublicationStrokeStyle(lineweights, { overrideEngine, overridesEnabled, getElementProperties }, fillPreview?.distant) : undefined;
    const cutFill = (polygon: DrawingPolygon, darkPaper = false) => {
      const { fillColor, fillOpacity } = resolveCutPolygonStyle(polygon, {
        useIfcMaterials, entityColorMap, overridesEnabled, overrideEngine, getElementProperties, darkPaper,
      });
      return { fillColor, opacity: fillOpacity };
    };

    // Set canvas size using tracked dimensions
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear with the desk (shows the paper edge when in sheet mode) or the
    // theme's paper colour in direct mode (#5496: dark paper in dark theme,
    // print preview always white).
    ctx.fillStyle = sheetEnabled && activeSheet ? paperTheme.desk : paperTheme.paper;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET MODE: Render paper, frame, title block, then drawing in viewport
    // ═══════════════════════════════════════════════════════════════════════
    if (sheetEnabled && activeSheet) {
      const paper = activeSheet.paper;
      const frame = activeSheet.frame;
      const titleBlock = activeSheet.titleBlock;
      const viewport = activeSheet.viewportBounds;
      const scaleBar = activeSheet.scaleBar;
      const northArrow = activeSheet.northArrow;

      // Helper: convert sheet mm to screen pixels
      const mmToScreen = (mm: number) => mm * transform.scale;
      const mmToScreenX = (x: number) => x * transform.scale + transform.x;
      const mmToScreenY = (y: number) => y * transform.scale + transform.y;

      // ─────────────────────────────────────────────────────────────────────
      // 1. Draw paper background (white with shadow)
      // ─────────────────────────────────────────────────────────────────────
      // Always white regardless of theme (#5496): a sheet models a physical
      // printed page, and only the desk around it (the clear above) follows
      // the theme.
      ctx.save();
      // Paper shadow
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 10 * (transform.scale > 0.5 ? 1 : transform.scale * 2);
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        mmToScreenX(0),
        mmToScreenY(0),
        mmToScreen(paper.widthMm),
        mmToScreen(paper.heightMm)
      );
      ctx.restore();

      // Paper border
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        mmToScreenX(0),
        mmToScreenY(0),
        mmToScreen(paper.widthMm),
        mmToScreen(paper.heightMm)
      );

      // ─────────────────────────────────────────────────────────────────────
      // 2. Draw frame borders
      // ─────────────────────────────────────────────────────────────────────
      const frameLeft = frame.margins.left + frame.margins.bindingMargin;
      const frameTop = frame.margins.top;
      const frameRight = paper.widthMm - frame.margins.right;
      const frameBottom = paper.heightMm - frame.margins.bottom;
      const frameWidth = frameRight - frameLeft;
      const frameHeight = frameBottom - frameTop;

      // Outer border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, mmToScreen(frame.border.outerLineWeight));
      ctx.strokeRect(
        mmToScreenX(frameLeft),
        mmToScreenY(frameTop),
        mmToScreen(frameWidth),
        mmToScreen(frameHeight)
      );

      // Inner border (if gap > 0)
      if (frame.border.borderGap > 0) {
        const innerLeft = frameLeft + frame.border.borderGap;
        const innerTop = frameTop + frame.border.borderGap;
        const innerWidth = frameWidth - 2 * frame.border.borderGap;
        const innerHeight = frameHeight - 2 * frame.border.borderGap;

        ctx.lineWidth = Math.max(0.5, mmToScreen(frame.border.innerLineWeight));
        ctx.strokeRect(
          mmToScreenX(innerLeft),
          mmToScreenY(innerTop),
          mmToScreen(innerWidth),
          mmToScreen(innerHeight)
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // 3. Draw title block
      // ─────────────────────────────────────────────────────────────────────
      const innerLeft = frameLeft + frame.border.borderGap;
      const innerTop = frameTop + frame.border.borderGap;
      const innerWidth = frameWidth - 2 * frame.border.borderGap;
      const innerHeight = frameHeight - 2 * frame.border.borderGap;

      let tbX: number, tbY: number, tbW: number, tbH: number;
      switch (titleBlock.position) {
        case 'bottom-right':
          tbW = titleBlock.widthMm;
          tbH = titleBlock.heightMm;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop + innerHeight - tbH;
          break;
        case 'bottom-full':
          tbW = innerWidth;
          tbH = titleBlock.heightMm;
          tbX = innerLeft;
          tbY = innerTop + innerHeight - tbH;
          break;
        case 'right-strip':
          tbW = titleBlock.widthMm;
          tbH = innerHeight;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop;
          break;
        default:
          tbW = titleBlock.widthMm;
          tbH = titleBlock.heightMm;
          tbX = innerLeft + innerWidth - tbW;
          tbY = innerTop + innerHeight - tbH;
      }

      // Title block border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(1, mmToScreen(titleBlock.borderWeight));
      ctx.strokeRect(
        mmToScreenX(tbX),
        mmToScreenY(tbY),
        mmToScreen(tbW),
        mmToScreen(tbH)
      );

      // Title block fields - calculate row heights based on font sizes
      const logoSpace = titleBlock.logo ? 50 : 0;
      const revisionSpace = titleBlock.showRevisionHistory ? 20 : 0;
      const availableWidth = tbW - logoSpace - 5;
      const availableHeight = tbH - revisionSpace - 4;
      const numCols = 2;

      // Group fields by row
      const fieldsByRow = new Map<number, typeof titleBlock.fields>();
      for (const field of titleBlock.fields) {
        const row = field.row ?? 0;
        if (!fieldsByRow.has(row)) fieldsByRow.set(row, []);
        fieldsByRow.get(row)!.push(field);
      }

      // Calculate minimum height needed for each row based on its largest font
      const rowCount = Math.max(...Array.from(fieldsByRow.keys()), 0) + 1;
      const rowHeights: number[] = [];
      let totalMinHeight = 0;

      for (let r = 0; r < rowCount; r++) {
        const fields = fieldsByRow.get(r) || [];
        const maxFontSize = fields.length > 0 ? Math.max(...fields.map(f => f.fontSize)) : 3;
        const labelSize = Math.min(maxFontSize * 0.5, 2.2);
        const minRowHeight = labelSize + 1 + maxFontSize + 2;
        rowHeights.push(minRowHeight);
        totalMinHeight += minRowHeight;
      }

      // Scale row heights if they exceed available space
      const rowScaleFactor = totalMinHeight > availableHeight ? availableHeight / totalMinHeight : 1;
      const scaledRowHeights = rowHeights.map(h => h * rowScaleFactor);

      const colWidth = availableWidth / numCols;
      const gridStartX = tbX + logoSpace + 2;
      const gridStartY = tbY + 2;

      // Calculate row Y positions
      const rowYPositions: number[] = [gridStartY];
      for (let i = 0; i < scaledRowHeights.length - 1; i++) {
        rowYPositions.push(rowYPositions[i] + scaledRowHeights[i]);
      }

      // Draw grid lines
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = Math.max(0.5, mmToScreen(titleBlock.gridWeight));

      // Horizontal lines
      for (let i = 1; i < rowCount; i++) {
        const lineY = rowYPositions[i];
        ctx.beginPath();
        ctx.moveTo(mmToScreenX(gridStartX), mmToScreenY(lineY));
        ctx.lineTo(mmToScreenX(gridStartX + availableWidth - 4), mmToScreenY(lineY));
        ctx.stroke();
      }

      // Vertical dividers (for rows with multiple columns)
      for (const [row, fields] of fieldsByRow) {
        const hasMultipleCols = fields.some(f => (f.colSpan ?? 1) < 2);
        if (hasMultipleCols) {
          const centerX = gridStartX + colWidth;
          const lineY1 = rowYPositions[row];
          const lineY2 = rowYPositions[row] + scaledRowHeights[row];
          ctx.beginPath();
          ctx.moveTo(mmToScreenX(centerX), mmToScreenY(lineY1));
          ctx.lineTo(mmToScreenX(centerX), mmToScreenY(lineY2));
          ctx.stroke();
        }
      }

      // Render field text - scale proportionally with zoom
      for (const [row, fields] of fieldsByRow) {
        const rowY = rowYPositions[row];
        if (rowY === undefined) continue;

        const rowH = scaledRowHeights[row] ?? 5;
        const screenRowH = mmToScreen(rowH);

        // Skip if row is too small to be readable
        if (screenRowH < 4) continue;

        for (const field of fields) {
          const col = field.col ?? 0;
          const fieldX = gridStartX + col * colWidth + 1.5;

          // Calculate font sizes in mm (accounting for compressed rows)
          const effectiveScale = rowScaleFactor < 1 ? rowScaleFactor : 1;
          const labelFontMm = Math.min(field.fontSize * 0.45, 2.2) * Math.max(effectiveScale, 0.7);
          const valueFontMm = field.fontSize * Math.max(effectiveScale, 0.7);

          // Convert to screen pixels - scales naturally with zoom
          const screenLabelFont = mmToScreen(labelFontMm);
          const screenValueFont = mmToScreen(valueFontMm);

          // Skip if too small to read
          if (screenLabelFont < 3) continue;

          const screenRowY = mmToScreenY(rowY);
          const screenFieldX = mmToScreenX(fieldX);

          // Label
          ctx.font = `${screenLabelFont}px Arial, sans-serif`;
          ctx.fillStyle = '#666666';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(field.label, screenFieldX, screenRowY + mmToScreen(0.3));

          // Value below label (spacing in mm, converted to screen)
          const valueY = screenRowY + mmToScreen(labelFontMm + 0.5);
          ctx.font = `${field.fontWeight === 'bold' ? 'bold ' : ''}${screenValueFont}px Arial, sans-serif`;
          ctx.fillStyle = '#000000';
          ctx.fillText(field.value, screenFieldX, valueY);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // 4. Clip to viewport and draw model content
      // ─────────────────────────────────────────────────────────────────────
      ctx.save();

      // Create clip region for viewport
      ctx.beginPath();
      ctx.rect(
        mmToScreenX(viewport.x),
        mmToScreenY(viewport.y),
        mmToScreen(viewport.width),
        mmToScreen(viewport.height)
      );
      ctx.clip();

      // Calculate drawing transform to fit in viewport
      const drawingBounds = {
        minX: drawing.bounds.min.x,
        minY: drawing.bounds.min.y,
        maxX: drawing.bounds.max.x,
        maxY: drawing.bounds.max.y,
      };

      // Flips, cache read and the axis-corrected transform all come from the
      // ONE resolver the print/export path also calls (`resolveSheetTransform`)
      // — so preview and print cannot derive any of the three separately.
      // The cached entry is validated against the CURRENT sheet's own
      // geometry key AND the current section axis inside the resolver (the
      // transform carries the axis's flips), not trusted because it's present:
      // `useViewControls`'s effect that nulls this ref on a geometry change
      // runs in the SAME commit as this drawing effect, but as the PARENT
      // hook its effect commits AFTER this (child) effect — so on the very
      // render the sheet's geometry changes, a stale (still non-null) cached
      // entry would otherwise be reused for one frame, and nothing forces a
      // second draw to correct it (PR #2853 review).
      const resolved = resolveSheetTransform({
        sheet: activeSheet,
        drawingBounds,
        axis: sectionAxis,
        isPinned: Boolean(isPinned),
        cached: cachedSheetTransformRef?.current,
      });
      const { flipX, flipY } = resolved;
      const drawingTransform = resolved.transform;

      // The PREVIEW owns the cache: it is the only path that writes. Export
      // reads through the same resolver but never writes, so printing can
      // never perturb the placement on screen.
      if (!resolved.fromCache && cachedSheetTransformRef) {
        cachedSheetTransformRef.current = { ...drawingTransform, key: resolved.key };
      }

      // Apply combined transform: sheet mm -> screen, then drawing coords -> sheet mm
      // Drawing coord (meters) * scaleFactor = sheet mm, + translateX/Y
      // Then sheet mm -> screen via mmToScreenX/Y
      const drawModelContent = () => {
        // Determine flip behavior based on section axis
        // - 'down' (plan view): DON'T flip Y so north (Z+) is up
        // - 'front' and 'side': flip Y so height (Y+) is up
        // - 'side': also flip X to look from conventional direction

        // For each polygon/line, transform from model coords to screen coords
        const modelToScreen = (x: number, y: number) => {
          // Apply axis-specific flipping
          const adjustedX = flipX ? -x : x;
          const adjustedY = flipY ? -y : y;
          // Model to sheet mm
          const sheetX = adjustedX * drawingTransform.scaleFactor + drawingTransform.translateX;
          const sheetY = adjustedY * drawingTransform.scaleFactor + drawingTransform.translateY;
          // Sheet mm to screen
          return { x: mmToScreenX(sheetX), y: mmToScreenY(sheetY) };
        };

        drawReferenceImages(ctx, referenceImages, modelToScreen);

        // DXF reference underlays render first, beneath the cut geometry
        // (issue #1782). Data is pre-mapped drawing space and exists only
        // for plan ('down') sections, where the sheet mapping has no
        // axis flips — so the plain drawing→paper transform applies.
        drawDxfUnderlaysScreenSpace(
          ctx,
          dxfUnderlays,
          (x, y) => {
            const sheetX = x * drawingTransform.scaleFactor + drawingTransform.translateX;
            const sheetY = y * drawingTransform.scaleFactor + drawingTransform.translateY;
            return { x: mmToScreenX(sheetX), y: mmToScreenY(sheetY) };
          },
          (mm) => Math.max(0.5, mmToScreen(mm) * 0.3),
          (worldHeight) => worldHeight * drawingTransform.scaleFactor * transform.scale,
        );

        // Surface fills sit beneath the cut and its outlines.
        if (fillPreview?.resolve) drawPublicationSurfaces(ctx, drawing.projectionPolygons ?? [], fillPreview.resolve,
          modelToScreen, Math.abs(drawingTransform.scaleFactor * transform.scale), transform.scale);
        for (const polygon of drawing.cutPolygons) {
          const { fillColor, opacity } = cutFill(polygon);
          const paints = fillPreview?.resolve?.(polygon, fillColor);
          if (paints) {
            drawPublicationCanvasFills(ctx, polygon, paints, modelToScreen,
              Math.abs(drawingTransform.scaleFactor * transform.scale), transform.scale);
            continue;
          }
        ctx.globalAlpha = opacity;
          ctx.fillStyle = fillColor;
          ctx.beginPath();

          if (polygon.polygon.outer.length > 0) {
            const first = modelToScreen(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < polygon.polygon.outer.length; i++) {
              const pt = modelToScreen(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();

            for (const hole of polygon.polygon.holes) {
              if (hole.length > 0) {
                const holeFirst = modelToScreen(hole[0].x, hole[0].y);
                ctx.moveTo(holeFirst.x, holeFirst.y);
                for (let i = 1; i < hole.length; i++) {
                  const pt = modelToScreen(hole[i].x, hole[i].y);
                  ctx.lineTo(pt.x, pt.y);
                }
                ctx.closePath();
              }
            }
          }
          ctx.fill('evenodd');
          ctx.globalAlpha = 1;
        }

        // Draw lines (projection, silhouette, etc.)
        const lineBounds = drawing.bounds;
        const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
        const lineMinX = lineBounds.min.x - lineMargin;
        const lineMaxX = lineBounds.max.x + lineMargin;
        const lineMinY = lineBounds.min.y - lineMargin;
        const lineMaxY = lineBounds.max.y + lineMargin;

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const line of strokeLines) {
          if (!showHiddenLines && isOccludedDrawingLine(line)) continue;

          const { start, end } = line.line;
          if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;
          if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
            end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) continue;

          let strokeColor = '#000000';
          let lineWidth = 0.25;
          let dashPattern: number[] = [];

          switch (line.category) {
            case 'cut': lineWidth = 0.5; break;
            case 'projection': lineWidth = 0.25; break;
            case 'hidden': lineWidth = 0.18; strokeColor = '#666666'; dashPattern = [4, 2]; break;
            case 'silhouette': lineWidth = 0.35; break;
            case 'crease': lineWidth = 0.18; break;
            case 'boundary': lineWidth = 0.25; break;
            case 'annotation': lineWidth = 0.13; break;
          }

          if (line.visibility === 'hidden') {
            strokeColor = '#888888';
            dashPattern = [4, 2];
            lineWidth *= 0.7;
          }

          const stroke = pen?.(line, line.category === 'cut' ? 'cut' : 'projection', line);
          if (stroke && !(stroke.lineWeight > 0)) continue;
          ctx.strokeStyle = stroke?.color ?? strokeColor;
          ctx.lineWidth = stroke ? mmToScreen(stroke.lineWeight) : Math.max(0.5, mmToScreen(lineWidth) * 0.3);
          ctx.setLineDash(stroke?.dash?.map(d => mmToScreen(d)) ?? dashPattern);

          const screenStart = modelToScreen(start.x, start.y);
          const screenEnd = modelToScreen(end.x, end.y);

          ctx.beginPath();
          ctx.moveTo(screenStart.x, screenStart.y);
          ctx.lineTo(screenEnd.x, screenEnd.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Stroke cut polygon outlines above projection lines.
        for (const polygon of drawing.cutPolygons) {
          const stroke = pen?.(polygon, 'cut');
          let strokeColor = '#000000';
          let lineWeight = 0.5;

          if (!stroke && overridesEnabled) {
            const elementData: ElementData = {
              expressId: polygon.entityId,
              ifcType: polygon.ifcType, properties: getElementProperties(polygon.entityId),
            };
            const result = overrideEngine.applyOverrides(elementData);
            strokeColor = result.style.strokeColor;
            lineWeight = result.style.lineWeight;
          }

          if (stroke && !(stroke.lineWeight > 0)) continue;
          ctx.strokeStyle = stroke?.color ?? strokeColor;
          ctx.lineWidth = stroke ? mmToScreen(stroke.lineWeight) : Math.max(0.5, mmToScreen(lineWeight) * 0.3);
          ctx.setLineDash(stroke?.dash?.map(d => mmToScreen(d)) ?? []);
          ctx.beginPath();

          if (polygon.cutOutline) {
            for (const { start, end } of polygon.cutOutline) {
              const a = modelToScreen(start.x, start.y), b = modelToScreen(end.x, end.y);
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
            }
          } else if (polygon.polygon.outer.length > 0) {
            const first = modelToScreen(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < polygon.polygon.outer.length; i++) {
              const pt = modelToScreen(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();

            for (const hole of polygon.polygon.holes) {
              if (hole.length > 0) {
                const holeFirst = modelToScreen(hole[0].x, hole[0].y);
                ctx.moveTo(holeFirst.x, holeFirst.y);
                for (let i = 1; i < hole.length; i++) {
                  const pt = modelToScreen(hole[i].x, hole[i].y);
                  ctx.lineTo(pt.x, pt.y);
                }
                ctx.closePath();
              }
            }
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // IFC annotation overlay (issue #812)
        drawIfcAnnotationsScreenSpace(
          ctx,
          ifcAnnotationLines,
          ifcAnnotationTexts,
          ifcAnnotationFills,
          modelToScreen,
          (mm) => Math.max(0.5, mmToScreen(mm) * 0.3),
          (worldHeight) => Math.max(8, worldHeight * drawingTransform.scaleFactor * transform.scale),
        );

        // Point-cloud scan overlay (issue #1805) — drawn last, on top of the
        // cut geometry. `scanPoints` are already in the same drawing space
        // as `cutPolygons`/`lines`, so the same `modelToScreen` applies.
        drawScanSectionScreenSpace(ctx, scanPoints, modelToScreen, scanOpacity, scanOutline);
      };

      drawModelContent();
      ctx.restore();

      // ─────────────────────────────────────────────────────────────────────
      // 6. Draw scale bar at BOTTOM LEFT of title block
      // Uses actual drawingTransform.scaleFactor which accounts for dynamic scaling
      // ─────────────────────────────────────────────────────────────────────
      // The scale bar is sized by two loops, and BOTH can fail to terminate:
      //
      //   while (sbLengthMm > maxBarWidth && targetLengthM > 0.5)   // halving
      //     targetLengthM = targetLengthM / 2;
      //   while (sbLengthMm < maxBarWidth * 0.3 && targetLengthM < 100)  // doubling
      //     targetLengthM = targetLengthM * 2;
      //
      // They wedge on different inputs, which is why the guard needs three
      // clauses and not one. Measured against the real component, each one a
      // render that had to be killed by the test runner's timeout:
      //
      //     totalLengthM=0         doubling loop   0 * 2 is 0, forever
      //     totalLengthM=-1        doubling loop   halves toward -Infinity,
      //                                            which stays < 100
      //     totalLengthM=Infinity  HALVING loop    Infinity / 2 is Infinity
      //     scaleFactor=NaN        terminates
      //     scaleFactor=0          terminates
      //
      // The Infinity case is the one I missed first time round, because I
      // reasoned about the doubling loop the bug report named and never looked
      // at the one above it. `Infinity > 0` passes a positivity check, so a
      // guard without `Number.isFinite` reads as complete and is not.
      //
      // title-block-renderer.ts:410 already had this exactly right, and says so:
      // "Checked BEFORE the clamp, and the ordering is load-bearing: testing
      // the clamped result loses the infinite case". This is the canvas
      // catching up with the exporter, which is also why `calculateOptimal-
      // ScaleBarLength` is left alone: it returns 0 for "no usable bar" and the
      // exporter already declines to draw that. The canvas was the half not
      // holding up its end.
      //
      // The two scaleFactor clauses do a different job. Neither prevents a
      // hang; they stop a bar being drawn with a `NaNm` label when
      // `actualTotalLength` comes out 0/0.
      //
      // Guards only the scale bar: the north arrow is drawn after this block in
      // the same function, so an early return would silently drop it. That was
      // my first attempt.
      if (
        scaleBar.visible &&
        tbH > 10 &&
        scaleBar.totalLengthM > 0 &&
        Number.isFinite(scaleBar.totalLengthM) &&
        Number.isFinite(drawingTransform.scaleFactor) &&
        drawingTransform.scaleFactor > 0
      ) {
        // Position: bottom left with small margin
        const sbX = tbX + 3;
        const sbY = tbY + tbH - 8; // 8mm from bottom (leaves room for label)

        // Calculate effective scale from the actual drawing transform
        // scaleFactor = mm per meter, so effective scale ratio = 1000 / scaleFactor
        const effectiveScaleFactor = drawingTransform.scaleFactor;

        // Scale bar length: we want to show a nice round number of meters
        // Calculate how many mm on paper for the desired real-world length
        const maxBarWidth = Math.min(tbW * 0.3, 50); // Max 30% of width or 50mm

        // Find a nice round length that fits
        // Start with the configured length and adjust if needed
        let targetLengthM = scaleBar.totalLengthM;
        let sbLengthMm = targetLengthM * effectiveScaleFactor;

        // If bar would be too long, reduce the target length
        while (sbLengthMm > maxBarWidth && targetLengthM > 0.5) {
          targetLengthM = targetLengthM / 2;
          sbLengthMm = targetLengthM * effectiveScaleFactor;
        }

        // If bar would be too short, increase the target length
        while (sbLengthMm < maxBarWidth * 0.3 && targetLengthM < 100) {
          targetLengthM = targetLengthM * 2;
          sbLengthMm = targetLengthM * effectiveScaleFactor;
        }

        // Clamp to max width
        sbLengthMm = Math.min(sbLengthMm, maxBarWidth);

        // Actual length represented by the bar
        const actualTotalLength = sbLengthMm / effectiveScaleFactor;

        const sbHeight = Math.min(scaleBar.heightMm, 3);

        // Scale bar divisions
        const divisions = scaleBar.primaryDivisions;
        const divWidth = sbLengthMm / divisions;
        for (let i = 0; i < divisions; i++) {
          ctx.fillStyle = i % 2 === 0 ? scaleBar.fillColor : '#ffffff';
          ctx.fillRect(
            mmToScreenX(sbX + i * divWidth),
            mmToScreenY(sbY),
            mmToScreen(divWidth),
            mmToScreen(sbHeight)
          );
        }

        // Scale bar border
        ctx.strokeStyle = scaleBar.strokeColor;
        ctx.lineWidth = Math.max(1, mmToScreen(scaleBar.lineWeight));
        ctx.strokeRect(
          mmToScreenX(sbX),
          mmToScreenY(sbY),
          mmToScreen(sbLengthMm),
          mmToScreen(sbHeight)
        );

        // Distance labels - only at 0 and end
        const labelFontSize = Math.max(7, mmToScreen(1.8));
        ctx.font = `${labelFontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.textBaseline = 'top';
        const labelScreenY = mmToScreenY(sbY + sbHeight) + 1;

        ctx.textAlign = 'left';
        ctx.fillText('0', mmToScreenX(sbX), labelScreenY);

        ctx.textAlign = 'right';
        const endLabel = actualTotalLength < 1
          ? `${(actualTotalLength * 100).toFixed(0)}cm`
          : `${actualTotalLength.toFixed(0)}m`;
        ctx.fillText(endLabel, mmToScreenX(sbX + sbLengthMm), labelScreenY);
      }

      // ─────────────────────────────────────────────────────────────────────
      // 7. Draw north arrow at BOTTOM RIGHT of title block
      // ─────────────────────────────────────────────────────────────────────
      if (northArrow.style !== 'none' && tbH > 10) {
        // Position: bottom right with margin
        const naSize = Math.min(northArrow.sizeMm, 8, tbH * 0.6);
        const naX = tbX + tbW - naSize - 5; // Right side with margin
        const naY = tbY + tbH - naSize / 2 - 3; // Bottom with margin

        ctx.save();
        ctx.translate(mmToScreenX(naX), mmToScreenY(naY));
        ctx.rotate((northArrow.rotation * Math.PI) / 180);

        // Draw arrow
        const arrowLen = mmToScreen(naSize);
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.moveTo(0, -arrowLen / 2);
        ctx.lineTo(-arrowLen / 6, arrowLen / 2);
        ctx.lineTo(0, arrowLen / 3);
        ctx.lineTo(arrowLen / 6, arrowLen / 2);
        ctx.closePath();
        ctx.fill();

        // Draw "N" label
        const nFontSize = Math.max(8, mmToScreen(2.5));
        ctx.font = `bold ${nFontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('N', 0, -arrowLen / 2 - 1);

        ctx.restore();
      }

    } else {
      // ═══════════════════════════════════════════════════════════════════════
      // NON-SHEET MODE: Original rendering (drawing coords -> screen)
      // ═══════════════════════════════════════════════════════════════════════

      // Apply transform with axis-specific flipping
      // - 'down' (plan view): DON'T flip Y so north (Z+) is up
      // - 'front' and 'side': flip Y so height (Y+) is up
      // - 'side': also flip X to look from conventional direction
      const scaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const scaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;
      const penMm = printPreview ? (publicationScale || 100) / 1000 : 1 / transform.scale;
      drawReferenceImages(ctx, referenceImages, (x, y) => ({ x: x * scaleX + transform.x, y: y * scaleY + transform.y }));

      // DXF reference underlays render first, beneath the cut geometry
      // (issue #1782). Data is pre-mapped drawing space and exists only
      // for plan ('down') sections, where the direct mapping has no axis
      // flips — so the plain drawing→screen transform applies. Drawn in
      // screen space (like the IFC annotation overlay) so stroke widths
      // and text stay in pixels.
      drawDxfUnderlaysScreenSpace(
        ctx,
        dxfUnderlays,
        (x, y) => ({ x: x * transform.scale + transform.x, y: y * transform.scale + transform.y }),
        (mm) => Math.max(0.5, mm * transform.scale * 0.3),
        (worldHeight) => worldHeight * transform.scale,
      );

      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(scaleX, scaleY);

      // ═══════════════════════════════════════════════════════════════════════
      // 1. FILL CUT POLYGONS (with color from IFC materials, override engine, or type fallback)
      // ═══════════════════════════════════════════════════════════════════════
      if (fillPreview?.resolve) drawPublicationSurfaces(ctx, drawing.projectionPolygons ?? [], fillPreview.resolve,
        (x, y) => ({ x, y }), 1, fillPreview.scale / 1000, Math.sign(scaleX * scaleY));
      for (const polygon of drawing.cutPolygons) {
        const { fillColor, opacity } = cutFill(polygon, paperTheme.isDark);
        const paints = fillPreview?.resolve?.(polygon, fillColor);
        if (paints) {
          drawPublicationCanvasFills(ctx, polygon, paints, (x, y) => ({ x, y }),
            1, (fillPreview?.scale ?? 100) / 1000, Math.sign(scaleX * scaleY));
          continue;
        }
        ctx.globalAlpha = opacity;
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        if (polygon.polygon.outer.length > 0) {
          ctx.moveTo(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
          for (let i = 1; i < polygon.polygon.outer.length; i++) {
            ctx.lineTo(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
          }
          ctx.closePath();

          // Draw holes (inner boundaries)
          for (const hole of polygon.polygon.holes) {
            if (hole.length > 0) {
              ctx.moveTo(hole[0].x, hole[0].y);
              for (let i = 1; i < hole.length; i++) {
                ctx.lineTo(hole[i].x, hole[i].y);
              }
              ctx.closePath();
            }
          }
        }
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 2. DRAW PROJECTION, SYMBOLS AND OPEN CUT LINES
      // ═══════════════════════════════════════════════════════════════════════
      // Pre-compute bounds for line validation
      const lineBounds = drawing.bounds;
      const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
      const lineMinX = lineBounds.min.x - lineMargin;
      const lineMaxX = lineBounds.max.x + lineMargin;
      const lineMinY = lineBounds.min.y - lineMargin;
      const lineMaxY = lineBounds.max.y + lineMargin;

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const line of strokeLines) {
        // Skip hidden lines if not showing
        if (!showHiddenLines && isOccludedDrawingLine(line)) continue;

        // Skip lines with invalid coordinates (NaN, Infinity, or far outside bounds)
        const { start, end } = line.line;
        if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
          continue;
        }
        if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
          end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) {
          continue;
        }

        // Set line style based on category. Ink follows the paper (#5496):
        // direct mode only, sheet mode above stays black-on-white.
        let strokeColor = paperTheme.ink;
        let lineWidth = 0.25;
        let dashPattern: number[] = [];

        switch (line.category) {
          case 'cut': lineWidth = 0.5; break;
          case 'projection':
            lineWidth = 0.25;
            strokeColor = paperTheme.ink;
            break;
          case 'hidden':
            lineWidth = 0.18;
            strokeColor = '#666666';
            dashPattern = [2, 1];
            break;
          case 'silhouette':
            lineWidth = 0.35;
            strokeColor = paperTheme.ink;
            break;
          case 'crease':
            lineWidth = 0.18;
            strokeColor = paperTheme.ink;
            break;
          case 'boundary':
            lineWidth = 0.25;
            strokeColor = paperTheme.ink;
            break;
          case 'annotation':
            lineWidth = 0.13;
            strokeColor = paperTheme.ink;
            break;
        }

        // Hidden visibility overrides
        if (line.visibility === 'hidden') {
          strokeColor = '#888888';
          dashPattern = [2, 1];
          lineWidth *= 0.7;
        }

        const stroke = pen?.(line, line.category === 'cut' ? 'cut' : 'projection', line);
        if (stroke && !(stroke.lineWeight > 0)) continue;
        ctx.strokeStyle = stroke?.color ?? strokeColor;
        ctx.lineWidth = stroke ? stroke.lineWeight * penMm : lineWidth / transform.scale;
        ctx.setLineDash(stroke?.dash?.map(d => d * penMm) ?? dashPattern.map(d => d / transform.scale));

        ctx.beginPath();
        ctx.moveTo(line.line.start.x, line.line.start.y);
        ctx.lineTo(line.line.end.x, line.line.end.y);
        ctx.stroke();

        ctx.setLineDash([]);
      }

      // Stroke cut polygon outlines above projection lines.
      for (const polygon of drawing.cutPolygons) {
        const stroke = pen?.(polygon, 'cut');
        let strokeColor = paperTheme.ink;
        let lineWeight = 0.5;

        if (!stroke && overridesEnabled) {
          const elementData: ElementData = {
            expressId: polygon.entityId,
            ifcType: polygon.ifcType, properties: getElementProperties(polygon.entityId),
          };
          const result = overrideEngine.applyOverrides(elementData);
          strokeColor = result.style.strokeColor;
          lineWeight = result.style.lineWeight;
        }

        if (stroke && !(stroke.lineWeight > 0)) continue;
        ctx.strokeStyle = stroke?.color ?? strokeColor;
        ctx.lineWidth = stroke ? stroke.lineWeight * penMm : lineWeight / transform.scale;
        ctx.setLineDash(stroke?.dash?.map(d => d * penMm) ?? []);
        ctx.beginPath();
        if (polygon.cutOutline) {
          for (const { start, end } of polygon.cutOutline) {
            const a = start, b = end;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
        } else if (polygon.polygon.outer.length > 0) {
          ctx.moveTo(polygon.polygon.outer[0].x, polygon.polygon.outer[0].y);
          for (let i = 1; i < polygon.polygon.outer.length; i++) {
            ctx.lineTo(polygon.polygon.outer[i].x, polygon.polygon.outer[i].y);
          }
          ctx.closePath();

          for (const hole of polygon.polygon.holes) {
            if (hole.length > 0) {
              ctx.moveTo(hole[0].x, hole[0].y);
              for (let i = 1; i < hole.length; i++) {
                ctx.lineTo(hole[i].x, hole[i].y);
              }
              ctx.closePath();
            }
          }
        }
        ctx.stroke();
      }

      ctx.restore();

      // IFC annotation overlay (issue #812). Rendered after ctx.restore so we
      // can size lines and text in screen pixels rather than fighting the
      // ctx.scale applied above (which would inverse-scale everything).
      const directScaleX = sectionAxis === 'side' ? -transform.scale : transform.scale;
      const directScaleY = sectionAxis === 'down' ? transform.scale : -transform.scale;
      drawIfcAnnotationsScreenSpace(
        ctx,
        ifcAnnotationLines,
        ifcAnnotationTexts,
        ifcAnnotationFills,
        (x, y) => ({ x: x * directScaleX + transform.x, y: y * directScaleY + transform.y }),
        // No paper scale here: take a baseline 0.3 px per "default mm" so
        // weights match the heavier projection lines visually. Annotation
        // strokes in IFC are intentionally lighter than projection lines,
        // but a hair too thin on a 1× screen disappears entirely.
        (mmWeight) => Math.max(0.5, mmWeight * transform.scale * 0.3),
        // World height directly to screen pixels through the active zoom.
        // 8 px floor so labels stay legible when zoomed way out.
        (worldHeight) => Math.max(8, worldHeight * transform.scale),
      );

      // Point-cloud scan overlay (issue #1805) — same drawing-space content
      // as `cutPolygons`/`lines`, so it uses the identical direct scale/
      // translate the main content used before `ctx.restore()`.
      drawScanSectionScreenSpace(
        ctx,
        scanPoints,
        (x, y) => ({ x: x * directScaleX + transform.x, y: y * directScaleY + transform.y }),
        scanOpacity,
        scanOutline,
      );
    }

    // Dimensions and annotations share the drawing-to-screen transform.
    const annotScaleX = sectionAxis === 'side' ? -markupTransform.scale : markupTransform.scale;
    const annotScaleY = sectionAxis === 'down' ? markupTransform.scale : -markupTransform.scale;
    const drawingToScreenX = (x: number) => x * annotScaleX + markupTransform.x;
    const drawingToScreenY = (y: number) => y * annotScaleY + markupTransform.y;
    const markupToScreen = (point: Point2D) => ({ x: drawingToScreenX(point.x), y: drawingToScreenY(point.y) });
    const paperUnit = activeSheet && sheetEnabled ? transform.scale : markupTransform.scale * (publicationScale || 100) / 1000;
    // The drawn text and its selection bounds must use identical font metrics.
    const measureTextAnnotation = (annotation: TextAnnotation2D) => {
      const layout = textAnnotationLayout(annotation, paperUnit, (line, font) => {
        ctx.font = font;
        return ctx.measureText(line).width;
      });
      ctx.font = layout.font;
      return layout;
    };
    const drawMeasureLine = (
      start: Point2D, end: Point2D, distance: number, fallback: string,
      placed?: Measure2DResultData['dimension'], isActive = false, id?: string,
    ) => {
      const style = !isActive ? resolveDimensionStyle(dimensionStyles, placed?.styleId, dimensionStyle) : dimensionStyle;
      const anchors = placed?.anchors;
      const dimension = styledDimension(markupToScreen(start), markupToScreen(end),
        anchors && [markupToScreen(anchors[0]), markupToScreen(anchors[1])], style, paperUnit,
        mapDimensionShape(placed?.shape, markupToScreen), lineweights);
      if (!dimension) return;
      ctx.save();
      ctx.strokeStyle = id && style.lineColor ? style.lineColor : fallback;
      ctx.lineWidth = dimension.lineWidth;
      ctx.setLineDash(isActive ? [6, 3] : []);
      drawDimensionStrokes(ctx, dimension);
      ctx.fillStyle = id && style.textColor ? style.textColor : fallback;
      ctx.font = `${dimension.textSize}px ${DIMENSION_FONTS[style.fontFamily]}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = formatDimensionLabel(distance, style, (value, precision, showUnit) =>
        formatDistance(value, unitDisplayOverrides, precision, showUnit), placed?.shape?.kind);
      const center = {
        x: dimension.label.x + (placed?.textOffset?.x ?? 0) * annotScaleX,
        y: dimension.label.y + (placed?.textOffset?.y ?? 0) * annotScaleY,
      };
      const angle = placed?.textAngle ?? 0;
      const labelSelected = id && selectedAnnotation?.id === id && selectedAnnotation?.dimensionLabel && dimensionLabelHits;
      const width = id && placed && dimensionLabelHits ? ctx.measureText(label).width + 4 : 0;
      const height = dimension.textSize + 4;
      if (id && placed && dimensionLabelHits) dimensionLabelHits.current.push({ id, center, width, height, angle });
      if (angle || labelSelected) {
        ctx.translate(center.x, center.y);
        ctx.rotate(angle * Math.PI / 180);
        ctx.fillText(label, 0, 0);
        if (labelSelected) {
          ctx.strokeStyle = getComputedStyle(canvas).color;
          ctx.lineWidth = 1;
          ctx.strokeRect(-width / 2, -height / 2, width, height);
        }
      } else {
        ctx.fillText(label, center.x, center.y);
      }
      ctx.restore();
    };

    for (const result of measureResults) {
      drawMeasureLine(result.start, result.end, result.distance, activeSheet && sheetEnabled ? '#000' : paperTheme.ink,
        result.dimension, false, result.id);
    }

    if (measureMode) {
      for (const segment of dimensionPreview) {
        drawMeasureLine(segment.start, segment.end, segment.distance, '#FF5722', { anchors: segment.anchors, shape: segment.shape, chainId: '' }, true);
      }
      ctx.fillStyle = '#FF5722';
      for (const point of dimensionPoints) {
        const screen = markupToScreen(point);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if ((measureMode || annotation2DActiveTool === 'polygon-area') && measureSnapPoint) {
      const screenSnap = markupToScreen(measureSnapPoint);
      // Draw snap crosshair
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 1.5;
      const snapSize = 12;

      ctx.beginPath();
      ctx.moveTo(screenSnap.x - snapSize, screenSnap.y);
      ctx.lineTo(screenSnap.x + snapSize, screenSnap.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(screenSnap.x, screenSnap.y - snapSize);
      ctx.lineTo(screenSnap.x, screenSnap.y + snapSize);
      ctx.stroke();

      // Draw snap circle
      ctx.beginPath();
      ctx.arc(screenSnap.x, screenSnap.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. RENDER POLYGON AREA MEASUREMENTS (in screen space)
    // ═══════════════════════════════════════════════════════════════════════
    // Draw completed polygon areas
    for (const result of polygonAreaResults) {
      if (result.points.length < 3) continue;

      // Draw filled polygon
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = result.appearance?.color ?? '#2196F3';
      ctx.beginPath();
      const first = result.points[0];
      ctx.moveTo(drawingToScreenX(first.x), drawingToScreenY(first.y));
      for (let i = 1; i < result.points.length; i++) {
        ctx.lineTo(drawingToScreenX(result.points[i].x), drawingToScreenY(result.points[i].y));
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw outline
      ctx.strokeStyle = result.appearance?.color ?? '#2196F3';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(drawingToScreenX(first.x), drawingToScreenY(first.y));
      for (let i = 1; i < result.points.length; i++) {
        ctx.lineTo(drawingToScreenX(result.points[i].x), drawingToScreenY(result.points[i].y));
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw vertex dots
      ctx.fillStyle = result.appearance?.color ?? '#2196F3';
      for (const pt of result.points) {
        ctx.beginPath();
        ctx.arc(drawingToScreenX(pt.x), drawingToScreenY(pt.y), 3, 0, Math.PI * 2);
        ctx.fill();
      }


    }

    // Draw in-progress polygon
    if (polygonAreaPoints.length > 0 && annotation2DActiveTool === 'polygon-area') {
      // Draw lines between placed vertices
      ctx.strokeStyle = '#FF5722';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      const first = polygonAreaPoints[0];
      ctx.moveTo(drawingToScreenX(first.x), drawingToScreenY(first.y));
      for (let i = 1; i < polygonAreaPoints.length; i++) {
        ctx.lineTo(drawingToScreenX(polygonAreaPoints[i].x), drawingToScreenY(polygonAreaPoints[i].y));
      }

      // Draw preview line from last vertex to cursor
      if (annotation2DCursorPos) {
        ctx.lineTo(drawingToScreenX(annotation2DCursorPos.x), drawingToScreenY(annotation2DCursorPos.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // If 3+ points and cursor is near first vertex, show closing preview
      if (polygonAreaPoints.length >= 3 && annotation2DCursorPos) {
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#FF5722';
        ctx.beginPath();
        ctx.moveTo(drawingToScreenX(first.x), drawingToScreenY(first.y));
        for (let i = 1; i < polygonAreaPoints.length; i++) {
          ctx.lineTo(drawingToScreenX(polygonAreaPoints[i].x), drawingToScreenY(polygonAreaPoints[i].y));
        }
        ctx.lineTo(drawingToScreenX(annotation2DCursorPos.x), drawingToScreenY(annotation2DCursorPos.y));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Draw vertex dots
      ctx.fillStyle = '#FF5722';
      for (const pt of polygonAreaPoints) {
        ctx.beginPath();
        ctx.arc(drawingToScreenX(pt.x), drawingToScreenY(pt.y), 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // First vertex indicator (larger, shows it can be clicked to close)
      if (polygonAreaPoints.length >= 3) {
        ctx.strokeStyle = '#FF5722';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(drawingToScreenX(first.x), drawingToScreenY(first.y), 8, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. RENDER TEXT ANNOTATIONS (in screen space)
    // ═══════════════════════════════════════════════════════════════════════
    for (const textAnnotation of textAnnotations) {
      // Don't render text that is currently being edited (the editor overlay handles it)
      if (textAnnotation.id === textAnnotationEditing) continue;
      if (!textAnnotation.text.trim()) continue;

      const sx = drawingToScreenX(textAnnotation.position.x);
      const sy = drawingToScreenY(textAnnotation.position.y);

      const { lines, lineHeight, padding, bgW, bgH } = measureTextAnnotation(textAnnotation);

      // Background
      ctx.fillStyle = textAnnotation.backgroundColor;
      ctx.fillRect(sx, sy, bgW, bgH);

      // Border
      ctx.strokeStyle = textAnnotation.borderColor;
      ctx.lineWidth = 0.15 * paperUnit; // same 0.15 mm stroke as PDF/SVG
      ctx.strokeRect(sx, sy, bgW, bgH);

      // Text
      ctx.fillStyle = textAnnotation.appearance?.color ?? textAnnotation.color;
      const align = textAnnotation.align ?? textAnnotation.appearance?.align ?? 'left';
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      const textX = align === 'center' ? sx + bgW / 2 : align === 'right' ? sx + bgW - padding : sx + padding;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], textX, sy + padding + i * lineHeight);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 7. RENDER CLOUD ANNOTATIONS (in screen space)
    // ═══════════════════════════════════════════════════════════════════════
    const screenScale = Math.abs(transform.scale);

    // Draw completed clouds
    for (const cloud of cloudAnnotations) {
      if (cloud.points.length < 2) continue;
      const p1 = cloud.points[0];
      const p2 = cloud.points[1];

      // Determine arc radius based on rectangle size (in drawing coords)
      const rectW = Math.abs(p2.x - p1.x);
      const rectH = Math.abs(p2.y - p1.y);
      const arcRadius = Math.min(rectW, rectH) * 0.15 || 0.2;

      const color = cloud.appearance?.color ?? cloud.color;

      // Draw cloud fill
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = color;
      drawCloudOnCanvas(ctx, p1, p2, arcRadius, drawingToScreenX, drawingToScreenY, screenScale);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Draw cloud stroke
      ctx.strokeStyle = color;
      ctx.lineWidth = cloud.appearance?.weight ? (lineweights?.[cloud.appearance.weight] ?? 0.25) * paperUnit : 2;
      drawCloudOnCanvas(ctx, p1, p2, arcRadius, drawingToScreenX, drawingToScreenY, screenScale);
      ctx.stroke();

      // Draw label at center
      if (cloud.label) {
        const labelX = drawingToScreenX((p1.x + p2.x) / 2);
        const labelY = drawingToScreenY((p1.y + p2.y) / 2);

        const size = 12;
        ctx.font = 'bold 12px system-ui, sans-serif';
        const labelMetrics = ctx.measureText(cloud.label);
        const lW = labelMetrics.width + 10;
        const lH = Math.max(20, size + 8);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(labelX - lW / 2, labelY - lH / 2, lW, lH);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(labelX - lW / 2, labelY - lH / 2, lW, lH);

        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cloud.label, labelX, labelY);
      }
    }

    // Draw in-progress cloud (rectangle preview from first corner to cursor)
    if (cloudAnnotationPoints.length === 1 && annotation2DCursorPos && annotation2DActiveTool === 'cloud') {
      const p1 = cloudAnnotationPoints[0];
      const p2 = annotation2DCursorPos;

      const sx1 = drawingToScreenX(p1.x);
      const sy1 = drawingToScreenY(p1.y);
      const sx2 = drawingToScreenX(p2.x);
      const sy2 = drawingToScreenY(p2.y);

      ctx.strokeStyle = '#E53935';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(
        Math.min(sx1, sx2), Math.min(sy1, sy2),
        Math.abs(sx2 - sx1), Math.abs(sy2 - sy1)
      );
      ctx.setLineDash([]);
    }

    // 8. RENDER SELECTION HIGHLIGHT
    // ═══════════════════════════════════════════════════════════════════════
    // Hover and selection share the same geometry and differ only in intensity.
    const primaryColor = getComputedStyle(canvas).color;
    const highlightAnnotation = (target: SelectedAnnotation2D, opacity: number) => {
      ctx.save();
      ctx.globalAlpha = opacity;
      const SEL_COLOR = primaryColor;

      switch (target.type) {
        case 'measure': {
          // Hover the full dimension even when the hit is on its editable label.
          // Preserve the label-only selection state for label manipulation.
          if (target.dimensionLabel && opacity === 1) break;
          const result = measureResults.find((r) => r.id === target.id);
          if (result) {
            const chainId = result.dimension?.chainId;
            if (!chainId) {
              drawMeasureLine(result.start, result.end, result.distance, SEL_COLOR, result.dimension);
              break;
            }
            for (const segment of measureResults) {
              if (segment.dimension?.chainId === chainId) {
                drawMeasureLine(segment.start, segment.end, segment.distance, SEL_COLOR, segment.dimension);
              }
            }
          }
          break;
        }
        case 'polygon': {
          const result = polygonAreaResults.find((r) => r.id === target.id);
          if (result && result.points.length >= 3) {
            ctx.save();
            ctx.beginPath();
            result.points.forEach((point, index) => {
              const sx = drawingToScreenX(point.x), sy = drawingToScreenY(point.y);
              if (index === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.closePath();
            ctx.fillStyle = SEL_COLOR;
            ctx.globalAlpha = opacity * 0.18;
            ctx.fill();
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = SEL_COLOR;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([]);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case 'text': {
          const annotation = textAnnotations.find((a) => a.id === target.id);
          if (annotation && annotation.id !== textAnnotationEditing && annotation.text.trim()) {
            const sx = drawingToScreenX(annotation.position.x);
            const sy = drawingToScreenY(annotation.position.y);
            const { bgW, bgH } = measureTextAnnotation(annotation);
            ctx.save();
            ctx.strokeStyle = SEL_COLOR;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.strokeRect(sx, sy, bgW, bgH);
            ctx.restore();
          }
          break;
        }
        case 'cloud': {
          const cloud = cloudAnnotations.find((a) => a.id === target.id);
          if (cloud && cloud.points.length >= 2) {
            const [p1, p2] = cloud.points;
            const arcRadius = Math.min(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y)) * 0.15 || 0.2;
            ctx.save();
            ctx.strokeStyle = SEL_COLOR;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            drawCloudOnCanvas(ctx, p1, p2, arcRadius, drawingToScreenX, drawingToScreenY, screenScale);
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
      }
      ctx.restore();
    };
    if (hoveredAnnotation && hoveredAnnotation.id !== selectedAnnotation?.id
      && !windowAnnotations?.some(item => item.id === hoveredAnnotation.id && item.type === hoveredAnnotation.type)) highlightAnnotation(hoveredAnnotation, 0.55);
    if (selectedAnnotation) highlightAnnotation(selectedAnnotation, 1);
    windowAnnotations?.forEach(item => highlightAnnotation(item, 1));
    markActiveDrawingCanvasRendered(canvas, snapshotSourceDrawing, textAnnotationEditing === null);
  }, [referenceImages, drawing, strokeLines, snapshotSourceDrawing, transform, showHiddenLines, canvasSize, overrideEngine, overridesEnabled, getElementProperties, entityColorMap, useIfcMaterials, fillPreview, lineweights, printPreview, measureMode, markupTransform, dimensionStyle, dimensionStyles, dimensionLabelHits, publicationScale, dimensionPreview, dimensionPoints, measureResults, measureSnapPoint, sheetEnabled, activeSheet, sectionAxis, isPinned, annotation2DActiveTool, annotation2DCursorPos, polygonAreaPoints, polygonAreaResults, textAnnotations, textAnnotationEditing, cloudAnnotationPoints, cloudAnnotations, selectedAnnotation, hoveredAnnotation, windowAnnotations, ifcAnnotationLines, ifcAnnotationTexts, ifcAnnotationFills, dxfUnderlays, scanPoints, scanOpacity, scanOutline, unitDisplayOverrides, paperTheme]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full text-primary"
      style={CANVAS_STYLE}
    />
  );
}
