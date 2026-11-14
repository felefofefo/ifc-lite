/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DXF Exporter - Export 2D drawings to ASCII DXF (issue #1861)
 *
 * Mirrors `svg-exporter.ts`'s input contract (a `Drawing2D` plus reference
 * underlays) so the two exporters read the same generated-drawing model and
 * cannot drift: same polylines/edges, same hatch-boundary polygons, same
 * per-style layer/colour derivation.
 *
 * Unlike SVG, DXF has no "paper" concept — coordinates are written verbatim
 * in the drawing's own unit (metres) with no scale/padding transform. A
 * `Drawing2D` generated without a render-frame shift (the package-level
 * contract; see `svg-exporter.ts`'s underlay caveat) therefore round-trips
 * through this exporter unchanged. Callers that need real-world or
 * map-projected output (the viewer's georeferenced plan-section export)
 * supply `coordinateTransform`, applied to every point — drawing and
 * underlay alike — right before it reaches the writer.
 *
 * The default DXF R12 (AC1009) output uses closed boundaries. The R2007
 * (AC1021) output adds native solid hatches and declares metres in
 * `$INSUNITS`. Both formats can carry the CRS in a `999` comment via
 * `metadataComment`.
 */

import { patternSegments, surfacePatternSegments, type PatternLine } from './pat-lines.js';
import type { Drawing2D, DrawingLine, DrawingPolygon, LineCategory, Point2D } from './types.js';
import { isPolygonCutLine, makeEntityKey } from './types.js';
import { isOccludedDrawingLine } from './projection-bands.js';
import { getLineStyle, getHatchPattern } from './styles.js';
import { applyDxfPlacement } from './dxf/convert.js';
import { DEFAULT_DXF_PLACEMENT, type DxfPlacement, type DxfUnderlay } from './dxf/types.js';
import { ModernDxfWriter, type DxfObjectStroke } from './dxf/writer-modern.js';
import { DxfWriter, type DxfLinetype } from './dxf/writer.js';

export interface DXFHatchLayer {
  pattern: 'solid' | 'diagonal' | 'cross-hatch' | 'custom';
  families?: readonly PatternLine[];
  patternKey?: string;
  spacing: number;
  color: string;
  lineWeight?: number;
}

export interface DXFExportOptions {
  /** Include occluded lines (default true, matching SVG). */
  showHiddenLines?: boolean;
  /** R12 writes cut boundaries; R2007 supports native solid hatches and UTF-8. Defaults to R12. */
  version?: 'R12' | 'R2007';
  /** Include cut-polygon boundaries and, in R2007, native solid hatches. Default true. */
  showHatching?: boolean;
  /** Write R2007 pen properties on entities. */
  objectStyles?: boolean;
  /** Optional R2007 cut/projection appearance. Weights are paper millimetres. */
  strokeStyle?: (
    element: Pick<DrawingLine, 'entityId' | 'ifcType' | 'modelIndex'>,
    role: 'cut' | 'projection',
    line?: DrawingLine,
  ) => DxfObjectStroke & { weightKey?: string };
  /** Ordered native hatches, background first, in drawing metres. */
  hatchLayers?: (polygon: DrawingPolygon) => readonly DXFHatchLayer[];
  /** Optional R2007 pattern. An undefined result uses the default fill. Spacing is in drawing metres. */
  hatchStyle?: (polygon: DrawingPolygon) => { pattern: 'solid' | 'none' | 'diagonal' | 'cross-hatch'; spacing: number } | undefined;
  /** DXF reference underlays composited alongside the drawing (issue #1782 parity). */
  underlays?: DXFUnderlayOptions[];
  /**
   * Applied to every emitted point (drawing geometry and underlays alike)
   * as the very last step before it reaches the writer. Identity by
   * default. The viewer uses this to re-derive true world/map coordinates
   * for a plan-view export — see `apps/viewer/src/hooks/dxfExportGeoref.ts`.
   */
  coordinateTransform?: (p: Point2D) => Point2D;
  /**
   * `999` comment written at the top of the file (R12 has no `$INSUNITS`
   * to state the unit instead — see `dxf/writer.ts`). Defaults to a
   * generic "units: metres" note; pass one naming the `IfcProjectedCRS`
   * for a georeferenced export.
   */
  metadataComment?: string;
  /**
   * Extra polyline layers drawn on top of the drawing, each on its own DXF
   * layer (e.g. the viewer's traced scan outline, #6871). Points are in
   * drawing space and go through `coordinateTransform` like everything else.
   */
  polylineLayers?: DXFPolylineLayer[];
  /** Additional drawing-space labels, kept on the same layer as their marker lines. */
  labels?: readonly { layer: string; color: string; text: string; position: Point2D; height: number }[];
}

/** One named layer of polylines to embed. */
export interface DXFPolylineLayer {
  /** DXF layer name (R12: letters, digits, `-`, `_`, `$`). */
  name: string;
  /** CSS colour mapped to the nearest ACI colour by the writer. */
  color: string;
  polylines: readonly (readonly Point2D[])[];
  /** Close every polyline back to its first point. Default true. */
  closed?: boolean;
}

/** One DXF reference underlay to embed (mirrors `SVGUnderlayOptions`). */
export interface DXFUnderlayOptions {
  underlay: DxfUnderlay;
  /** Placement in drawing space; identity when omitted. */
  placement?: DxfPlacement;
  /** Per-layer visibility override; falls back to the DXF layer's own state. */
  layerVisibility?: Record<string, boolean>;
}

const CATEGORY_LAYER: Record<LineCategory, string> = {
  cut: 'IFC-CUT',
  projection: 'IFC-PROJECTION',
  hidden: 'IFC-HIDDEN',
  silhouette: 'IFC-SILHOUETTE',
  crease: 'IFC-CREASE',
  boundary: 'IFC-BOUNDARY',
  annotation: 'IFC-ANNOTATION',
};
const FILL_LAYER = 'IFC-FILL';

/** Builds a DXF document from a `Drawing2D`, mirroring `SVGExporter`. */
export class DXFExporter {
  export(drawing: Drawing2D, options: DXFExportOptions = {}): string {
    const {
      showHiddenLines = true,
      showHatching = true,
      version = 'R12',
      underlays = [],
      coordinateTransform = (p: Point2D) => p,
      metadataComment,
      polylineLayers = [],
    } = options;

    const writer = version === 'R2007'
      ? new ModernDxfWriter(metadataComment)
      : new DxfWriter({ headerComment: metadataComment });
    const map = (p: Point2D): Point2D => coordinateTransform(p);

    // Layer per line category, DASHED linetype for the hidden layer only —
    // matches how SVGExporter groups its <g> layers. Lines whose
    // `visibility` is 'hidden' are routed onto the hidden layer regardless
    // of category — see writeLine.
    const categoryLayers = new Map<LineCategory, string>();
    for (const [category, name] of Object.entries(CATEGORY_LAYER) as [LineCategory, string][]) {
      const linetype: DxfLinetype = category === 'hidden' ? 'DASHED' : 'CONTINUOUS';
      categoryLayers.set(category, writer.layer(name, getLineStyle(category).color, linetype));
    }
    const fillLayer = writer.layer(FILL_LAYER, '#666666');

    const styledWriter = writer instanceof ModernDxfWriter ? writer : undefined;
    const strokeStyle = styledWriter ? options.strokeStyle : undefined;
    const outlined = new Set<string>();

    const writePaint = (polygon: DrawingPolygon, outer: Point2D[], holes: Point2D[][], item: DXFHatchLayer) => {
      if (!styledWriter) return;
      if (item.pattern !== 'solid' && polygon.surfacePatternTransform) {
        for (const { start, end } of surfacePatternSegments(polygon, { ...item, pattern: item.pattern })) {
          styledWriter.addLine(map(start), map(end), fillLayer, undefined, { color: item.color, lineWeight: item.lineWeight ?? 0.13 });
        }
      } else if (item.pattern === 'custom') {
        for (const { start, end } of patternSegments(polygon.polygon, item.families ?? [], item.spacing)) {
          styledWriter.addLine(map(start), map(end), fillLayer, undefined, { color: item.color, lineWeight: item.lineWeight ?? 0.13 });
        }
      } else styledWriter.addHatch(outer, holes, fillLayer, item.pattern, item.spacing, item.color, item.lineWeight);
    };
    // Hatching first (bottom-most, like SVGExporter's hatching layer).
    if (showHatching) {
      if (styledWriter && options.hatchLayers) {
        for (const polygon of drawing.projectionPolygons ?? []) {
          const layers = options.hatchLayers(polygon);
          if (!layers.length) continue;
          const outer = polygon.polygon.outer.map(map);
          const holes = polygon.polygon.holes.map(hole => hole.map(map));
          for (const item of layers) writePaint(polygon, outer, holes, item);
        }
      }
      for (const polygon of drawing.cutPolygons) {
        const base = getHatchPattern(polygon.ifcType);
        const layers = styledWriter ? options.hatchLayers?.(polygon) : undefined;
        const hatch = styledWriter ? options.hatchStyle?.(polygon) : undefined;
        const pattern = hatch?.pattern ?? (base.type === 'none' ? 'none' : 'solid');
        if (!layers && pattern === 'none' && base.type === 'none') continue;
        const outer = polygon.polygon.outer.map(map);
        const holes = polygon.polygon.holes.map((hole) => hole.map(map));
        if (styledWriter && layers) {
          for (const item of layers) writePaint(polygon, outer, holes, item);
        } else if (styledWriter && pattern !== 'none') {
          styledWriter.addHatch(outer, holes, fillLayer, pattern, hatch?.spacing);
        }
        if (!strokeStyle && base.type !== 'none') {
          writer.addPolyline(outer, fillLayer, true, base.strokeColor);
          for (const hole of holes) writer.addPolyline(hole, fillLayer, true, base.strokeColor);
        }
      }
    }

    // Underlays beneath the drawing lines (SVGExporter renders them first too).
    for (const underlayOptions of underlays) {
      this.writeUnderlay(writer, underlayOptions, map);
    }

    if (strokeStyle && styledWriter) {
      for (const polygon of drawing.cutPolygons) {
        if (polygon.polygon.outer.length < 3) continue;
        const style = strokeStyle(polygon, 'cut');
        const layer = options.objectStyles ? categoryLayers.get('cut')!
          : styledWriter.strokeLayer(CATEGORY_LAYER.cut, style.color, style.lineWeight, style.weightKey);
        const pen = options.objectStyles ? style : undefined;
        if (pen && !(pen.lineWeight > 0)) {
          outlined.add(makeEntityKey(polygon.modelIndex, polygon.entityId));
          continue;
        }
        styledWriter.addPolyline(polygon.polygon.outer.map(map), layer, true, undefined, pen);
        for (const hole of polygon.polygon.holes) styledWriter.addPolyline(hole.map(map), layer, true, undefined, pen);
        outlined.add(makeEntityKey(polygon.modelIndex, polygon.entityId));
      }
    }

    for (const line of drawing.lines) {
      if (!showHiddenLines && isOccludedDrawingLine(line)) continue;
      if (strokeStyle && styledWriter && (options.objectStyles || line.visibility !== 'hidden')) {
        if (isPolygonCutLine(line) && outlined.has(makeEntityKey(line.modelIndex, line.entityId))) continue;
        const role = line.category === 'cut' ? 'cut' : 'projection';
        if (options.objectStyles || line.category === 'cut' || line.category === 'projection' || line.category === 'silhouette' || line.category === 'crease' || line.category === 'boundary') {
          const style = strokeStyle(line, role, line);
          if (options.objectStyles && !(style.lineWeight > 0)) continue;
          const category = line.visibility === 'hidden' ? 'hidden' : line.category;
          const layer = options.objectStyles ? categoryLayers.get(category)!
            : styledWriter.strokeLayer(CATEGORY_LAYER[category], style.color, style.lineWeight, style.weightKey);
          styledWriter.addLine(map(line.line.start), map(line.line.end), layer, undefined, options.objectStyles ? style : undefined);
          continue;
        }
      }
      this.writeLine(writer, line, categoryLayers, map);
    }

    for (const extra of polylineLayers) {
      const layer = writer.layer(extra.name, extra.color);
      for (const polyline of extra.polylines) {
        writer.addPolyline(polyline.map(map), layer, extra.closed ?? true);
      }
    }

    for (const label of options.labels ?? []) {
      const layer = writer.layer(label.layer, label.color);
      writer.addText(map(label.position), label.text, label.height, layer, { hAlign: 'center', vAlign: 'middle' });
    }

    return writer.toString();
  }

  private writeLine(
    writer: DxfWriter,
    line: DrawingLine,
    categoryLayers: Map<LineCategory, string>,
    map: (p: Point2D) => Point2D,
  ): void {
    // Visibility wins over category (PR #1871 review, P2): hidden-line
    // removal / construction projection can mark e.g. a `projection` line
    // `visibility: 'hidden'`. Mapping by category alone would land it on the
    // CONTINUOUS `IFC-PROJECTION` layer and occluded/overhead edges would
    // read as solid in CAD. Mirror `exportToSVG`'s hidden-lines grouping
    // (and the viewer canvas's dashed override): every `visibility ===
    // 'hidden'` line joins the DASHED `IFC-HIDDEN` layer with the hidden
    // line style. No new layer/LTYPE names — `IFC-HIDDEN` and `DASHED` are
    // already declared in TABLES, so the output stays R12-legal.
    const styleCategory: LineCategory = line.visibility === 'hidden' ? 'hidden' : line.category;
    const layer = categoryLayers.get(styleCategory);
    if (!layer) return;
    const style = getLineStyle(styleCategory, line.ifcType);
    const start = map(line.line.start);
    const end = map(line.line.end);
    writer.addLine(start, end, layer, style.color);
  }

  private writeUnderlay(
    writer: DxfWriter,
    options: DXFUnderlayOptions,
    map: (p: Point2D) => Point2D,
  ): void {
    const { underlay, placement = DEFAULT_DXF_PLACEMENT, layerVisibility = {} } = options;
    // Underlay points are already in world plan coordinates (metres, +Y
    // north) — the same convention DXF itself uses, so unlike SVG (+Y
    // down), the FINAL output needs no sign flip relative to world space.
    // But `applyDxfPlacement` itself is defined in DRAWING space (+Y down —
    // see `DxfPlacement`'s docs: "Offset in metres (drawing space)",
    // "counter-clockwise as seen on a plan view"): every other consumer
    // (`svg-exporter.ts`'s underlay mapping, `dxfUnderlayMath.ts`'s
    // `worldToDrawing`) negates Y, applies the placement, and — for
    // consumers that stay in world space — negates Y back. Calling
    // `applyDxfPlacement` directly on a world-space (+Y up) point skips
    // that round trip, so a non-zero `offsetY` lands with the opposite
    // sign and a non-zero `rotationDeg` spins the opposite direction from
    // what the same `placement` produces everywhere else (2D canvas, 3D
    // overlay, SVG export) — a silently mirrored underlay in the DXF.
    const mapPoint = (p: Point2D): Point2D => {
      const drawingSpace = applyDxfPlacement({ x: p.x, y: -p.y }, placement);
      return map({ x: drawingSpace.x, y: -drawingSpace.y });
    };
    const underlayPrefix = `DXF_${underlay.name}`;

    for (const dxfLayer of underlay.layers) {
      const visible = layerVisibility[dxfLayer.name] ?? dxfLayer.visible;
      if (!visible) continue;
      const layer = writer.layer(`${underlayPrefix}_${dxfLayer.name}`, dxfLayer.color);

      for (const fill of dxfLayer.fills) {
        const outer = fill.polygon.outer.map(mapPoint);
        writer.addPolyline(outer, layer, true, fill.color);
        for (const hole of fill.polygon.holes) {
          writer.addPolyline(hole.map(mapPoint), layer, true, fill.color);
        }
      }

      for (const path of dxfLayer.paths) {
        if (path.points.length < 2) continue;
        writer.addPolyline(path.points.map(mapPoint), layer, path.closed, path.color);
      }

      for (const text of dxfLayer.texts) {
        if (!text.text.trim()) continue;
        const anchor = mapPoint(text.position);
        const tip = mapPoint({ x: text.position.x + text.dirX, y: text.position.y + text.dirY });
        const angle = (Math.atan2(tip.y - anchor.y, tip.x - anchor.x) * 180) / Math.PI;
        // Placement scales the geometry through mapPoint; the glyph height
        // must follow or labels detach from their linework (same rule as
        // SVGExporter's underlay text).
        const height = text.height * placement.scale;
        const lines = text.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          // Stack subsequent lines by offsetting in LOCAL space, then map:
          // the stacking direction must rotate with the text when
          // placement.rotationDeg is non-zero or coordinateTransform itself
          // rotates (georeferenced rotated grid) — exactly like
          // SVGExporter's rotate() wrapper around its tspan stack. An
          // output-space `anchor.y - offset` would shift lines straight
          // down regardless of the text's actual direction (PR #1871
          // review).
          const lineAnchor = i === 0
            ? anchor
            : mapPoint({ x: text.position.x, y: text.position.y - i * text.height * 1.3 });
          writer.addText(
            lineAnchor,
            lines[i],
            height,
            layer,
            { rotationDeg: angle, hAlign: text.align, vAlign: text.valign, colorOverride: text.color },
          );
        }
      }
    }
  }
}

/** Export a `Drawing2D` to an ASCII DXF string. */
export function exportToDXF(drawing: Drawing2D, options?: DXFExportOptions): string {
  return new DXFExporter().export(drawing, options);
}
