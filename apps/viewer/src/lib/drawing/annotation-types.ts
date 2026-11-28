/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { LINEWEIGHT_PRESETS, type LineweightRow } from './lineweight-table';
import { LINE_STYLE_PRESET_DASHES, type LineStylePreset, type DXFHatchLayer } from '@ifc-lite/drawing-2d';
import { isMaterialHatchPattern, type HatchPaints } from './material-hatches';
import { patternRepeatScale, type ImportedPattern } from './pattern-library';

export const ANNOTATION_STYLE_KINDS = ['grid', 'level', 'spotElevation', 'slope', 'area', 'text', 'cloud'] as const;
export type AnnotationStyleKind = typeof ANNOTATION_STYLE_KINDS[number];
export const ANNOTATION_FONTS = ['sans-serif', 'serif', 'monospace'] as const;
export type AnnotationSymbolStyle = {
  font?: typeof ANNOTATION_FONTS[number];
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  textHeight?: number;
  precision?: number;
  unit?: 'm' | 'cm' | 'mm' | '%' | '°';
  color?: string;
  startSymbolId?: string;
  endSymbolId?: string;
  weight?: typeof LINEWEIGHT_PRESETS[number];
  boundaryPattern?: LineStylePreset;
  areaFill?: HatchPaints;
  /** Optional per-style text box graphics. Absent fields keep legacy artwork. */
  textBackground?: { enabled: boolean; color?: string };
  textBorder?: { enabled: boolean; color?: string; pattern?: LineStylePreset; weight?: typeof LINEWEIGHT_PRESETS[number] };
  textLeader?: { enabled: boolean; color?: string; pattern?: LineStylePreset; weight?: typeof LINEWEIGHT_PRESETS[number]; arrowSymbolId?: string };
};

export const DETAIL_PATH_WEIGHT_MM = 0.25;

export const AREA_BOUNDARY_PATTERNS = ['solid', 'dashed', 'dotted', 'dashdot', 'center'] as const satisfies readonly LineStylePreset[];

export function areaBoundaryStyle(style?: AnnotationSymbolStyle, weights?: LineweightRow) {
  const pattern = style?.boundaryPattern;
  return {
    color: style?.color ?? '#2196F3',
    weight: style?.weight ? weights?.[style.weight] ?? 0.3 : 0.3,
    dash: pattern && AREA_BOUNDARY_PATTERNS.includes(pattern) ? LINE_STYLE_PRESET_DASHES[pattern] : [1, 0.5],
  };
}

/** Shared appearance for completed text, inline editing and style previews.
 * Undefined style properties preserve existing notes without migration. */
export function textBoxStyle(annotation: {
  appearance?: AnnotationSymbolStyle; backgroundColor: string; borderColor: string;
}, weights?: LineweightRow) {
  const background = annotation.appearance?.textBackground;
  const border = annotation.appearance?.textBorder;
  const pattern = border?.pattern;
  return {
    background: background?.enabled === false ? undefined : background?.color ?? annotation.backgroundColor,
    border: border?.enabled === false ? undefined : {
      color: border?.color ?? annotation.borderColor,
      weight: border?.weight ? weights?.[border.weight] ?? 0.15 : 0.15,
      dash: pattern && AREA_BOUNDARY_PATTERNS.includes(pattern) ? LINE_STYLE_PRESET_DASHES[pattern] : [],
    },
  };
}

function validTextBoxPaint(value: unknown, isBorder: boolean): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as NonNullable<AnnotationSymbolStyle['textBorder']>;
  return typeof item.enabled === 'boolean'
    && (item.color === undefined || (typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)))
    && (isBorder
      ? (item.pattern === undefined || AREA_BOUNDARY_PATTERNS.includes(item.pattern))
        && (item.weight === undefined || LINEWEIGHT_PRESETS.includes(item.weight))
      : item.pattern === undefined && item.weight === undefined);
}

type LeaderPoint = { x: number; y: number };

