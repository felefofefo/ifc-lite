/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useDrawingPatterns } from './useDrawingPatterns';
import { useCallback } from 'react';
import { buildDxfUnderlaySvg, drawDxfUnderlaysPdf, mappedDxfUnderlayOptions } from '@/lib/export/drawing-vector-underlays';
import { drawingReferenceSvg, snapshotDrawingReferences, rasterizeReferenceLayer } from '@/lib/export/drawing-raster-references';
import type React from 'react';
import { posthog, trackExportCompleted } from '@/lib/analytics';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import { toast } from '@/components/ui/toast';
import { useTranslation } from '@/i18n';
import { recordActivity } from '@/lib/activity/activity-journal';
import { pdfLineStyleFor } from '@/lib/export/pdf-line-style';
import {
  isOccludedDrawingLine,
  GraphicOverrideEngine,
  renderFrame,
  renderTitleBlock,
  exportToDXF,
  formatScaleFactorLabel,
  makeEntityKey, isPolygonCutLine,
  fitRasterPixels,
  type RasterFit, type Drawing2D, type DrawingSheet, type TitleBlockExtras, type PdfScaleLayout,
} from '@ifc-lite/drawing-2d';
import { axisFlipForSection, computePdfSectionLayout, makeSectionMapPoint } from '@/hooks/pdfSectionLayout';
import { resolveSheetTransform } from '@/lib/drawing/sheet-transform';
import type { CachedSheetTransform } from '@/lib/drawing/sheet-geometry-key';
import { dimensionArc, mapDimensionShape } from '@/lib/drawing/dimension-line';
import { DEFAULT_DIMENSION_STYLE, DIMENSION_FONTS, formatDimensionLabel, resolveDimensionStyle, styledDimension, type DimensionStyle } from '@/lib/drawing/dimension-style';
import { formatDistance } from '@/components/viewer/tools/formatDistance';
import { formatArea, computePolygonCentroid } from '@/components/viewer/tools/computePolygonArea';
import { generateCloudSVGPath } from '@/components/viewer/tools/cloudPathGenerator';
import type { Measure2DResult, PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';
import type { DxfUnderlayRenderData } from '@/hooks/useDxfUnderlay';
import type { GeometryResult } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import { resolveEntityRef, useViewerStore } from '@/store';
import { buildDxfExportTransform, resolveDxfExportGeoreference } from '@/hooks/dxfExportGeoref';
import { lineweightsAtScale, type LineweightRow, type LineweightTable } from '@/lib/drawing/lineweight-table';
import type { DistantElements } from '@/lib/drawing/distant-elements';
import { drawingPublicationStrokeStyle } from './drawingPublicationStrokeStyle';
import { drawingPublicationHatchStyle } from './drawingPublicationHatchStyle';
import type { MaterialHatches } from '@/lib/drawing/material-hatches';
import { downloadDxf } from '@/hooks/dxfDownload';
import { DEFAULT_SCAN_SVG_CAP, type ScanBandPoint } from '@/hooks/scanSectionMath';
import { computeSvgExportViewport, svgExportMmToWorld } from '@/hooks/svgExportViewport';
import { makePropertiesGetter } from '@/hooks/drawingElementProperties';
import { resolveCutPolygonStyle, type CutPolygonStyleContext } from '@/components/viewer/drawing/cut-polygon-style';
import { publicationCutSvg, svgDash } from '@/lib/export/drawing-publication-svg';
import { pdfColor } from '@/lib/export/pdf-color';
import { drawingAnnotationDxf } from '@/lib/export/drawing-annotation-dxf';
import { drawDrawingAnnotationsPdf, expandDrawingAnnotationBounds } from '@/lib/export/drawing-annotation-pdf';
import { drawCutPolygonsPdf, isPagePoint, prepareCutPolygonsPdf, type PdfCutPolygon } from '@/lib/export/section-pdf-cut-polygons';
import { viewMarkersSvg, viewMarkersDxf, drawViewMarkersPdf, viewMarkerExportBounds, useDrawingViewMarkers } from '@/lib/export/drawing-view-markers';
import { titleBlockWithEffectiveScale } from '@/hooks/titleBlockScaleField';
import { scanOutlineDxfLayers, type ScanOutlineLayer } from '@/lib/scan-outline/scan-outline';

function tryDrawingSvg(generate: () => string | null): string | null {
  try { return generate(); }
  catch (error) { toast.error(error instanceof Error ? error.message : String(error)); return null; }
}

/**
 * Render the point-cloud scan overlay as SVG circles (issue #1805), capped
 * hard at `DEFAULT_SCAN_SVG_CAP` (independent of, and typically tighter
 * than, the on-screen render cap) so an exported file stays a sane size —
 * a deterministic stride, same technique `selectScanBand` uses for the
 * render cap, keeps the exported subset reproducible.
 */
function buildScanSectionSvg(
  points: readonly ScanBandPoint[],
  mapPoint: (x: number, y: number) => { x: number; y: number },
  radiusModelUnits: number,
  opacity: number,
  cap: number = DEFAULT_SCAN_SVG_CAP,
): string {
  if (points.length === 0 || opacity <= 0) return '';
  const stride = points.length > cap ? Math.ceil(points.length / cap) : 1;
  let svg = `  <g id="scan-section" opacity="${opacity.toFixed(2)}">\n`;
  for (let i = 0; i < points.length; i += stride) {
    const p = mapPoint(points[i].point.x, points[i].point.y);
    const color = points[i].color;
    const fill = color
      ? `#${color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : '#8a8a8a';
    svg += `    <circle cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="${radiusModelUnits.toFixed(4)}" fill="${fill}" stroke="none"/>\n`;
  }
  svg += '  </g>\n';
  return svg;
}

/**
 * Dots per inch of paper the sheet raster is built at.
 *
 * Fixed, with no UI control anywhere: `handleExportPDF` is a single toolbar
 * action. That is why the ceiling below CAPS rather than REFUSES — a refusal
 * would have no setting to send the user to, and the sheet's paper size is
 * the deliverable, not a preference.
 */
export const SHEET_PDF_DPI = 300;

/**
 * Pixel budget for one sheet raster, taken from WebKit's own canvas cap
 * rather than picked as a round number: `CanvasBase::maxCanvasArea()`
 * (Source/WebCore/html/CanvasBase.cpp) returns `8192 * 8192` on the iOS
 * family and `16384 * 16384` elsewhere. The lower of the two is the one that
 * has to hold, because a canvas over the cap does not report itself:
 * `CanvasBase::validateArea()` logs a console warning and returns false, the
 * canvas gets no backing store, `getContext('2d')` still returns a live
 * context, the paint calls become no-ops, and `toDataURL()` then returns the
 * literal string `"data:,"` — `encodeDataURL(RefPtr<ImageBuffer>&&)` in
 * Source/WebCore/platform/graphics/ImageUtilities.cpp returns `"data:,"_s`
 * for a null buffer. Nothing throws at any point.
 *
 * At {@link SHEET_PDF_DPI} that cap binds from ANSI D upwards. The papers
 * that need it are the big ones — ARCH E is 14400 x 10800 = 155,520,000 px
 * and A0 is 14043 x 9933 = 139,489,119 px, both far past even the desktop
 * cap's memory cost (155.5 Mpx x 4 bytes = 622 MB for the bitmap alone).
 *
 * NOT verified in any real browser. The value and the failure mode are read
 * off WebKit's source; Chrome's and Firefox's caps differ and are not
 * modelled, and Safari's separate TOTAL canvas-memory limit is a second
 * ceiling this budget cannot rule out — which is why the raster result is
 * validated below as well as sized.
 */
export const MAX_SHEET_RASTER_PIXELS = 8192 * 8192;

/**
 * Per-side cap: the side length WebKit's non-iOS area cap is expressed as,
 * and the same number `@ifc-lite/drawing-2d` already uses for the 3D-view
 * PDF's shaded underlay (`MAX_SHADING_DIMENSION_PX`). No registry paper
 * reaches it at {@link SHEET_PDF_DPI} (ARCH E's long side is 14400 px); it
 * exists for a custom paper size, which `DrawingSheet.paper` permits.
 */
export const MAX_SHEET_RASTER_DIMENSION_PX = 16_384;

/** A raster, plus what it cost to fit it inside the budget. */
interface SheetRaster {
  dataUrl: string;
  fit: RasterFit;
}

/**
 * Rasterize an SVG string to a PNG data URL, sized to exactly `widthMm` x
 * `heightMm` on paper (issues #2941/#2942). The sheet frame, title block and
 * scale bar only exist inside `generateSheetSVG` — SVG, Print and the
 * DXF-underlay path all render that exact string and the reporter confirmed
 * those are correct. Rather than re-deriving a second, independent sheet
 * layout for jsPDF's vector primitives (the "v1" PDF path below did exactly
 * that and dropped the frame/scale bar entirely, and used
 * `displayOptions.scale` instead of the sheet's own scale), rasterize the
 * SAME svg the working exporters use so the PDF cannot drift from them.
 *
 * The pixel grid comes from `fitRasterPixels`, the same helper the 3D-view
 * PDF's shaded underlay uses, so the two raster paths cannot drift into two
 * different cap policies. It scales BOTH sides by one factor, so a capped
 * sheet is blurrier and never mis-scaled: the caller still places the image
 * across the full paper rectangle in millimetres, never at `px / dpi`.
 *
 * `fit.capped` is returned rather than swallowed. A user who asked for a
 * 300 dpi sheet and silently got 104 is the same defect as a blank page, one
 * step quieter.
 */
function rasterizeSvgToPngDataUrl(
  svgString: string,
  widthMm: number,
  heightMm: number,
  dpi = SHEET_PDF_DPI,
): Promise<SheetRaster> {
  return new Promise((resolve, reject) => {
    const fit = fitRasterPixels(
      widthMm,
      heightMm,
      dpi,
      MAX_SHEET_RASTER_PIXELS,
      MAX_SHEET_RASTER_DIMENSION_PX,
    );
    const { widthPx, heightPx } = fit;

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        // The sheet SVG already paints its own white background rect, but a
        // canvas starts transparent — belt-and-braces against a transparent
        // PDF page if that rect is ever clipped away.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, widthPx, heightPx);
        ctx.drawImage(img, 0, 0, widthPx, heightPx);

        const dataUrl = canvas.toDataURL('image/png');
        // The pixel budget above is necessary, not sufficient. Safari
        // enforces a separate TOTAL canvas-memory limit, and any browser can
        // fail a 100+ MB allocation on a low-memory device; in both cases the
        // buffer is simply absent and this comes back as `"data:,"` with no
        // exception raised. Handing that to `jsPDF.addImage` produces a
        // decoder complaint about a PNG signature, which tells the user
        // nothing they can act on — and if a browser ever returned a valid
        // all-white PNG instead, the export would "succeed" with a blank
        // page. Refuse the result here, naming the way out.
        if (!dataUrl.startsWith('data:image/png')) {
          throw new Error(
            `the browser returned an empty ${widthPx}x${heightPx} px canvas for this ` +
            `${Math.round(widthMm)}x${Math.round(heightMm)} mm sheet. Try a smaller paper ` +
            `size, or use the SVG export, which is vector and has no pixel limit.`,
          );
        }
        resolve({ dataUrl, fit });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to rasterize sheet SVG'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load sheet SVG for PDF export'));
    };
    img.src = url;
  });
}

interface UseDrawingExportParams {
  drawing: Drawing2D | null;
  displayOptions: {
    showHiddenLines: boolean;
    showAnnotations?: boolean;
    distantElements?: DistantElements;
    showHatching?: boolean;
    scale: number;
    showScanSection: boolean;
    scanSectionOpacity: number;
    scanSectionIncludeInExport: boolean;
  };
  sectionPlane: { axis: 'down' | 'front' | 'side'; position: number; flipped: boolean; custom?: unknown };
  activePresetId: string | null;
  entityColorMap: Map<number, [number, number, number, number]>;
  overridesEnabled: boolean;
  overrideEngine: GraphicOverrideEngine;
  lineweights?: LineweightRow;
  lineweightTable?: LineweightTable;
  materialHatches?: MaterialHatches;
  dimensionStyle?: DimensionStyle;
  dimensionStyles?: ReadonlyMap<string, DimensionStyle>;
  measure2DResults: Measure2DResult[];
  polygonArea2DResults: PolygonArea2DResult[];
  elementTags?: readonly ResolvedDrawingTag[];
  textAnnotations2D: TextAnnotation2D[];
  cloudAnnotations2D: CloudAnnotation2D[];
  sheetEnabled: boolean;
  activeSheet: DrawingSheet | null;
  /** DXF underlays pre-mapped to drawing space, rendered beneath the drawing (issue #1782) */
  dxfUnderlays: readonly DxfUnderlayRenderData[];
  /** Legacy single-model data store — the anchor-selection fallback for the DXF georeference lookup (issue #1861); federated models come from the store's `models` map. */
  ifcDataStore: IfcDataStore | null;
  /** Geometry coordinate info (RTC offset + origin shift), for the DXF world-coordinate re-derivation (issue #1861). */
  coordinateInfo: GeometryResult['coordinateInfo'] | undefined;
  /** Point-cloud scan overlay, already in drawing space (issue #1805), and its traced outline (#6871) */
  scanSection: { points: readonly ScanBandPoint[]; outline?: ScanOutlineLayer | null };
  /** Pin View state, shared with the preview canvas. While pinned the sheet
   *  placement is HELD across a regenerate; print/export must honour the same
   *  held placement or it silently prints a different layout from the one on
   *  screen (see `resolveSheetTransform`). */
  isPinned?: boolean;
  /** The preview's pinned-transform cache. Read-only here — the preview owns
   *  the write, so exporting never perturbs what is on screen. */
  cachedSheetTransformRef?: React.MutableRefObject<CachedSheetTransform | null>;
}

interface UseDrawingExportResult {
  formatDistance: (distance: number) => string;
  handleExportSVG: () => void;
  handleExportDXF: () => void;
  buildSVG: () => string | null;
  buildDXF: () => { dxf: string; stem: string; isGeoreferenced: boolean } | undefined;
  /**
   * Export the section as a true-vector PDF at an exact scale (issue #2042).
   * `scaleFactor` is the "N" in "1:N" (e.g. 100 for 1:100); omit to use the
   * drawing's current on-screen scale ("as displayed").
   */
  handleExportPDF: (scaleFactor?: number, destination?: (blob: Blob) => void) => Promise<void>;
  handlePrint: () => void;
}

import { addDrawingTagsDxf, drawDrawingTagsPdf, drawingTagsSvg, tagExportBounds,
  type ResolvedDrawingTag } from '@/lib/drawing/drawing-element-tags';

function useDrawingExport({
  drawing,
  displayOptions,
  sectionPlane,
  activePresetId,
  entityColorMap,
  overridesEnabled,
  overrideEngine,
  lineweights, lineweightTable, materialHatches,
  dimensionStyle = DEFAULT_DIMENSION_STYLE,
  dimensionStyles,
  measure2DResults,
  polygonArea2DResults,
  elementTags = [],
  textAnnotations2D,
  cloudAnnotations2D,
  sheetEnabled,
  activeSheet,
  dxfUnderlays,
  ifcDataStore,
  coordinateInfo,
  scanSection,
  isPinned = false,
  cachedSheetTransformRef,
}: UseDrawingExportParams): UseDrawingExportResult {
  const { t } = useTranslation();
  const { patterns } = useDrawingPatterns();
  const viewMarkers = useDrawingViewMarkers(drawing, coordinateInfo?.shiftedBounds, sectionPlane.axis, !!sectionPlane.custom);
  const markers = displayOptions.showAnnotations ? viewMarkers : [];
  // Georef inputs for the DXF export (PR #1871 review, P1): placement edits
  // applied in CesiumPlacementEditor live in `georefMutations` (per model
  // id), not in `ifcDataStore`, and in a federation the georef frame is the
  // ANCHOR model's, not necessarily the legacy store's. Subscribe to the
  // same store fields ViewportContainer's Cesium georef memo reads so
  // `resolveDxfExportGeoreference` sees the identical inputs.
  const storeModels = useViewerStore((s) => s.models);
  const anchorModelIdOverride = useViewerStore((s) => s.anchorModelIdOverride);
  const georefMutations = useViewerStore((s) => s.georefMutations);
  // Georef edits replace the map, but subscribe to mutationVersion too so the
  // dependency is explicit (matches ViewportContainer / useAnchorGeoreference).
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  // One properties cache per export, shared by every cut polygon it styles.
  const cutPolygonStyleContext = useCallback((scale = displayOptions.scale): CutPolygonStyleContext => {
    const row = lineweightTable ? lineweightsAtScale(lineweightTable, scale) : lineweights;
    const context: CutPolygonStyleContext = {
      useIfcMaterials: (activePresetId === null || activePresetId === 'preset-3d-colors' || activePresetId?.startsWith('drawing-template:') === true), entityColorMap, overridesEnabled,
      overrideEngine: row ? new GraphicOverrideEngine(overrideEngine.getRules(), row) : overrideEngine,
      getElementProperties: makePropertiesGetter(storeModels, ifcDataStore),
    };
    if (row) {
      context.stroke = drawingPublicationStrokeStyle(row, context, displayOptions.distantElements);
      context.fills = displayOptions.showHatching === false ? () => [] : drawingPublicationHatchStyle(
        materialHatches, scale, storeModels, ifcDataStore,
        overridesEnabled ? context.overrideEngine.getRules() : [], context.getElementProperties, resolveEntityRef, patterns, displayOptions.distantElements, row);
    }
    return context;
  }, [activePresetId, entityColorMap, overridesEnabled, overrideEngine, storeModels, ifcDataStore,
    lineweights, lineweightTable, materialHatches, displayOptions.scale, displayOptions.showHatching, patterns, displayOptions.distantElements]);

  const dimensionItems = useCallback(() => {
    const units = useViewerStore.getState().unitDisplayOverrides;
    return measure2DResults.map(result => {
      const style = resolveDimensionStyle(dimensionStyles, result.dimension?.styleId, dimensionStyle);
      const label = formatDimensionLabel(result.distance, style, (value, precision, showUnit) =>
        formatDistance(value, units, precision, showUnit), result.dimension?.shape?.kind);
      return { ...result, style, label };
    });
  }, [dimensionStyle, dimensionStyles, measure2DResults]);

  const dimensionGraphics = useCallback((map: (x: number, y: number) => { x: number; y: number }, paperUnit: number, scale: number) => {
    const row = lineweightsAtScale(lineweightTable ?? {}, scale);
    const point = (p: { x: number; y: number }) => map(p.x, p.y);
    const origin = map(0, 0);
    return dimensionItems().flatMap(({ start, end, label, style, dimension: placed }) => {
      const anchors = placed?.anchors;
      const graphic = styledDimension(point(start), point(end), anchors && [point(anchors[0]), point(anchors[1])],
        style, paperUnit, mapDimensionShape(placed?.shape, point), row);
      if (!graphic) return [];
      const offset = placed?.textOffset ? point(placed.textOffset) : origin;
      const position = { x: graphic.label.x + offset.x - origin.x, y: graphic.label.y + offset.y - origin.y };
      const font = 'fontFamily' in style && typeof style.fontFamily === 'string' ? style.fontFamily : 'Arial, sans-serif';
      return [{ graphic, position, label, style, font, angle: placed?.textAngle ?? 0 }];
    });
  }, [dimensionItems, lineweightTable]);

  const dimensionsSvg = useCallback((map: Parameters<typeof dimensionGraphics>[0], unit: number, scale: number,
    escape: (text: string) => string) => {
    const items = dimensionGraphics(map, unit, scale);
    if (!items.length) return '';
    const markup = items.map(({ graphic, position: { x, y }, label, style, font, angle }) => {
      const ink = style.lineColor ?? '#000';
      const textInk = style.textColor ?? '#000';
      const strokes = graphic.strokes.map(([a, b]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
      const triangles = graphic.triangles.map(points => `<polygon points="${points.map(p => `${p.x},${p.y}`).join(' ')}" stroke="none" fill="${ink}"/>`);
      const circles = graphic.circles.map(({ center, radius, filled }) => `<circle cx="${center.x}" cy="${center.y}" r="${radius}" fill="${filled ? ink : 'none'}"/>`);
      return `<g stroke="${ink}" stroke-width="${graphic.lineWidth}" fill="none">${[...strokes, ...triangles, ...circles].join('')}</g>` +
        `<text x="${x}" y="${y}" transform="rotate(${angle} ${x} ${y})" text-anchor="middle" dominant-baseline="middle" font-family="${escape(font)}" font-size="${graphic.textSize}" fill="${textInk}">${escape(label)}</text>`;
    });
    return `<g id="measurements">${markup.join('')}</g>`;
  }, [dimensionGraphics]);

  const expandDimensionBounds = useCallback((bounds: Drawing2D['bounds'], scale: number) => {
    const result = { min: { ...bounds.min }, max: { ...bounds.max } };
    for (const { start, end, label, style, dimension: placed } of dimensionItems()) {
      const { textMm, tickMm, labelGapMm, extensionMm } = style;
      const margin = svgExportMmToWorld(Math.max(tickMm, extensionMm, labelGapMm) + textMm * (label.length / 2 + 1), scale);
      const marginX = margin + Math.abs(placed?.textOffset?.x ?? 0);
      const marginY = margin + Math.abs(placed?.textOffset?.y ?? 0);
      const shape = placed?.shape;
      const points = shape?.kind === 'angular' ? dimensionArc(start, end, shape.center, shape.label)
        : shape ? [start, end, shape.label] : [start, end];
      for (const { x, y } of [...points, ...(placed?.anchors ?? [])]) {
        result.min.x = Math.min(result.min.x, x - marginX);
        result.min.y = Math.min(result.min.y, y - marginY);
        result.max.x = Math.max(result.max.x, x + marginX);
        result.max.y = Math.max(result.max.y, y + marginY);
      }
    }
    return result;
  }, [dimensionItems]);

  // The same annotation geometry is written into direct SVG and sheet SVG;
  // sheet PDF rasterizes the latter, so it inherits the same markup.
  const markupSvg = useCallback((
    mapPoint: (x: number, y: number) => { x: number; y: number },
    mmToTarget: (mm: number) => number,
    scale: number,
    escapeXml: (value: string) => string,
  ): string => {
    let svg = '';
    // 5. DRAW POLYGON AREA MEASUREMENTS
    if (polygonArea2DResults.length > 0) {
      svg += '  <g id="polygon-area-measurements">\n';
      for (const result of polygonArea2DResults) {
        if (result.points.length < 3) continue;
        const pointsStr = result.points.map(p => {
          const pt = mapPoint(p.x, p.y);
          return `${pt.x.toFixed(4)},${pt.y.toFixed(4)}`;
        }).join(' ');

        const measureColor = result.appearance?.color ?? '#2196F3';
        const lineWidth = mmToTarget(0.3);

        svg += `    <polygon points="${pointsStr}" fill="${escapeXml(measureColor)}" fill-opacity="0.1" stroke="${escapeXml(measureColor)}" stroke-width="${lineWidth.toFixed(4)}" stroke-dasharray="${mmToTarget(1).toFixed(4)} ${mmToTarget(0.5).toFixed(4)}"/>\n`;

        // Label at centroid
        const centroid = computePolygonCentroid(result.points);
        const ct = mapPoint(centroid.x, centroid.y);
        const areaText = formatArea(result.area);
        const fontSize = mmToTarget(result.appearance?.textHeight ?? 3);

        svg += `    <text x="${ct.x.toFixed(4)}" y="${ct.y.toFixed(4)}" font-family="${escapeXml(result.appearance?.font ?? 'Arial, sans-serif')}" font-size="${fontSize.toFixed(4)}" fill="#000000" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${escapeXml(areaText)}</text>\n`;
      }
      svg += '  </g>\n';
    }

    // 6. DRAW TEXT ANNOTATIONS
    if (textAnnotations2D.length > 0) {
      svg += '  <g id="text-annotations">\n';
      for (const annotation of textAnnotations2D) {
        if (!annotation.text.trim()) continue;
        const pt = mapPoint(annotation.position.x, annotation.position.y);
        const fontSize = mmToTarget(annotation.appearance?.textHeight ?? 2.5);
        const padding = mmToTarget(1);
        const lines = annotation.text.split('\n');
        const lineHeight = fontSize * 1.3;
        const approxWidth = Math.max(...lines.map(l => l.length * fontSize * 0.6)) + padding * 2;
        const height = lines.length * lineHeight + padding * 2;
        const align = annotation.align ?? annotation.appearance?.align ?? 'left';
        const textAnchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
        const textX = align === 'center' ? pt.x + approxWidth / 2 : align === 'right' ? pt.x + approxWidth - padding : pt.x + padding;
        const fontWeight = (annotation.bold ?? annotation.appearance?.bold) ? ' font-weight="bold"' : '';
        const fontStyle = (annotation.italic ?? annotation.appearance?.italic) ? ' font-style="italic"' : '';

        svg += `    <rect x="${pt.x.toFixed(4)}" y="${pt.y.toFixed(4)}" width="${approxWidth.toFixed(4)}" height="${height.toFixed(4)}" fill="${escapeXml(annotation.backgroundColor)}" stroke="${escapeXml(annotation.borderColor)}" stroke-width="${mmToTarget(0.15).toFixed(4)}"/>\n`;
        for (let i = 0; i < lines.length; i++) {
          svg += `    <text x="${textX.toFixed(4)}" y="${(pt.y + padding + fontSize * 0.8 + i * lineHeight).toFixed(4)}" font-family="${escapeXml(annotation.appearance?.font ?? 'Arial, sans-serif')}" font-size="${fontSize.toFixed(4)}" fill="${escapeXml(annotation.appearance?.color ?? annotation.color)}" text-anchor="${textAnchor}"${fontWeight}${fontStyle}>${escapeXml(lines[i])}</text>\n`;
        }
      }
      svg += '  </g>\n';
    }

    // 7. DRAW CLOUD ANNOTATIONS
    if (cloudAnnotations2D.length > 0) {
      svg += '  <g id="cloud-annotations">\n';
      for (const cloud of cloudAnnotations2D) {
        if (cloud.points.length < 2) continue;
        const color = cloud.appearance?.color ?? cloud.color;
        const rectW = Math.abs(cloud.points[1].x - cloud.points[0].x);
        const rectH = Math.abs(cloud.points[1].y - cloud.points[0].y);
        const arcRadius = Math.min(rectW, rectH) * 0.15 || 0.2;

        const transformX = (x: number) => mapPoint(x, 0).x;
        const transformY = (y: number) => mapPoint(0, y).y;
        const pathData = generateCloudSVGPath(cloud.points[0], cloud.points[1], arcRadius, transformX, transformY);
        const lineWidth = mmToTarget(cloud.appearance?.weight ? (lineweightsAtScale(lineweightTable ?? {}, scale))[cloud.appearance.weight] : 0.4);

        svg += `    <path d="${pathData}" fill="${escapeXml(color)}" fill-opacity="0.05" stroke="${escapeXml(color)}" stroke-width="${lineWidth.toFixed(4)}"/>\n`;

        if (cloud.label) {
          const cx = transformX((cloud.points[0].x + cloud.points[1].x) / 2);
          const cy = transformY((cloud.points[0].y + cloud.points[1].y) / 2);
          const fontSize = mmToTarget(3);
          svg += `    <text x="${cx.toFixed(4)}" y="${cy.toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="${escapeXml(color)}" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${escapeXml(cloud.label)}</text>\n`;
        }
      }
      svg += '  </g>\n';
    }

    return svg;
  }, [polygonArea2DResults, textAnnotations2D, cloudAnnotations2D, lineweightTable]);

  // Generate SVG that matches the canvas rendering exactly
  const generateExportSVG = useCallback((): string | null => {
    if (!drawing) return null;

    const bounds = expandDimensionBounds(tagExportBounds(viewMarkerExportBounds(drawing.bounds, markers, displayOptions.scale), elementTags, displayOptions.scale), displayOptions.scale || 100);

    // World-metres -> paper-mm arithmetic for the direct SVG export,
    // extracted to svgExportViewport.ts (see that file's docstring for why
    // this transform doesn't map points at all — the SVG's own
    // width/height-vs-viewBox ratio does the scaling).
    const viewport = computeSvgExportViewport(bounds, displayOptions.scale, sectionPlane.axis);
    const { widthMm: svgWidthMm, heightMm: svgHeightMm, viewBoxMinX, viewBoxMinY, viewBoxWidth: viewWidth, viewBoxHeight: viewHeight, flipX, flipY, effectiveScale } = viewport;

    // Convert mm on paper to model units (meters)
    // At 1:100 scale, 1mm on paper = 0.1m in model space
    // Formula: modelUnits = paperMm * scale / 1000
    const mmToModel = (mm: number) => svgExportMmToWorld(mm, effectiveScale);
    const styleContext = cutPolygonStyleContext(effectiveScale);

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // flipX/flipY (axis-specific, matching canvas rendering) come from
    // `viewport` above — computeSvgExportViewport resolves the same
    // 'down'/'front'/'side' rule this hook used to compute inline.

    // Helper to get polygon path with axis-specific coordinate transformation
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      const transformPt = (x: number, y: number) => ({
        x: flipX ? -x : x,
        y: flipY ? -y : y,
      });

      let path = '';
      if (polygon.outer.length > 0) {
        const first = transformPt(polygon.outer[0].x, polygon.outer[0].y);
        path += `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          const pt = transformPt(polygon.outer[i].x, polygon.outer[i].y);
          path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          const holeFirst = transformPt(hole[0].x, hole[0].y);
          path += ` M ${holeFirst.x.toFixed(4)} ${holeFirst.y.toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            const pt = transformPt(hole[i].x, hole[i].y);
            path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    // Start building SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgWidthMm.toFixed(2)}mm"
     height="${svgHeightMm.toFixed(2)}mm"
     viewBox="${viewBoxMinX.toFixed(4)} ${viewBoxMinY.toFixed(4)} ${viewWidth.toFixed(4)} ${viewHeight.toFixed(4)}">
  <rect x="${viewBoxMinX.toFixed(4)}" y="${viewBoxMinY.toFixed(4)}" width="${viewWidth.toFixed(4)}" height="${viewHeight.toFixed(4)}" fill="#FFFFFF"/>
`;

    const mapUnderlay = (x: number, y: number) => ({ x: flipX ? -x : x, y: flipY ? -y : y });
    svg += drawingReferenceSvg(useViewerStore.getState(), drawing.config.plane, mapUnderlay);
    // Shared drawing-space geometry; apply the same final axis mapping as IFC.
    svg += buildDxfUnderlaySvg(
      dxfUnderlays,
      mapUnderlay,
      mmToModel,
      1, // text height is already in model units (metres)
      escapeXml,
    );

    svg += publicationCutSvg([...(drawing.projectionPolygons ?? []), ...drawing.cutPolygons], styleContext, (p) => polygonToPath(p.polygon), escapeXml, effectiveScale, mmToModel, 1, mapUnderlay);

    // 3. DRAW PROJECTION/SILHOUETTE LINES
    // Pre-compute bounds for line validation
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    svg += '  <g id="drawing-lines" stroke-linejoin="round" stroke-linecap="round">\n';
    for (const line of drawing.lines) {
      if (isPolygonCutLine(line)) continue;

      // Skip hidden lines if not showing
      if (!displayOptions.showHiddenLines && isOccludedDrawingLine(line)) continue;

      // Skip lines with invalid coordinates
      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
        continue;
      }
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
        end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) {
        continue;
      }

      // Set line style based on category
      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashArray = '';

      switch (line.category) {
        case 'cut': lineWidth = 0.5; break;
        case 'projection':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'hidden':
          lineWidth = 0.18;
          strokeColor = '#666666';
          dashArray = '2 1';
          break;
        case 'silhouette':
          lineWidth = 0.35;
          strokeColor = '#000000';
          break;
        case 'crease':
          lineWidth = 0.18;
          strokeColor = '#000000';
          break;
        case 'boundary':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'annotation':
          lineWidth = 0.13;
          strokeColor = '#000000';
          break;
      }

      // Hidden visibility overrides
      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashArray = '2 1';
        lineWidth *= 0.7;
      }

      // Convert line width from mm on paper to model units
      const pen = styleContext.stroke?.(line, line.category === 'cut' ? 'cut' : 'projection', line);
      if (pen) strokeColor = escapeXml(pen.color);
      const svgLineWidth = mmToModel(pen?.lineWeight ?? lineWidth);
      const dashAttr = svgDash(pen ? pen.dash : dashArray ? dashArray.split(' ').map(Number) : [], mmToModel);

      // Transform line endpoints with axis-specific flipping
      const startT = { x: flipX ? -start.x : start.x, y: flipY ? -start.y : start.y };
      const endT = { x: flipX ? -end.x : end.x, y: flipY ? -end.y : end.y };
      svg += `    <line x1="${startT.x.toFixed(4)}" y1="${startT.y.toFixed(4)}" x2="${endT.x.toFixed(4)}" y2="${endT.y.toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '  </g>\n';

    svg += dimensionsSvg(mapUnderlay, mmToModel(1), effectiveScale, escapeXml);

    svg += markupSvg(mapUnderlay, mmToModel, effectiveScale, escapeXml);

    // POINT-CLOUD SCAN OVERLAY (issue #1805) — on top, same drawing-space
    // content as cutPolygons/lines, so it needs the same flipX/flipY the
    // rest of this direct export applies via `transformPt`.
    if (displayOptions.showScanSection && displayOptions.scanSectionIncludeInExport) {
      svg += buildScanSectionSvg(
        scanSection.points,
        (x, y) => ({ x: flipX ? -x : x, y: flipY ? -y : y }),
        mmToModel(0.3),
        displayOptions.scanSectionOpacity,
      );
    }

    svg += drawingTagsSvg(elementTags, mapUnderlay, mmToModel(1), escapeXml);
    svg += viewMarkersSvg(markers, mapUnderlay, mmToModel(1), mmToModel(1), escapeXml, lineweightsAtScale(lineweightTable ?? {}, displayOptions.scale));
    svg += '</svg>';
    return svg;
  }, [drawing, displayOptions, cutPolygonStyleContext, expandDimensionBounds, dimensionsSvg, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D, sectionPlane.axis, dxfUnderlays, scanSection, markers, elementTags, lineweightTable]);

  // Generate SVG with drawing sheet (frame, title block, scale bar)
  // This generates coordinates directly in paper mm space (like the canvas rendering)
  const generateSheetSVG = useCallback((usePinned = isPinned): string | null => {
    if (!drawing || !activeSheet) return null;

    const { bounds } = drawing;
    const styleContext = cutPolygonStyleContext(activeSheet.scale.factor);

    // Sheet dimensions in mm
    const paperWidth = activeSheet.paper.widthMm;
    const paperHeight = activeSheet.paper.heightMm;
    const viewport = activeSheet.viewportBounds;

    // Flips, cache read and the axis-corrected transform all come from the
    // ONE resolver the preview canvas (`Drawing2DCanvas.tsx`) also calls, so
    // print/export cannot derive any of the three separately (#2940: print
    // used the raw, always-Y-flip-assuming transform, which only matched the
    // preview for axes that flip Y and left plan ('down') sections off-centre
    // on paper; and print recomputed from current bounds while a PINNED
    // preview held a cached placement).
    //
    // Read-only on the cache by construction: `resolveSheetTransform` never
    // writes, and this path does not write either — printing must not move
    // what is on screen.
    const resolved = resolveSheetTransform({
      sheet: activeSheet,
      drawingBounds: { minX: bounds.min.x, minY: bounds.min.y, maxX: bounds.max.x, maxY: bounds.max.y },
      axis: sectionPlane.axis,
      isPinned: usePinned,
      cached: cachedSheetTransformRef?.current,
    });
    const { flipX, flipY } = resolved;
    const { translateX, translateY, scaleFactor } = resolved.transform;

    // Helper: convert model coordinates to paper mm (matching canvas rendering exactly)
    const modelToPaper = (x: number, y: number): { x: number; y: number } => {
      const adjustedX = flipX ? -x : x;
      const adjustedY = flipY ? -y : y;
      return {
        x: adjustedX * scaleFactor + translateX,
        y: adjustedY * scaleFactor + translateY,
      };
    };

    // Start building SVG (paper coordinates in mm)
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${paperWidth}mm"
     height="${paperHeight}mm"
     viewBox="0 0 ${paperWidth} ${paperHeight}">
  <!-- Background -->
  <rect x="0" y="0" width="${paperWidth}" height="${paperHeight}" fill="#FFFFFF"/>

`;

    // Create clipping path for viewport FIRST (so it can be used by drawing content)
    svg += `  <defs>
    <clipPath id="viewport-clip">
      <rect x="${viewport.x.toFixed(2)}" y="${viewport.y.toFixed(2)}" width="${viewport.width.toFixed(2)}" height="${viewport.height.toFixed(2)}"/>
    </clipPath>
  </defs>

`;

    // Drawing content FIRST (so frame/title block render on top)
    svg += `  <g id="drawing-content" clip-path="url(#viewport-clip)">
`;

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Helper to get polygon path in paper coordinates
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      let path = '';
      if (polygon.outer.length > 0) {
        const first = modelToPaper(polygon.outer[0].x, polygon.outer[0].y);
        path += `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          const pt = modelToPaper(polygon.outer[i].x, polygon.outer[i].y);
          path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          const holeFirst = modelToPaper(hole[0].x, hole[0].y);
          path += ` M ${holeFirst.x.toFixed(4)} ${holeFirst.y.toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            const pt = modelToPaper(hole[i].x, hole[i].y);
            path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    svg += drawingReferenceSvg(useViewerStore.getState(), drawing.config.plane, modelToPaper);
    svg += buildDxfUnderlaySvg(
      dxfUnderlays,
      modelToPaper,
      (mm) => mm, // CAD lineweights are paper millimetres, as in raw SVG/PDF.
      scaleFactor, // metres -> mm on paper
      escapeXml,
    );

    svg += publicationCutSvg([...(drawing.projectionPolygons ?? []), ...drawing.cutPolygons], styleContext, (p) => polygonToPath(p.polygon), escapeXml, activeSheet.scale.factor, (mm) => mm, 0.3, modelToPaper);

    // Render drawing lines
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    svg += '    <g id="drawing-lines" stroke-linejoin="round" stroke-linecap="round">\n';
    for (const line of drawing.lines) {
      if (isPolygonCutLine(line)) continue;
      if (!displayOptions.showHiddenLines && isOccludedDrawingLine(line)) continue;

      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
        end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) continue;

      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashArray = '';

      switch (line.category) {
        case 'cut': lineWidth = 0.5; break;
        case 'projection': lineWidth = 0.25; break;
        case 'hidden': lineWidth = 0.18; strokeColor = '#666666'; dashArray = '1 0.5'; break;
        case 'silhouette': lineWidth = 0.35; break;
        case 'crease': lineWidth = 0.18; break;
        case 'boundary': lineWidth = 0.25; break;
        case 'annotation': lineWidth = 0.13; break;
      }

      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashArray = '1 0.5';
        lineWidth *= 0.7;
      }

      const paperStart = modelToPaper(start.x, start.y);
      const paperEnd = modelToPaper(end.x, end.y);

      // lineWidth is in mm on paper
      const pen = styleContext.stroke?.(line, line.category === 'cut' ? 'cut' : 'projection', line);
      if (pen) strokeColor = escapeXml(pen.color);
      const svgLineWidth = pen?.lineWeight ?? lineWidth * 0.3;
      const dashAttr = pen ? svgDash(pen.dash, (mm) => mm) : dashArray ? ` stroke-dasharray="${dashArray}"` : '';
      svg += `      <line x1="${paperStart.x.toFixed(4)}" y1="${paperStart.y.toFixed(4)}" x2="${paperEnd.x.toFixed(4)}" y2="${paperEnd.y.toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '    </g>\n';

    // POINT-CLOUD SCAN OVERLAY (issue #1805) — on top, inside the clipped
    // drawing-content group like everything else. `modelToPaper` already
    // applies the same flip + scale/translate the rest of the sheet uses.
    if (displayOptions.showScanSection && displayOptions.scanSectionIncludeInExport) {
      svg += buildScanSectionSvg(
        scanSection.points,
        modelToPaper,
        0.3, // mm on paper
        displayOptions.scanSectionOpacity,
      );
    }

    svg += dimensionsSvg(modelToPaper, 1, activeSheet.scale.factor, escapeXml);
    svg += markupSvg(modelToPaper, (mm) => mm, activeSheet.scale.factor, escapeXml);
    svg += drawingTagsSvg(elementTags, modelToPaper, 1, escapeXml);
    svg += viewMarkersSvg(markers, modelToPaper, 1 / Math.abs(scaleFactor), 1, escapeXml, lineweightsAtScale(lineweightTable ?? {}, activeSheet.scale.factor));
    svg += '  </g>\n\n';

    // Render frame (on top of drawing content)
    const frameResult = renderFrame(activeSheet.paper, activeSheet.frame);
    svg += frameResult.svgElements;
    svg += '\n';

    // Render title block with scale bar and north arrow inside
    // Pass effectiveScaleFactor from the actual transform (not just configured scale)
    // This ensures scale bar shows correct values when dynamically scaled
    const titleBlockExtras: TitleBlockExtras = {
      scaleBar: activeSheet.scaleBar,
      northArrow: activeSheet.northArrow,
      scale: activeSheet.scale,
      effectiveScaleFactor: scaleFactor,
    };
    // Correct the "Scale" field for a viewport-fit-clamped sheet (#2131's
    // defect class; see titleBlockScaleField.ts).
    const titleBlockResult = renderTitleBlock(
      titleBlockWithEffectiveScale(activeSheet.titleBlock, activeSheet.scale.factor, scaleFactor),
      frameResult.innerBounds,
      activeSheet.revisions,
      titleBlockExtras
    );
    svg += titleBlockResult.svgElements;
    svg += '\n';

    svg += '</svg>';
    return svg;
    // `sectionPlane.axis` and `isPinned` are read INSIDE this callback (via
    // `resolveSheetTransform`) and so must be here. Both were previously
    // held up only by invariants elsewhere — `drawing` happens to change
    // identity when the axis changes, and the canvas rewrote the cache on
    // every fresh draw — neither of which this callback controls.
    // `cachedSheetTransformRef` is a ref: stable identity, read at call time.
  }, [drawing, activeSheet, displayOptions, cutPolygonStyleContext, dxfUnderlays, scanSection, sectionPlane.axis, isPinned, markers, dimensionsSvg, markupSvg, elementTags, lineweightTable]);
  const buildSVG = useCallback(() => sheetEnabled && activeSheet ? generateSheetSVG(false) : generateExportSVG(),
    [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet]);
  const handleExportSVG = useCallback(() => {
    // Use sheet export if enabled, otherwise raw drawing export
    const svg = tryDrawingSvg(() => (sheetEnabled && activeSheet) ? generateSheetSVG() : generateExportSVG());
    if (!svg) return;
    const stem = (sheetEnabled && activeSheet)
      ? `${sanitizeFilename(activeSheet.name, { fallback: 'sheet' })}-${sectionPlane.axis}-${sectionPlane.position}`
      : `section-${sectionPlane.axis}-${sectionPlane.position}`;
    downloadFile(svg, `${stem}.svg`, 'image/svg+xml');
    trackExportCompleted({ format: 'svg', surface: 'drawing_panel' });
    posthog.capture('drawing_exported', { format: 'svg', axis: sectionPlane.axis, sheet_enabled: sheetEnabled });
  }, [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet, sectionPlane]);
  // Export DXF (issue #1861). Unlike SVG, DXF has no paper space, so this
  // always exports the raw model-space drawing (sheet frame/title block are
  // not represented) — real-world metres, with a plan ('down') section
  // re-georeferenced to true IFC world coordinates (and further to
  // map/CRS coordinates when the model has an IfcMapConversion). DXF
  // reference vectors are embedded from the same mapped drawing geometry.
  // The point-cloud scan overlay (issue #1805) is likewise deliberately
  // excluded: it is a raster-like screen aid (tens of thousands of circles),
  // not vector content — SVG export carries it (opt-in) instead.
  const buildDXF = useCallback(() => {
    if (!drawing) return;
    const isCustomPlane = sectionPlane.custom !== undefined;
    // Anchor-model effective georef, INCLUDING user placement edits
    // (georefMutations) — see resolveDxfExportGeoreference's docs. The
    // drawing-frame `coordinateInfo` below is unrelated: it undoes the
    // render-frame shift and stays the merged drawing's regardless of which
    // model anchors the georef.
    const georeference = resolveDxfExportGeoreference({
      models: storeModels,
      legacyDataStore: ifcDataStore,
      legacyCoordinateInfo: coordinateInfo,
      anchorModelIdOverride,
      georefMutations,
    });
    const coordinateTransform = buildDxfExportTransform({
      coordinateInfo,
      sectionAxis: sectionPlane.axis,
      isCustomPlane,
      flipped: sectionPlane.flipped,
      georeference,
    });
    const isGeoreferenced = georeference !== null && sectionPlane.axis === 'down' && !isCustomPlane;
    // Keep the target CRS in the file comment for map-projected exports.
    const metadataComment = isGeoreferenced
      ? `ifc-lite section export - units: metres, CRS: ${georeference!.projectedCRS.name || 'unknown'}`
      : undefined;
    const scale = sheetEnabled && activeSheet ? activeSheet.scale.factor : displayOptions.scale;
    const styleContext = cutPolygonStyleContext(scale);
    const stroke = styleContext.stroke;
    const overlays = viewMarkersDxf(markers, scale, displayOptions.showScanSection ? scanOutlineDxfLayers(scanSection.outline) : []);
    const { flipX, flipY } = axisFlipForSection(sectionPlane.axis);
    const paperPoint = (x: number, y: number) => ({ x: flipX ? -x : x, y: flipY ? -y : y });
    const fromPaper = (point: { x: number; y: number }) => paperPoint(point.x, point.y);
    const annotations = dimensionGraphics(paperPoint, scale / 1000, scale);
    const markups = drawingAnnotationDxf(
      displayOptions.showAnnotations === false ? [] : polygonArea2DResults,
      displayOptions.showAnnotations === false ? [] : textAnnotations2D,
      displayOptions.showAnnotations === false ? [] : cloudAnnotations2D, scale, lineweightTable,
    );
    const dxf = exportToDXF(drawing, addDrawingTagsDxf({
      objectStyles: !!stroke,
      strokeStyle: stroke ? (element, role, line) => {
        const pen = stroke(element, role, line);
        return { ...pen, dash: pen.dash?.map((mm) => mm * scale / 1000) };
      } : undefined,
      hatchLayers: stroke ? (polygon) => {
        const style = resolveCutPolygonStyle(polygon, styleContext);
        return style.fills ?? (style.fillOpacity > 0
          ? [{ pattern: 'solid', spacing: 0, color: pdfColor(style.fillColor)?.color ?? '#666666' }] : []);
      } : undefined,
      version: 'R2007',
      showHatching: displayOptions.showHatching,
      showHiddenLines: displayOptions.showHiddenLines,
      coordinateTransform,
      metadataComment,
      underlays: mappedDxfUnderlayOptions(dxfUnderlays, sectionPlane.axis),
      // The traced scan outline (#6871) on its own layer, through the same
      // georeference transform as the cut.
      polylineLayers: [...(overlays.polylineLayers ?? []), ...annotations.map(({ graphic, style }) => ({
        name: 'IFC-DIMENSIONS', color: style.lineColor ?? '#000000', closed: false,
        lineWeight: graphic.lineWidth * 1000 / scale,
        polylines: [...graphic.strokes, ...graphic.triangles.map(points => [...points, points[0]]),
          ...graphic.circles.map(({ center, radius }) => Array.from({ length: 25 }, (_, i) => ({
            x: center.x + radius * Math.cos(i * Math.PI / 12), y: center.y + radius * Math.sin(i * Math.PI / 12),
          })))].map(points => points.map(fromPaper)),
      })), ...markups.polylineLayers],
      labels: [...(overlays.labels ?? []), ...annotations.map(({ position, label, style, graphic, angle }) => {
        const origin = coordinateTransform(fromPaper(position));
        const radians = angle * Math.PI / 180;
        const next = coordinateTransform(fromPaper({
          x: position.x + Math.cos(radians), y: position.y + Math.sin(radians),
        }));
        return {
          layer: 'IFC-DIMENSIONS', color: style.textColor ?? '#000000', text: label,
          position: fromPaper(position), height: graphic.textSize,
          rotationDeg: Math.atan2(next.y - origin.y, next.x - origin.x) * 180 / Math.PI,
        };
      }), ...markups.labels],
    }, elementTags, scale));
    const suffix = lineweights ? `-1-${formatScaleFactorLabel(scale)}` : '';
    const stem = `section-${sectionPlane.axis}-${sectionPlane.position}${suffix}`;
    return { dxf, stem, isGeoreferenced };
  }, [
    drawing, dxfUnderlays, displayOptions.showHiddenLines, displayOptions.showHatching, displayOptions.showScanSection, scanSection.outline,
    sectionPlane, ifcDataStore, coordinateInfo, storeModels, anchorModelIdOverride, georefMutations, mutationVersion,
    lineweights, cutPolygonStyleContext, sheetEnabled, activeSheet, displayOptions.scale, markers, dimensionGraphics, elementTags,
    polygonArea2DResults, textAnnotations2D, cloudAnnotations2D, lineweightTable,
  ]);
  const handleExportDXF = useCallback(() => {
    const file = buildDXF();
    if (!file) return;
    downloadDxf(file.dxf, `${file.stem}.dxf`, 'utf-8');
    trackExportCompleted({ format: 'dxf', surface: 'drawing_panel' });
    posthog.capture('drawing_exported', { format: 'dxf', axis: sectionPlane.axis, georeferenced: file.isGeoreferenced });
  }, [buildDXF, sectionPlane.axis]);
  // Export the drawing as vectors at the requested scale, sizing the page
  // around its extent (see pdf-scale.ts). Sheet exports take the separate
  // branch below so they can include the frame, title block and scale bar.
  // Raster references and DXF underlays render beneath the section strokes.
  const handleExportPDF = useCallback(async (scaleFactor?: number, destination?: (blob: Blob) => void) => {
    if (!drawing) return;

    // A sheet PDF reuses the SVG sheet layout through a PNG. Loose views
    // use the vector paths below, at their requested scale.
    if (sheetEnabled && activeSheet) {
      const svg = destination ? generateSheetSVG(false) : tryDrawingSvg(generateSheetSVG);
      if (!svg) return;
      const { widthMm, heightMm } = activeSheet.paper;
      await recordActivity({ kind: 'export', title: 'activityTray.job.export', panel: 'drawing',
        subject: `${activeSheet.name} · PDF` }, async () => {
          const { jsPDF } = await import('jspdf');
          const { dataUrl, fit } = await rasterizeSvgToPngDataUrl(svg, widthMm, heightMm);
          const doc = new jsPDF({
            unit: 'mm',
            format: [widthMm, heightMm],
            orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
          });
          // Full paper rectangle, deliberately NOT `fit.widthPx / dpi`: the
          // image must span the sheet whatever the raster cost, or a capped
          // export would print a smaller sheet at the same nominal scale.
          doc.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);

          if (fit.capped) {
            // FLOOR, not round: 299.53 dpi renders as "reduced from 300 to
            // 300" under rounding, which reads as a no-op notice, and
            // overstating the resolution delivered is the direction that
            // misleads.
            toast.info(
              `Sheet rasterized at ${Math.floor(fit.effectiveDpi)} dpi instead of ` +
              `${SHEET_PDF_DPI} — a ${Math.round(widthMm)}x${Math.round(heightMm)} mm sheet ` +
              `exceeds the browser's canvas limit at full resolution. Use the SVG export ` +
              `for a vector sheet at any size.`,
            );
          }

          const stem = `${sanitizeFilename(activeSheet.name, { fallback: 'sheet' })}-${sectionPlane.axis}-${sectionPlane.position}`;
          if (destination) { destination(doc.output('blob')); return; }
          downloadFile(doc.output('blob'), `${stem}.pdf`, 'application/pdf');
          trackExportCompleted({ format: 'pdf', surface: 'drawing_panel' });
          posthog.capture('drawing_exported', {
            format: 'pdf',
            axis: sectionPlane.axis,
            scale_factor: activeSheet.scale.factor,
            sheet_enabled: true,
            // What the SHEET got, not what was asked for — the same
            // distinction `PdfViewExportDialog` records as `shading_dpi`.
            raster_dpi: Math.floor(fit.effectiveDpi),
            raster_capped: fit.capped,
          });
      }).catch((err: unknown) => {
        if (destination) throw err;
        toast.error(err instanceof Error ? t('section2d.export.pdfFailed', { error: err.message }) : t('section2d.export.pdfFailedGeneric'));
      });
      return;
    }

    const effectiveScale = scaleFactor ?? displayOptions.scale ?? 100;

    // Axis-specific flipping, matching the SVG "as displayed" export above.
    // The layout (page size + offsets) MUST be derived from the bounds as
    // they are actually drawn (i.e. flipped), not the raw drawing bounds —
    // see pdfSectionLayout.ts module doc: deriving it from un-flipped bounds
    // only lands the drawing on the page when bounds happen to be symmetric
    // about zero, which is not the case for a model at ordinary world
    // coordinates (showstopper found on PR #2119).
    const currentAxis = sectionPlane.axis;
    let layout: PdfScaleLayout;
    try {
      layout = computePdfSectionLayout(expandDrawingAnnotationBounds(
         expandDimensionBounds(tagExportBounds(viewMarkerExportBounds(drawing.bounds, markers, effectiveScale), elementTags, effectiveScale), effectiveScale),
         polygonArea2DResults, textAnnotations2D, cloudAnnotations2D, effectiveScale,
       ), currentAxis, effectiveScale, 10);
    } catch (err) {
      if (destination) throw err;
      toast.error(err instanceof Error ? t('section2d.export.invalidScaleDetail', { error: err.message }) : t('section2d.export.invalidScale'));
      return;
    }
    const mapPoint = makeSectionMapPoint(currentAxis, layout);
    const annotations = dimensionGraphics(mapPoint, 1, effectiveScale);

    // Prepared before the reference snapshot is taken, so a throw here cannot
    // strand it.
    let cutPolygons: PdfCutPolygon[];
    const styleContext = cutPolygonStyleContext(effectiveScale);
    try { cutPolygons = prepareCutPolygonsPdf([...(drawing.projectionPolygons ?? []), ...drawing.cutPolygons], styleContext, mapPoint); }
    catch (error) { if (destination) throw error; toast.error(error instanceof Error ? t('section2d.export.pdfFailed', { error: error.message }) : t('section2d.export.pdfFailedGeneric')); return; }

    let referenceSnapshot: ReturnType<typeof snapshotDrawingReferences>;
    try { referenceSnapshot = snapshotDrawingReferences(useViewerStore.getState(), drawing.config.plane); }
    catch (error) { if (destination) throw error; toast.error(error instanceof Error ? error.message : t('section2d.export.pdfFailedGeneric')); return; }
    // Own mapped vectors at click time; model/reference edits during async export
    // cannot replace the geometry whose bounds/scale were used above.
    const vectorSnapshot = structuredClone(dxfUnderlays);
    await recordActivity({ kind: 'export', title: 'activityTray.job.export', panel: 'drawing',
      subject: `section-${sectionPlane.axis}-${sectionPlane.position} · PDF` }, async () => {
      try {
        const { jsPDF } = await import('jspdf');
        const { widthMm, heightMm } = layout.page;
        const doc = new jsPDF({
          unit: 'mm',
          format: [widthMm, heightMm],
          orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
        });

        const raster = await rasterizeReferenceLayer(referenceSnapshot, widthMm, heightMm, mapPoint);
        if (raster) doc.addImage(raster, 'PNG', 0, 0, widthMm, heightMm);
        drawDxfUnderlaysPdf(doc, vectorSnapshot, mapPoint, 1000 / effectiveScale);

        doc.setLineCap('round');
        doc.setLineJoin('round');

        drawCutPolygonsPdf(doc, cutPolygons, effectiveScale);
        doc.setDrawColor(0, 0, 0);

        // Entities whose cut polygons are all `fillable` (see its doc). Loop
        // reconstruction (`PolygonBuilder.buildLoops`) can fail for short,
        // degenerate, or ambiguous cross-sections and drop an entity's
        // `cutPolygons` entirely while `drawing.lines` still carries valid
        // `category: 'cut'` edges for that same entity (same source
        // `cutSegments`, but polygon-building is a separate, fallible
        // reconstruction, not a lockstep derivation — see #2119 review). Skip
        // cut-category lines ONLY for entities that a polygon outline
        // already covers; otherwise they are the sole remaining record of
        // that cut and must still be drawn, or the geometry silently
        // vanishes from the PDF.
        // Per entity: one damaged polygon keeps all of that entity's cut lines.
        const entityKey = ({ polygon: p }: PdfCutPolygon) => makeEntityKey(p.modelIndex, p.entityId);
        const damaged = new Set(cutPolygons.filter((p) => p.polygon.isCut && !p.fillable).map(entityKey));
        const entitiesWithCutPolygon = new Set(cutPolygons.filter((p) => p.polygon.isCut).map(entityKey).filter((key) => !damaged.has(key)));

        // Drawing lines (projection/hidden/silhouette/crease/boundary).
        for (const line of drawing.lines) {
          if (
            isPolygonCutLine(line) &&
            entitiesWithCutPolygon.has(makeEntityKey(line.modelIndex, line.entityId))
          ) {
            continue;
          }
          if (!displayOptions.showHiddenLines && isOccludedDrawingLine(line)) continue;

          const { start, end } = line.line;
          const p0 = mapPoint(start.x, start.y);
          const p1 = mapPoint(end.x, end.y);
          if (!isPagePoint(p0) || !isPagePoint(p1)) continue; // checked on the page, see isPagePoint

          // Shared with the to-scale 3D-view PDF (#2042) so the two writers
          // cannot drift into two different line hierarchies.
          const { lineWidthMm, dash } = pdfLineStyleFor(line.category, line.visibility);
          const pen = styleContext.stroke?.(line, line.category === 'cut' ? 'cut' : 'projection', line);
          if (pen && !(pen.lineWeight > 0)) continue;
          if (pen) doc.setDrawColor(pdfColor(pen.color)?.color ?? '#000000');
          doc.setLineWidth(pen?.lineWeight ?? lineWidthMm);
          doc.setLineDashPattern(pen ? [...(pen.dash ?? [])] : dash, 0);
          doc.line(p0.x, p0.y, p1.x, p1.y);
        }
        drawViewMarkersPdf(doc, markers, mapPoint, effectiveScale, lineweightsAtScale(lineweightTable ?? {}, effectiveScale));
        drawDrawingTagsPdf(doc, elementTags, mapPoint);
        doc.setLineDashPattern([], 0);
        for (const { graphic, position, label, style, font, angle } of annotations) {
          const ink = style.lineColor ?? '#000000';
          doc.setDrawColor(ink).setFillColor(ink).setLineWidth(graphic.lineWidth);
          for (const [a, b] of graphic.strokes) doc.line(a.x, a.y, b.x, b.y);
          for (const [a, b, c] of graphic.triangles) doc.triangle(a.x, a.y, b.x, b.y, c.x, c.y, 'F');
          for (const { center, radius, filled } of graphic.circles) doc.circle(center.x, center.y, radius, filled ? 'F' : 'S');
          const family = font.toLowerCase();
          doc.setFont(family.includes('georgia') ? 'times' : family.includes('courier') ? 'courier' : 'helvetica');
          doc.setFontSize(graphic.textSize * 72 / 25.4);
          doc.setTextColor(style.textColor ?? '#000000');
          doc.text(label, position.x, position.y, { align: 'center', baseline: 'middle', angle: -angle });
        }
        drawDrawingAnnotationsPdf(doc, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D,
          mapPoint, effectiveScale, lineweightTable);
        doc.setLineDashPattern([], 0);
        // v1 has no title block, so this filename is the SOLE record of the
        // sheet's scale — round-tripping through Math.round() here would
        // file a 1:99.5 export as "…-1-100", silently misreporting it (same
        // defect class as PR #2131's title-block scale label). Reuse that
        // formatting (round to 2dp, strip trailing zeros) instead of
        // re-deriving it.
        const stem = `section-${sectionPlane.axis}-${sectionPlane.position}-1-${formatScaleFactorLabel(effectiveScale)}`;
        if (destination) { destination(doc.output('blob')); return; }
        downloadFile(doc.output('blob'), `${stem}.pdf`, 'application/pdf');
        trackExportCompleted({ format: 'pdf', surface: 'drawing_panel' });
        posthog.capture('drawing_exported', {
          format: 'pdf',
          axis: sectionPlane.axis,
          scale_factor: effectiveScale,
        });
      } finally { referenceSnapshot.release(); }
    }).catch((err: unknown) => {
      if (destination) throw err;
      toast.error(err instanceof Error ? t('section2d.export.pdfFailed', { error: err.message }) : t('section2d.export.pdfFailedGeneric'));
    });
  }, [drawing, dxfUnderlays, displayOptions.scale, displayOptions.showHiddenLines, sectionPlane, sheetEnabled, activeSheet, generateSheetSVG, cutPolygonStyleContext, t, markers, expandDimensionBounds, dimensionGraphics, elementTags, lineweightTable,
     polygonArea2DResults, textAnnotations2D, cloudAnnotations2D]);

  // Print handler
  const handlePrint = useCallback(() => {
    // Use sheet export if enabled, otherwise raw drawing export
    const svg = tryDrawingSvg(() => (sheetEnabled && activeSheet) ? generateSheetSVG() : generateExportSVG());
    if (!svg) return;

    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      toast.error(t('section2d.export.allowPopups'));
      return;
    }

    const rawTitle = (sheetEnabled && activeSheet)
      ? `${activeSheet.name} - ${sectionPlane.axis} at ${sectionPlane.position}%`
      : `Section Drawing - ${sectionPlane.axis} at ${sectionPlane.position}%`;
    // The sheet name is user-controlled and interpolated into the <title> of a
    // same-origin window. Without escaping, a sheet named `</title><script>…`
    // would break out of the title and execute script. Escape it (the SVG body
    // is already escaped via escapeXml; the title was the one unescaped sink).
    const title = rawTitle
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Write print-friendly HTML with the SVG
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            @media print {
              @page { margin: ${(sheetEnabled && activeSheet) ? '0' : '1cm'}; }
              body { margin: 0; }
            }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              padding: ${(sheetEnabled && activeSheet) ? '0' : '20px'};
              box-sizing: border-box;
            }
            svg {
              max-width: 100%;
              max-height: 100vh;
              width: auto;
              height: auto;
            }
          </style>
        </head>
        <body>
          ${svg}
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }, [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet, sectionPlane, t]);

  return {
    formatDistance,
    handleExportSVG,
    handleExportDXF, buildDXF, buildSVG,
    handleExportPDF,
    handlePrint,
  };
}

export { useDrawingExport };
export default useDrawingExport;
