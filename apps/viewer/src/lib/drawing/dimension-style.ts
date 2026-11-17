/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { dimensionArc, dimensionLine, type DimensionShape } from './dimension-line';
import { LINEWEIGHT_PRESETS, lineweightsAtScale, type LineweightRow } from './lineweight-table';

export const DIMENSION_UNITS = ['project', 'm', 'cm', 'mm'] as const;
export const DIMENSION_TERMINATORS = ['tick', 'arrow', 'filledArrow', 'dot', 'circle', 'bar', 'none'] as const;
export const DIMENSION_SIZE_FIELDS = {
  textMm: { min: 0.5, max: 10, step: 0.1 },
  strokeMm: { min: 0.05, max: 2, step: 0.01 },
  tickMm: { min: 0.5, max: 8, step: 0.1 },
  labelGapMm: { min: 0, max: 10, step: 0.1 },
  extensionMm: { min: 0, max: 10, step: 0.1 },
} as const;

export type DimensionSizeField = keyof typeof DIMENSION_SIZE_FIELDS;
type Terminator = typeof DIMENSION_TERMINATORS[number];

export const DIMENSION_FONTS = {
  Arial: 'Arial, sans-serif',
  Verdana: 'Verdana, sans-serif',
  Georgia: 'Georgia, serif',
  'Courier New': 'Courier New, monospace',
} as const;

export type DimensionStyle = Record<DimensionSizeField, number> & {
  fontFamily: keyof typeof DIMENSION_FONTS;
  lineweight?: keyof LineweightRow;
  startTerminator: Terminator;
  endTerminator: Terminator;
  lineColor: string | null;
  textColor: string | null;
  unit: typeof DIMENSION_UNITS[number];
  decimalPlaces: number | null;
  showUnit: boolean;
};

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = {
  lineweight: 'light', strokeMm: 0.18, tickMm: 1.5, labelGapMm: 1.5, textMm: 2.5, extensionMm: 0,
  fontFamily: 'Arial',
  startTerminator: 'tick', endTerminator: 'tick', lineColor: null, textColor: null, unit: 'project', decimalPlaces: null, showUnit: true,
};

export function applyDimensionSizeEdits(
  base: DimensionStyle, edits: Partial<Record<DimensionSizeField, string>>,
) {
  const style = { ...base };
  const invalid: DimensionSizeField[] = [];
  for (const field of Object.keys(edits) as DimensionSizeField[]) {
    const raw = edits[field]?.trim();
    const value = Number(raw);
    const { min, max } = DIMENSION_SIZE_FIELDS[field];
    if (raw && Number.isFinite(value) && value >= min && value <= max) style[field] = value;
    else invalid.push(field);
  }
  return { style, invalid };
}

export function readDimensionStyle(raw: string | null): DimensionStyle {
  const style = { ...DEFAULT_DIMENSION_STYLE };
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return style;
    const data = value as Record<string, unknown>;
    for (const field of Object.keys(DIMENSION_SIZE_FIELDS) as DimensionSizeField[]) {
      const { min, max } = DIMENSION_SIZE_FIELDS[field];
      const size = data[field];
      if (typeof size === 'number' && size >= min && size <= max) style[field] = size;
    }
    const fallbackWeights = lineweightsAtScale({}, 100);
    const legacyWeight = (weight: keyof LineweightRow) => Math.abs(style.strokeMm - fallbackWeights[weight]);
    style.lineweight = LINEWEIGHT_PRESETS.find(weight => weight === data.lineweight)
      ?? LINEWEIGHT_PRESETS.reduce((best, weight) => legacyWeight(weight) < legacyWeight(best) ? weight : best);
    const oldTerminator = DIMENSION_TERMINATORS.find(mark => mark === data.terminator);
    for (const end of ['startTerminator', 'endTerminator'] as const) {
      style[end] = DIMENSION_TERMINATORS.find(mark => mark === data[end]) ?? oldTerminator ?? style[end];
    }
    for (const field of ['lineColor', 'textColor'] as const) {
      const color = data[field];
      if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) style[field] = color;
    }
    if (data.unit === 'project' || data.unit === 'm' || data.unit === 'cm' || data.unit === 'mm') style.unit = data.unit;
    if (typeof data.decimalPlaces === 'number' && Number.isInteger(data.decimalPlaces) &&
      data.decimalPlaces >= 0 && data.decimalPlaces <= 6) style.decimalPlaces = data.decimalPlaces;
    if (typeof data.showUnit === 'boolean') style.showUnit = data.showUnit;
    if (typeof data.fontFamily === 'string' && Object.hasOwn(DIMENSION_FONTS, data.fontFamily)) {
      style.fontFamily = data.fontFamily as keyof typeof DIMENSION_FONTS;
    }
  } catch (error) {
    console.warn('Could not read the saved dimension style', error);
  }
  return style;
}