/** Offset in drawing coordinates; translating the note also translates its leader. */
export function textLeaderTip(note: { position: LeaderPoint; leaderOffset?: LeaderPoint }): LeaderPoint | undefined {
  const offset = note.leaderOffset;
  if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return undefined;
  const point = { x: note.position.x + offset.x, y: note.position.y + offset.y };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined;
}

export function defaultTextLeaderOffset(unit: number, axis: 'down' | 'front' | 'side'): LeaderPoint {
  const mm = Number.isFinite(unit) && unit > 0 ? unit : 0.1;
  return { x: (axis === 'side' ? 1 : -1) * 12 * mm, y: (axis === 'down' ? 1 : -1) * 8 * mm };
}

export function textLeaderStyle(style?: AnnotationSymbolStyle, weights?: LineweightRow) {
  const leader = style?.textLeader;
  const pattern = leader?.pattern;
  return { color: leader?.color ?? style?.color ?? '#000000',
    weight: leader?.weight ? weights?.[leader.weight] ?? 0.15 : 0.15,
    dash: pattern && AREA_BOUNDARY_PATTERNS.includes(pattern) ? LINE_STYLE_PRESET_DASHES[pattern] : [],
    arrowSymbolId: leader?.arrowSymbolId };
}

/** Screen/paper coordinates, with the same four automatic side connections at every zoom. */
export function textLeaderGeometry(box: { x: number; y: number; width: number; height: number }, tip: LeaderPoint, unit: number) {
  const { x, y, width, height } = box;
  if (![x, y, width, height, tip.x, tip.y, unit].every(Number.isFinite) || width <= 0 || height <= 0 || unit <= 0) return undefined;
  if (tip.x >= x && tip.x <= x + width && tip.y >= y && tip.y <= y + height) return undefined;
  // Only outward-facing sides qualify; a leader must never cross the text box.
  const points = [
    ...(tip.x < x ? [{ x, y: y + height / 2 }] : []),
    ...(tip.x > x + width ? [{ x: x + width, y: y + height / 2 }] : []),
    ...(tip.y < y ? [{ x: x + width / 2, y }] : []),
    ...(tip.y > y + height ? [{ x: x + width / 2, y: y + height }] : []),
  ];
  const distance = (p: LeaderPoint) => Math.hypot(p.x - tip.x, p.y - tip.y);
  const nearest = Math.min(...points.map(distance));
  const start = points.find(p => distance(p) <= nearest + unit * 0.1);
  if (!start) return undefined;
  const length = distance(start);
  if (!(length > 0)) return undefined;
  const ux = (tip.x - start.x) / length, uy = (tip.y - start.y) / length;
  const size = Math.min(2.5 * unit, length);
  const base = { x: tip.x - ux * size, y: tip.y - uy * size };
  return { start, tip, angle: Math.atan2(uy, ux) * 180 / Math.PI + 90,
    triangle: [tip, { x: base.x - uy * size * 0.28, y: base.y + ux * size * 0.28 },
      { x: base.x + uy * size * 0.28, y: base.y - ux * size * 0.28 }] };
}

/** No explicit background preserves the legacy translucent area fill. */
export function areaHasLegacyBackground(style?: AnnotationSymbolStyle): boolean {
  return !style?.areaFill?.background?.pattern && !style?.areaFill?.background?.color;
}

/** The same world/paper convention as drawingPublicationHatchStyle. */
export function areaHatchLayers(style: AnnotationSymbolStyle | undefined, scale: number,
  patterns: readonly ImportedPattern[] = []): DXFHatchLayer[] {
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const paints = style?.areaFill;
  if (!paints) return [];
  return (['background', 'foreground'] as const).flatMap<DXFHatchLayer>(side => {
    const paint = paints[side];
    if (!paint) return [];
    const pattern = paint.pattern ?? (side === 'background' && paint.color ? 'solid' : undefined);
    if (!pattern || pattern === 'none') return [];
    const base = { color: paint.color ?? '#666666', spacing: 2.5 * scale / 1000, lineWeight: 0.13 };
    if (pattern === 'solid' || pattern === 'diagonal' || pattern === 'cross-hatch') {
      return side === 'background' && pattern !== 'solid' ? [] : [{ ...base, pattern }];
    }
    if (side === 'background') return [];
    const definition = patterns.find(item => item.id === pattern);
    return definition ? [{ ...base, pattern: 'custom', spacing: patternRepeatScale(definition) * scale / 1000,
      families: definition.lines, patternKey: definition.id }] : [];
  });
}

