/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { LINEWEIGHT_PRESETS } from './lineweight-table';

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
};

/** Keep styled text a fixed, readable size on screen while zooming. The
 * physical text height in mm is still used by the SVG, DXF and PDF exporters. */
export function textAnnotationScreenSize(annotation: { fontSize: number; appearance?: Pick<AnnotationSymbolStyle, 'textHeight'> }, _paperUnit: number): number {
  const heightMm = annotation.appearance?.textHeight;
  return heightMm && Number.isFinite(heightMm) && heightMm > 0
    ? Math.max(8, annotation.fontSize * heightMm / 2.5)
    : annotation.fontSize;
}

/** Shared text bounds for canvas painting, selection and click hit-testing. */
export function textAnnotationLayout(annotation: {
  text: string; fontSize: number; bold?: boolean; italic?: boolean;
  appearance?: Pick<AnnotationSymbolStyle, 'textHeight' | 'font' | 'bold' | 'italic'>;
}, paperUnit: number, measureWidth?: (text: string, font: string) => number | undefined) {
  const size = textAnnotationScreenSize(annotation, paperUnit);
  const bold = annotation.bold ?? annotation.appearance?.bold ?? false;
  const italic = annotation.italic ?? annotation.appearance?.italic ?? false;
  const font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${annotation.appearance?.font ?? 'system-ui, sans-serif'}`;
  const lines = annotation.text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const measured = measureWidth?.(line, font);
    const width = measured !== undefined && Number.isFinite(measured) && measured >= 0
      ? measured : line.length * size * 0.6;
    maxWidth = Math.max(maxWidth, width);
  }
  const padding = 6;
  const lineHeight = size * 1.3;
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
      && (item.weight === undefined || LINEWEIGHT_PRESETS.includes(item.weight));
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