export function formatDimensionLabel(
  distance: number, style: DimensionStyle,
  projectFormatter: (distance: number, precision: number | null, showUnit: boolean) => string,
  kind?: DimensionShape['kind'],
): string {
  if (kind === 'angular') return Number(distance.toFixed(style.decimalPlaces ?? 1)) + '\u00B0';
  const prefix = kind === 'radius' ? 'R' : kind === 'diameter' ? '\u00D8' : '';
  if (style.unit === 'project') return prefix + projectFormatter(distance, style.decimalPlaces, style.showUnit);
  const { unit, showUnit, decimalPlaces } = style;
  const scale = { m: 1, cm: 100, mm: 1000 }[unit];
  const digits = decimalPlaces ?? { m: 3, cm: 1, mm: 0 }[unit];
  return prefix + `${(distance * scale).toFixed(digits)}${showUnit ? ` ${unit}` : ''}`;
}

type Point = { x: number; y: number };
type Stroke = readonly [Point, Point];

export function styledDimension(start: Point, end: Point, anchors: [Point, Point] | undefined, style: DimensionStyle, paperUnit: number, shape?: DimensionShape, lineweights?: LineweightRow) {
  const markSize = style.tickMm * paperUnit;
  const graphic = dimensionLine(start, end, markSize, style.labelGapMm * paperUnit);
  if (!graphic) return null;
  const arc = shape?.kind === 'angular' ? dimensionArc(start, end, shape.center, shape.label) : null;
  const strokes: Stroke[] = arc ? arc.slice(1).map((point, i): Stroke => [arc[i], point]) : [[start, end]];
  const triangles: [Point, Point, Point][] = [];
  const circles: { center: Point; radius: number; filled: boolean }[] = [];

  if (anchors) {
    [start, end].forEach((point, index) => {
      const anchor = anchors[index];
      const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      if (!length) return;
      const extra = style.extensionMm * paperUnit / length;
      strokes.push([anchor, { x: point.x + (point.x - anchor.x) * extra, y: point.y + (point.y - anchor.y) * extra }]);
    });
  }
  const drawEnd = (mark: Terminator, tip: Point, other: Point, tick: Stroke) => {
    if (mark === 'none') return;
    if (mark === 'tick') {
      strokes.push(tick);
      return;
    }
    if (mark === 'circle' || mark === 'dot') {
      circles.push({ center: tip, radius: markSize / 2, filled: mark === 'dot' });
      return;
    }
    const length = Math.hypot(other.x - tip.x, other.y - tip.y);
    if (mark === 'bar') {
      const x = (other.y - tip.y) / length * markSize / 2;
      const y = (tip.x - other.x) / length * markSize / 2;
      strokes.push([{ x: tip.x - x, y: tip.y - y }, { x: tip.x + x, y: tip.y + y }]);
      return;
    }
    const size = Math.min(markSize, length / 2);
    const x = (other.x - tip.x) / length * size;
    const y = (other.y - tip.y) / length * size;
    const left = { x: tip.x + x - y * 0.4, y: tip.y + y + x * 0.4 };
    const right = { x: tip.x + x + y * 0.4, y: tip.y + y - x * 0.4 };
    if (mark === 'filledArrow') triangles.push([tip, left, right]);
    else strokes.push([tip, left], [tip, right]);
  };
  // The same sides are used even if the user clicked the geometry in reverse.
  const first = shape ? true : start.x < end.x || (start.x === end.x && start.y < end.y);
  const drawArcEnd = (mark: Terminator, at: Point, next: Point) => {
    const dx = next.x - at.x, dy = next.y - at.y;
    const span = Math.hypot(dx, dy);
    if (!span) return;
    const factor = Math.hypot(end.x - start.x, end.y - start.y) / span;
    const other = { x: at.x + dx * factor, y: at.y + dy * factor };
    const tick = dimensionLine(at, other, markSize, 0)?.ticks[0];
    if (tick) drawEnd(mark, at, other, tick);
  };
  if (arc) {
    drawArcEnd(style.startTerminator, start, arc[1]);
    drawArcEnd(style.endTerminator, end, arc[arc.length - 2]);
  } else {
    if (shape?.kind !== 'radius') drawEnd(style.startTerminator, first ? start : end, first ? end : start, graphic.ticks[first ? 0 : 1]);
    drawEnd(style.endTerminator, first ? end : start, first ? start : end, graphic.ticks[first ? 1 : 0]);
  }

  let label = graphic.label;
  const gap = style.labelGapMm * paperUnit;
  if (shape?.kind === 'angular') {
    const dx = shape.label.x - shape.center.x, dy = shape.label.y - shape.center.y;
    const radius = Math.hypot(dx, dy);
    if (radius) label = { x: shape.label.x + dx * gap / radius, y: shape.label.y + dy * gap / radius };
  } else if (shape) {
    label = { x: shape.label.x, y: shape.label.y - gap };
  }
  const width = lineweights?.[style.lineweight ?? 'light'] ?? style.strokeMm;
  return { strokes, triangles, circles, label, lineWidth: width * paperUnit, textSize: style.textMm * paperUnit };
}

