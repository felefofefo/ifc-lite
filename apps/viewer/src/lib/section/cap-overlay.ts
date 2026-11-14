/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A cut, as the renderer's 3D cap overlay takes it. One conversion for every
 * plane's cap: the active plane's (from the Drawing) and the others' (#7545).
 */

import type { CutPolygon2D, DrawingLine2D } from '@ifc-lite/renderer';
import { isOccludedDrawingLine, isPolygonCutLine, makeEntityKey, type Drawing2D, type DrawingPolygon, type DXFHatchLayer } from '@ifc-lite/drawing-2d';
import type { SectionPlane } from '@/store/types';
import { pdfColor } from '@/lib/export/pdf-color';
import { getFillColorForType } from '@/components/viewer/drawing/ifc-fill-colors';
import { customPlaneCenter } from '@/store/slices/section-plane-center';

type Cut = Pick<Drawing2D, 'cutPolygons' | 'layerBaseCutPolygons' | 'lines'>;

function opaque(c: [number, number, number, number] | undefined): [number, number, number, number] | undefined {
  return c ? [c[0], c[1], c[2], 1] : undefined;
}

type Rgba = [number, number, number, number];
type CapPaints = {
  scale: number;
  joinCutPolygons?: (polygons: DrawingPolygon[]) => DrawingPolygon[];
  patOffsets?: ReadonlyMap<string, number>;
  fallbackStyle?: (polygon: DrawingPolygon) => { fillColor: string; fillOpacity: number };
  resolve?: (polygon: DrawingPolygon, fallbackColor: () => string) => readonly DXFHatchLayer[] | undefined;
};

function capColor(color: string): Rgba {
  const parsed = pdfColor(color);
  const rgb = Number.parseInt(parsed?.color.slice(1) ?? '666666', 16);
  return [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, parsed?.alpha ?? 1];
}

export function publicationCapPaint(paints: readonly DXFHatchLayer[], scale = 100, patOffsets?: ReadonlyMap<string, number>): Pick<CutPolygon2D, 'color' | 'hatch'> {
  const solidIndex = paints.reduce((last, paint, index) => paint.pattern === 'solid' ? index : last, -1);
  const solid = paints[solidIndex];
  const pattern = paints.slice(solidIndex + 1).find(p => p.pattern === 'diagonal' || p.pattern === 'cross-hatch'
    || (p.pattern === 'custom' && p.patternKey !== undefined && patOffsets?.has(p.patternKey)));
  const customOffset = pattern?.patternKey && patOffsets?.get(pattern.patternKey);
  return {
    color: solid ? capColor(solid.color) : [0, 0, 0, 0],
    hatch: pattern ? {
      patternId: customOffset ? customOffset + 8 : pattern.pattern === 'cross-hatch' ? 2 : 1,
      modelSpace: true,
      spacingPx: pattern.spacing,
      widthPx: (pattern.lineWeight ?? 0.13) * scale / 1000,
      angleRad: -Math.PI / 4, secondaryAngleRad: Math.PI / 4,
      strokeColor: capColor(pattern.color),
    } : { patternId: 0 },
  };
}

/** Whether a cut has anything to show: an open surface's cut is only lines (#8664). */
export function capOverlayHasContent(cut: Pick<Cut, 'cutPolygons' | 'lines'>): boolean {
  return cut.cutPolygons.length > 0 || cut.lines.some((line) => line.openSurfaceCut);
}

export function capOverlayInput(cut: Cut, showHiddenLines: boolean, fillMode: 'uniform' | 'element' = 'uniform', preview?: CapPaints): { polygons: CutPolygon2D[]; lines: DrawingLine2D[] } {
  // Opaque base cross-sections FIRST (one per multi-material entity, built from the
  // watertight union so they always close). The overlay triangulates polygons in
  // array order into one draw, so these render BEHIND the per-layer colours below;
  // where a layer's cap could not be reconstructed the base keeps the cut solid
  // instead of see-through. Colourless → uniform opaque cap fill.
  const cutPolygons = preview?.joinCutPolygons?.(cut.cutPolygons) ?? cut.cutPolygons;
  const joined = new Set(cutPolygons.filter(cp => cp.cutOutline !== undefined)
    .map(cp => makeEntityKey(cp.modelIndex, cp.entityId)));
  const layerPolygons: CutPolygon2D[] = cutPolygons.map((cp) => {
    const fallback = preview?.fallbackStyle?.(cp);
    const paints = preview?.resolve?.(cp, () => fallback?.fillColor ?? getFillColorForType(cp.ifcType));
    const styled = paints && preview ? publicationCapPaint(paints, preview.scale, preview.patOffsets) : undefined;
    const baseColor = fallback ? capColor(fallback.fillColor) : fillMode === 'element' ? cp.color ?? cp.sourceColor : cp.color;
    const color = opaque(styled?.color?.[3] ? styled.color : baseColor);
    return {
      polygon: cp.polygon, ifcType: cp.ifcType, expressId: cp.entityId, modelIndex: cp.modelIndex,
      ...styled,
      color,
      hatch: styled?.hatch ?? (fallback ? { patternId: 0 } : undefined),
      ...(cp.cutOutline ? { cutOutline: cp.cutOutline } : {}),
    };
  });
  const basePolygons: CutPolygon2D[] = (cut.layerBaseCutPolygons ?? [])
    .map((cp) => {
      const fallback = preview?.fallbackStyle?.(cp);
      return {
        polygon: cp.polygon, ifcType: cp.ifcType, expressId: cp.entityId, modelIndex: cp.modelIndex,
        // The layer outlines already cover joined elements. The base only fills.
        ...(joined.has(makeEntityKey(cp.modelIndex, cp.entityId)) ? { cutOutline: [] } : {}),
        ...(fallback ? { color: opaque(capColor(fallback.fillColor)), hatch: { patternId: 0 } } : {}),
      };
    });
  // The renderer lifts these lines onto the cut plane. Lines from the 2D
  // projection have lost their depth here and would paint over the opaque cap.
  const lines: DrawingLine2D[] = cut.lines
    .filter((line) => line.category === 'cut' && (showHiddenLines || !isOccludedDrawingLine(line))
      && !(isPolygonCutLine(line) && joined.has(makeEntityKey(line.modelIndex, line.entityId))))
    .map((line) => ({ line: line.line, category: line.category }));
  return { polygons: [...basePolygons, ...layerPolygons], lines };
}

/**
 * For a face-picked plane (#243) the basis the cutter projected with, so the cap
 * lifts back onto the actual plane. The origin is the pick point projected onto
 * the LIVE plane (`customPlaneCenter`): dragging only changes `distance`, and an
 * origin off the plane makes the lift drop the normal component.
 */
export function capOverlayBasis(custom: SectionPlane['custom']) {
  return custom
    ? { origin: customPlaneCenter(custom), tangent: custom.tangent, bitangent: custom.bitangent }
    : undefined;
}