function validAreaFill(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const paints = value as HatchPaints;
  return (['background', 'foreground'] as const).every(side => {
    const paint = paints[side];
    if (paint === undefined) return true;
    if (!paint || typeof paint !== 'object' || Array.isArray(paint)) return false;
    return (paint.color === undefined || (typeof paint.color === 'string' && /^#[0-9a-f]{6}$/i.test(paint.color)))
      && (paint.pattern === undefined || (side === 'background'
        ? paint.pattern === 'solid' || paint.pattern === 'none'
        : isMaterialHatchPattern(paint.pattern)));
  });
}

/** Match the drawing's zoom and paper height (mm). The 2.5 mm default also
 * matches the SVG, DXF and PDF exports when no text style is assigned. */
export function textAnnotationScreenSize(annotation: { fontSize: number; appearance?: Pick<AnnotationSymbolStyle, 'textHeight'> }, paperUnit: number): number {
  const heightMm = annotation.appearance?.textHeight ?? 2.5;
  return Number.isFinite(paperUnit) && paperUnit > 0 ? heightMm * paperUnit : annotation.fontSize;
}

/** Wrap at word boundaries, or at character boundaries for long unbroken words. */
export function wrapTextAnnotationLines(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    let space = '';
    for (const token of paragraph.match(/\S+|\s+/gu) ?? []) {
      if (/^\s+$/u.test(token)) {
        space += token;
        continue;
      }
      const combined = line + space + token;
      if (measure(combined) <= maxWidth) {
        line = combined;
      } else {
        if (line) { lines.push(line); line = ''; }
        // A word that does not fit even on an empty line must still be editable.
        // Array.from avoids splitting surrogate pairs (e.g. emoji).
        for (const char of Array.from(token)) {
          if (line && measure(line + char) > maxWidth) { lines.push(line); line = ''; }
          line += char;
        }
      }
      space = '';
    }
    lines.push(line + space);
  }
  return lines;
}

let paperTextMeasureContext: CanvasRenderingContext2D | null = null;
function measurePaperText(text: string, font: string): number | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    paperTextMeasureContext ??= document.createElement('canvas').getContext('2d');
    if (!paperTextMeasureContext) return undefined;
    paperTextMeasureContext.font = font;
    return paperTextMeasureContext.measureText(text).width;
  } catch { return undefined; }
}

/** Shared text bounds for canvas painting, selection, hit-testing and export. */
export function textAnnotationLayout(annotation: {
  text: string; fontSize: number; bold?: boolean; italic?: boolean; widthMm?: number;
  appearance?: Pick<AnnotationSymbolStyle, 'textHeight' | 'font' | 'bold' | 'italic'>;
}, paperUnit: number, measureWidth?: (text: string, font: string) => number | undefined) {
  const size = textAnnotationScreenSize(annotation, paperUnit);
  const bold = annotation.bold ?? annotation.appearance?.bold ?? false;
  const italic = annotation.italic ?? annotation.appearance?.italic ?? false;
  const font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${annotation.appearance?.font ?? 'system-ui, sans-serif'}`;
  const padding = Number.isFinite(paperUnit) && paperUnit > 0 ? paperUnit : 6; // 1 mm on paper
  const lineHeight = size * 1.3;
  const widthMm = annotation.widthMm;
  if (widthMm !== undefined && Number.isFinite(widthMm) && widthMm >= 6 && widthMm <= 1000) {
    // Canonical measurement resolution, independent of screen zoom or export units.
    const canonicalUnit = 10;
    const canonicalSize = textAnnotationScreenSize(annotation, canonicalUnit);
    const canonicalFont = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${canonicalSize}px ${annotation.appearance?.font ?? 'system-ui, sans-serif'}`;
    const measure = (line: string) => {
      const actual = (measureWidth ?? measurePaperText)(line, canonicalFont);
      return actual !== undefined && Number.isFinite(actual) && actual >= 0
        ? actual : Array.from(line).length * canonicalSize * 0.6;
    };
    const lines = wrapTextAnnotationLines(annotation.text, (widthMm - 2) * canonicalUnit, measure);
    return { font, lines, lineHeight, padding, bgW: widthMm * padding, bgH: lines.length * lineHeight + padding * 2 };
  }
  const lines = annotation.text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const measured = measureWidth?.(line, font);
    const width = measured !== undefined && Number.isFinite(measured) && measured >= 0
      ? measured : line.length * size * 0.6;
    maxWidth = Math.max(maxWidth, width);
  }
  return { font, lines, lineHeight, padding, bgW: maxWidth + padding * 2, bgH: lines.length * lineHeight + padding * 2 };
}

