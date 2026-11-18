/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { LINEWEIGHT_PRESETS } from './lineweight-table';

export const ANNOTATION_STYLE_KINDS = ['grid', 'level', 'spotElevation', 'slope', 'area', 'text', 'cloud'] as const;
export type AnnotationStyleKind = typeof ANNOTATION_STYLE_KINDS[number];
export const ANNOTATION_FONTS = ['sans-serif', 'serif', 'monospace'] as const;
export type AnnotationSymbolStyle = {
  font?: typeof ANNOTATION_FONTS[number];
  textHeight?: number;
  precision?: number;
  unit?: 'm' | 'cm' | 'mm' | '%' | '°';
  color?: string;
  startSymbolId?: string;
  endSymbolId?: string;
  weight?: typeof LINEWEIGHT_PRESETS[number];
};

export function validAnnotationStyles(styles: unknown): boolean {
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return false;
  return Object.entries(styles).every(([kind, style]) => {
    if ((!ANNOTATION_STYLE_KINDS.some(value => value === kind) && kind !== 'ifc') || !style || typeof style !== 'object' || Array.isArray(style)) return false;
    const item = style as AnnotationSymbolStyle;
    const units = kind === 'slope' ? ['%', '°'] : ['m', 'cm', 'mm'];
    return (item.font === undefined || ANNOTATION_FONTS.includes(item.font))
      && (item.textHeight === undefined || (Number.isFinite(item.textHeight) && item.textHeight >= 0.5 && item.textHeight <= 12))
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
