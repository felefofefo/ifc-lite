/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { LINEWEIGHT_PRESETS } from './lineweight-table';
import { MAX_TAG_SVG_SIZE, renderTagSvg } from './drawing-tag-svg';

export const TAG_CLASSES = [
  'IfcBeam', 'IfcBuildingElementPart', 'IfcBuildingElementProxy', 'IfcCableCarrierFitting',
  'IfcCableCarrierSegment', 'IfcCableFitting', 'IfcCableSegment', 'IfcChimney', 'IfcCivilElement',
  'IfcColumn', 'IfcCovering', 'IfcCurtainWall', 'IfcDamper', 'IfcDistributionChamberElement',
  'IfcDoor', 'IfcDuctFitting', 'IfcDuctSegment', 'IfcDuctSilencer', 'IfcElectricAppliance',
  'IfcElectricDistributionBoard', 'IfcElementAssembly', 'IfcFan', 'IfcFireSuppressionTerminal',
  'IfcFlowController', 'IfcFlowFitting', 'IfcFlowMeter', 'IfcFlowMovingDevice', 'IfcFlowSegment',
  'IfcFlowStorageDevice', 'IfcFlowTerminal', 'IfcFlowTreatmentDevice', 'IfcFooting', 'IfcFurniture',
  'IfcGeographicElement', 'IfcGrid', 'IfcLightFixture', 'IfcMember', 'IfcOpeningElement', 'IfcOutlet',
  'IfcPavement', 'IfcPile', 'IfcPipeFitting', 'IfcPipeSegment', 'IfcPlate', 'IfcPump', 'IfcRailing',
  'IfcRamp', 'IfcRampFlight', 'IfcReinforcingBar', 'IfcReinforcingMesh', 'IfcRoof', 'IfcSanitaryTerminal',
  'IfcShadingDevice', 'IfcSign', 'IfcSlab', 'IfcSpace', 'IfcStair', 'IfcStairFlight', 'IfcSwitchingDevice',
  'IfcTrackElement', 'IfcTransportElement', 'IfcUnitaryEquipment', 'IfcValve', 'IfcWall', 'IfcWindow',
] as const;
export type TagClass = string;
export type TagFolder = { id: string; name: string };
export const SYMBOL_USES = ['ifc', 'free', 'section', 'elevation', 'level', 'grid', 'slope', 'spotElevation'] as const;
export type SymbolUse = typeof SYMBOL_USES[number];
export type TagTemplate = { id: string; name: string; folderId?: string; classes: TagClass[]; svg: string; use?: SymbolUse };

export const MARKER_LINE_TYPES = ['solid', 'dashed', 'dash-dot'] as const;
export type MarkerLineStyle = {
  extent: 'full' | 'ends';
  pattern: typeof MARKER_LINE_TYPES[number];
  weight: typeof LINEWEIGHT_PRESETS[number];
  color: string;
  startLength?: number;
  endLength?: number;
};
export const DEFAULT_MARKER_LINE: MarkerLineStyle = { extent: 'full', pattern: 'dashed', weight: 'medium', color: '#000000' };

export const DEFAULT_MARKER_END_LENGTH = 8;
function markerEndLength(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readMarkerLine(value: unknown): MarkerLineStyle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const line = value as Partial<MarkerLineStyle>;
  return {
    extent: line.extent === 'ends' ? 'ends' : 'full',
    pattern: MARKER_LINE_TYPES.find(item => item === line.pattern) ?? DEFAULT_MARKER_LINE.pattern,
    weight: LINEWEIGHT_PRESETS.find(item => item === line.weight) ?? DEFAULT_MARKER_LINE.weight,
    startLength: markerEndLength(line.startLength),
    endLength: markerEndLength(line.endLength),
    color: typeof line.color === 'string' && /^#[0-9a-f]{6}$/i.test(line.color) ? line.color : DEFAULT_MARKER_LINE.color,
  };
}

export type MarkerStyle = {
  id: string; name: string; kind: 'section' | 'elevation';
  symbolId: string; // Final endpoint for sections, midpoint for elevations.
  startSymbolId?: string;
  line?: MarkerLineStyle;
};
export type MarkerSlot = 'start' | 'end' | 'center';
type MarkerSymbols = { symbolId?: string; styleId?: string; kind: MarkerStyle['kind']; name: string; code: string };

export function isPlacedSymbol(use: SymbolUse) {
  return use !== 'ifc' && use !== 'section' && use !== 'elevation';
}

export function symbolFitsView(use: SymbolUse, axis: 'down' | 'front' | 'side') {
  if (use === 'level') return axis !== 'down';
  if (use === 'grid' || use === 'spotElevation') return axis === 'down';
  return true;
}

export const symbolUse = (template: TagTemplate): SymbolUse => template.use ?? 'ifc';