export function validAnnotationStyles(styles: unknown): boolean {
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return false;
  return Object.entries(styles).every(([kind, style]) => {
    if ((!ANNOTATION_STYLE_KINDS.some(value => value === kind) && kind !== 'ifc') || !style || typeof style !== 'object' || Array.isArray(style)) return false;
    const item = style as AnnotationSymbolStyle;
    const units = kind === 'slope' ? ['%', '°'] : ['m', 'cm', 'mm'];
    return (item.font === undefined || ANNOTATION_FONTS.includes(item.font))
      && (item.textHeight === undefined || (Number.isFinite(item.textHeight) && item.textHeight >= 0.5 && item.textHeight <= 12))
      && (item.bold === undefined || typeof item.bold === 'boolean')
      && (item.italic === undefined || typeof item.italic === 'boolean')
      && (item.align === undefined || ['left', 'center', 'right'].includes(item.align))
      && (item.precision === undefined || (Number.isInteger(item.precision) && item.precision >= 0 && item.precision <= 6))
      && (item.unit === undefined || units.includes(item.unit))
      && (item.color === undefined || (typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)))
      && [item.startSymbolId, item.endSymbolId].every(id => id === undefined || (typeof id === 'string' && id.length < 200))
      && (item.weight === undefined || LINEWEIGHT_PRESETS.includes(item.weight))
      && (item.boundaryPattern === undefined || (kind === 'area' && AREA_BOUNDARY_PATTERNS.includes(item.boundaryPattern)))
      && (item.areaFill === undefined || (kind === 'area' && validAreaFill(item.areaFill)))
      && (item.textBackground === undefined || (kind === 'text' && validTextBoxPaint(item.textBackground, false)))
      && (item.textBorder === undefined || (kind === 'text' && validTextBoxPaint(item.textBorder, true)))
      && (item.textLeader === undefined || (kind === 'text' && validTextBoxPaint(item.textLeader, true)
        && (item.textLeader.arrowSymbolId === undefined || (typeof item.textLeader.arrowSymbolId === 'string' && item.textLeader.arrowSymbolId.length < 200))));
  });
}

export type NamedAnnotationStyle = { id: string; name: string; kind: AnnotationStyleKind; style: AnnotationSymbolStyle };
export type AnnotationStyleSelection = AnnotationStyleKind | 'dimensions' | 'section' | 'elevation';

export function readAnnotationStyleLibrary(value: unknown): NamedAnnotationStyle[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.filter((entry): entry is NamedAnnotationStyle => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
      || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80
      || !ANNOTATION_STYLE_KINDS.includes(entry.kind)
      || !validAnnotationStyles({ [entry.kind]: entry.style })) return false;
    ids.add(entry.id);
    return true;
  });
}

export function annotationAppearance(kind: AnnotationStyleKind, id: string | undefined,
  styles: readonly NamedAnnotationStyle[] | undefined, fallback?: AnnotationSymbolStyle): AnnotationSymbolStyle | undefined {
  return styles?.find(entry => entry.kind === kind && entry.id === id)?.style ?? fallback;
}