export function drawDimensionStrokes(ctx: CanvasRenderingContext2D, graphic: NonNullable<ReturnType<typeof styledDimension>>) {
  ctx.beginPath();
  for (const [from, to] of graphic.strokes) {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.setLineDash([]);
  for (const [tip, left, right] of graphic.triangles) {
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
  }
  for (const { center, radius, filled } of graphic.circles) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    if (filled) ctx.fill();
    else ctx.stroke();
  }
}

export const ARCHITECTURAL_DIMENSION_TYPE = 'architectural';

export interface NamedDimensionStyle {
  id: string;
  name: string;
  style: DimensionStyle;
}

export interface DimensionStyleLibrary {
  types: NamedDimensionStyle[];
  defaultId: string;
}

export function readDimensionStyleLibrary(raw: string | null): DimensionStyleLibrary {
  const library: DimensionStyleLibrary = {
    types: [{ id: ARCHITECTURAL_DIMENSION_TYPE, name: '', style: DEFAULT_DIMENSION_STYLE }],
    defaultId: ARCHITECTURAL_DIMENSION_TYPE,
  };
  if (!raw) return library;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 2 || !Array.isArray(data.types)) {
      library.types[0].style = readDimensionStyle(raw);
      return library;
    }
    const ids = new Set<string>();
    for (const type of data.types) {
      if (!type || typeof type.id !== 'string' || !type.id || ids.has(type.id) ||
        typeof type.name !== 'string' || (type.id !== ARCHITECTURAL_DIMENSION_TYPE && !type.name.trim())) continue;
      ids.add(type.id);
      const entry = { id: type.id, name: type.name, style: readDimensionStyle(JSON.stringify(type.style) ?? null) };
      if (entry.id === ARCHITECTURAL_DIMENSION_TYPE) library.types[0] = entry;
      else library.types.push(entry);
    }
    if (library.types.some(type => type.id === data.defaultId)) library.defaultId = data.defaultId;
  } catch (error) {
    console.warn('Could not read dimension types', error);
  }
  return library;
}

export interface DimensionLabelHit {
  id: string;
  center: Point;
  width: number;
  height: number;
  angle: number;
}

export function hitDimensionLabel(hit: DimensionLabelHit, point: Point): boolean {
  const x = point.x - hit.center.x;
  const y = point.y - hit.center.y;
  const angle = hit.angle * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Math.abs(x * cos + y * sin) <= hit.width / 2 &&
    Math.abs(-x * sin + y * cos) <= hit.height / 2;
}

export function resolveDimensionStyle(styles: ReadonlyMap<string, DimensionStyle> | undefined, id: string | undefined, fallback: DimensionStyle) {
  return styles?.get(id ?? ARCHITECTURAL_DIMENSION_TYPE) ?? styles?.get(ARCHITECTURAL_DIMENSION_TYPE) ?? fallback;
}