export function resolveMarkerHeads(
  templates: readonly TagTemplate[], marker: MarkerSymbols,
  styles: readonly MarkerStyle[] = [], angle = 0,
) {
  const style = marker.styleId ? styles.find(item => item.id === marker.styleId && item.kind === marker.kind) : undefined;
  const ids: [MarkerSlot, string | undefined][] = marker.kind === 'section'
    ? [['start', style?.startSymbolId], ['end', style?.symbolId ?? marker.symbolId]]
    : [['center', style?.symbolId ?? marker.symbolId]];
  const values = new Map([['ViewCode', marker.code], ['ViewName', marker.name]]);
  return ids.flatMap(([slot, id]) => {
    const template = templates.find(item => item.id === id && symbolUse(item) === marker.kind);
    if (!template) return [];
    try {
      return [{ slot, graphic: renderTagSvg(template.svg, values, angle) }];
    } catch {
      return [];
    }
  });
}

export type TagLibrary = {
  folders: TagFolder[];
  templates: TagTemplate[];
  markerStyles?: MarkerStyle[];
  defaultMarkerStyles?: Partial<Record<MarkerStyle['kind'], string>>;
};

export function defaultMarkerStyleId(library: TagLibrary, kind: string | undefined): string | undefined {
  if (kind !== 'section' && kind !== 'elevation') return undefined;
  const id = library.defaultMarkerStyles?.[kind];
  return library.markerStyles?.some(style => style.id === id && style.kind === kind) ? id : undefined;
}

export const EMPTY_TAG_LIBRARY: TagLibrary = { folders: [], templates: [] };

export function drawingTagClass(name: string): TagClass | undefined {
  const canonical = name.replace(/StandardCase$/i, '');
  if (!/^Ifc[A-Z][A-Za-z0-9]*$/i.test(canonical)) return undefined;
  return TAG_CLASSES.find(value => value.toLowerCase() === canonical.toLowerCase()) ??
    'Ifc' + canonical.charAt(3).toUpperCase() + canonical.slice(4);
}

export function readTagLibrary(value: unknown): TagLibrary {
  if (!value || typeof value !== 'object') return EMPTY_TAG_LIBRARY;
  const data = value as Partial<TagLibrary>;
  const folders = Array.isArray(data.folders) ? data.folders.filter(isNamed) : [];
  const seen = new Set<string>();
  const templates = Array.isArray(data.templates) ? data.templates.flatMap(item => {
    if (!isNamed(item) || seen.has(item.id) || typeof item.svg !== 'string' || item.svg.length > MAX_TAG_SVG_SIZE
      || !Array.isArray(item.classes)) return [];
    const classes = [...new Set(item.classes.flatMap(type => {
      const normalized = typeof type === 'string' ? drawingTagClass(type) : undefined;
      return normalized ? [normalized] : [];
    }))];
    const use = SYMBOL_USES.find(value => value === item.use) ?? 'ifc';
    if (use === 'ifc' && !classes.length) return [];
    seen.add(item.id);
    const folderId = folders.some(folder => folder.id === item.folderId) ? item.folderId : undefined;
    return [{ id: item.id, name: item.name, svg: item.svg, use, classes, folderId }];
  }) : [];
  const markerStyles = Array.isArray(data.markerStyles) ? data.markerStyles.flatMap(style => {
    if (!isNamed(style) || (style.kind !== 'section' && style.kind !== 'elevation')) return [];
    const valid = (id: unknown) => templates.some(template => template.id === id && symbolUse(template) === style.kind);
    const symbolId = valid(style.symbolId) ? style.symbolId : '';
    const startSymbolId = style.kind === 'section' && valid(style.startSymbolId) ? style.startSymbolId : undefined;
    const line = style.kind === 'section' ? readMarkerLine(style.line) : undefined;
    return symbolId || startSymbolId || line
      ? [{ id: style.id, name: style.name, kind: style.kind, symbolId, startSymbolId, line }]
      : [];
  }) : [];
  const library = { folders, templates, markerStyles, defaultMarkerStyles: data.defaultMarkerStyles };
  return { ...library, defaultMarkerStyles: {
    section: defaultMarkerStyleId(library, 'section'), elevation: defaultMarkerStyleId(library, 'elevation'),
  } };
}

function isNamed(value: unknown): value is TagFolder {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TagFolder>;
  return typeof item.id === 'string' && !!item.id && typeof item.name === 'string' && !!item.name.trim();
}

export function removeTagFolder(library: TagLibrary, folderId: string): TagLibrary {
  return {
    ...library,
    folders: library.folders.filter(folder => folder.id !== folderId),
    templates: library.templates.map(template => template.folderId === folderId ? { ...template, folderId: undefined } : template),
  };
}
