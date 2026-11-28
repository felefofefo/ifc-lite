/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { effectiveMetadataRecord, extractPropertiesOnDemand, extractQuantitiesOnDemand } from '@ifc-lite/parser';
import type { Drawing2D, DXFExportOptions, Point2D } from '@ifc-lite/drawing-2d';
import type { jsPDF } from 'jspdf';
import { resolveEntityRef, useViewerStore } from '@/store';
import { resolveEntityRefGlobalId } from '@/store/resolveEntityRef';
import { MAX_TAG_SVG_SIZE, renderTagSvg, tagLeaderEnd } from './drawing-tag-svg';
import { drawingTagClass, isPlacedSymbol, symbolUse, type SymbolUse, type TagClass, type TagTemplate } from './drawing-tag-library';
import { ANNOTATION_STYLE_KINDS, type AnnotationStyleKind, type AnnotationSymbolStyle } from './annotation-types';
import type { LineweightRow } from './lineweight-table';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';
import { roomFootprintArea, type DrawingIfcSpaceRoom } from './ifc-space-rooms';
import type { PolygonArea2DResult } from '@/store/slices/drawing2DSlice';
import { computePolygonSurfaceCentroid } from '@/components/viewer/tools/computePolygonArea';

export interface DrawingElementTag {
  id: string;
  drawOrder?: number;
  globalId: string;
  projectId: string;
  fingerprint: string;
  field: string;
  svg?: string;
  templateId?: string;
  free?: true;
  gridStart?: Point2D;
  appearanceId?: string;
  measurement?: { kind: 'spotElevation' | 'slope'; tolerance: number };
  position: Point2D;
  anchorOffset: Point2D;
  leader: boolean;
}

type Segment = readonly [Point2D, Point2D];
type Polygon = Drawing2D['cutPolygons'][number]['polygon'];
type EntityRef = ReturnType<typeof resolveEntityRef>;

export interface TagTarget {
  ifcClass: TagClass;
  id: number;
  ref: EntityRef;
  globalId: string;
  projectId: string;
  fingerprint: string;
  center: Point2D;
  segments: Segment[];
  polygons: Polygon[];
  /** Explicitly distinct from NetFloorArea in the IFC. */
  planArea?: number;
}

function formattedSymbolValue(input: string, kind: SymbolUse, style?: AnnotationSymbolStyle): string {
  if (!style || (kind !== 'level' && kind !== 'spotElevation' && kind !== 'slope')) return input;
  const value = parseFloat(input);
  if (!Number.isFinite(value)) return input;
  if (kind === 'slope') {
    if (input.endsWith('°')) return input;
    const unit = style.unit ?? '%';
    const number = unit === '°' ? Math.atan(value / 100) * 180 / Math.PI : value;
    return number.toFixed(style.precision ?? 1) + unit;
  }
  const unit = style.unit ?? 'm';
  const number = value * (unit === 'mm' ? 1000 : unit === 'cm' ? 100 : 1);
  return number.toFixed(style.precision ?? 3) + ' ' + unit;
}

export interface ResolvedDrawingTag {
  tag: DrawingElementTag;
  hostUnavailable?: true;
  text: string;
  anchor: Point2D;
  style?: AnnotationSymbolStyle;
  lineWidth?: number;
  startGraphic?: ReturnType<typeof renderTagSvg>;
  hideEnd?: boolean;
  graphic?: ReturnType<typeof renderTagSvg>;
}

const isPoint = (value: unknown): value is Point2D => {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<Point2D>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
};

export function readDrawingTags(value: unknown): DrawingElementTag[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is DrawingElementTag => row && typeof row === 'object'
    && typeof row.id === 'string' && typeof row.globalId === 'string'
    && typeof row.projectId === 'string' && typeof row.fingerprint === 'string'
    && (row.free === true
      ? typeof row.templateId === 'string' && !!row.templateId && row.leader === false
      : row.free === undefined && !!row.globalId && !!(row.projectId || row.fingerprint))
    && typeof row.field === 'string' && typeof row.leader === 'boolean'
    && (row.templateId === undefined || typeof row.templateId === 'string')
    && (row.svg === undefined || (typeof row.svg === 'string' && row.svg.length <= MAX_TAG_SVG_SIZE))
    && (row.measurement === undefined || (row.free === true &&
      (row.measurement?.kind === 'spotElevation' || row.measurement?.kind === 'slope') &&
      Number.isFinite(row.measurement.tolerance) && row.measurement.tolerance >= 0))
    && (row.appearanceId === undefined || typeof row.appearanceId === 'string')
    && (row.gridStart === undefined || (row.free === true && isPoint(row.gridStart)))
    && isPoint(row.position) && isPoint(row.anchorOffset));
}

const dataFor = (ref: EntityRef) => {
  const state = useViewerStore.getState();
  const model = state.models.get(ref.modelId);
  return { model, data: ref.modelId === 'legacy' ? state.ifcDataStore : model?.ifcDataStore,
    mutations: state.mutationViews.get(ref.modelId === 'legacy' ? '__legacy__' : ref.modelId) };
};

export function collectTagTargets(drawing: Drawing2D, showHidden: boolean, rooms: readonly DrawingIfcSpaceRoom[] = []): TagTarget[] {
  const geometry = new Map<number, { ifcClass: TagClass; segments: Segment[]; polygons: Polygon[] }>();
  function entry(id: number, ifcClass: TagClass) {
    const existing = geometry.get(id);
    if (existing) return existing;
    const next = { ifcClass, segments: [] as Segment[], polygons: [] as Polygon[] };
    geometry.set(id, next);
    return next;
  }
  for (const polygon of [...drawing.cutPolygons, ...(drawing.projectionPolygons ?? [])]) {
    const ifcClass = drawingTagClass(polygon.ifcType);
    if (ifcClass) entry(polygon.entityId, ifcClass).polygons.push(polygon.polygon);
  }
  for (const line of drawing.lines) {
    const ifcClass = drawingTagClass(line.ifcType);
    if (ifcClass && (showHidden || (line.visibility !== 'hidden' && line.category !== 'hidden'))) {
      entry(line.entityId, ifcClass).segments.push([line.line.start, line.line.end]);
    }
  }
  // IFC spaces may be hidden from the architectural cut but remain taggable.
  const roomAreas = new Map<number, number>();
  for (const room of rooms) {
    const area = roomFootprintArea(room.polygons);
    if (area !== undefined) roomAreas.set(room.id, area);
    const target = entry(room.id, 'IfcSpace');
    if (!target.polygons.length) target.polygons.push(...room.polygons);
  }
  return Array.from(geometry, ([id, shape]): TagTarget | null => {
    const ref = resolveEntityRef(id);
    const globalId = resolveEntityRefGlobalId(ref);
    const { model, data } = dataFor(ref);
    const project = data?.spatialHierarchy?.project?.expressId;
    const projectId = project === undefined ? '' : data?.entities.getGlobalId(project) || '';
    const fingerprint = model?.sourceFingerprint || model?.sourceContentHash || '';
    if (!globalId || !(projectId || fingerprint)) return null;
    const points = [...shape.segments.flat(), ...shape.polygons.flatMap(polygon => polygon.outer)];
    const bounds = points.reduce((b, point) => ({
      left: Math.min(b.left, point.x), right: Math.max(b.right, point.x),
      top: Math.min(b.top, point.y), bottom: Math.max(b.bottom, point.y),
    }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
    const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
    if (!isPoint(center)) return null;
    return { id, ref, globalId, projectId, fingerprint, center, ...shape, planArea: roomAreas.get(id) };
  }).filter((target): target is TagTarget => target !== null);
}

function inside(p: Point2D, ring: readonly Point2D[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function distanceToSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const x = b.x - a.x, y = b.y - a.y;
  const length2 = x * x + y * y;
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * x + (point.y - a.y) * y) / length2)) : 0;
  return Math.hypot(point.x - a.x - t * x, point.y - a.y - t * y);
}

export function pickTagTarget(targets: readonly TagTarget[], point: Point2D, tolerance: number): TagTarget | undefined {
  let nearest: TagTarget | undefined;
  let best = Infinity;
  for (const target of targets) {
    let distance = Infinity;
    for (const [a, b] of target.segments) distance = Math.min(distance, distanceToSegment(point, a, b));
    for (const polygon of target.polygons) {
      if (inside(point, polygon.outer) && !polygon.holes.some(hole => inside(point, hole))) distance = 0;
      for (const ring of [polygon.outer, ...polygon.holes]) {
        ring.forEach((a, i) => { distance = Math.min(distance, distanceToSegment(point, a, ring[(i + 1) % ring.length])); });
      }
    }
    if (distance > tolerance) continue;
    const score = distance + Math.min(tolerance, Math.hypot(point.x - target.center.x, point.y - target.center.y)) * 0.001;
    if (score < best) { best = score; nearest = target; }
  }
  return nearest;
}

export function findTagTarget(targets: readonly TagTarget[], tag: DrawingElementTag): TagTarget | undefined {
  if (tag.free) return undefined;
  const candidates = targets.filter(target => target.globalId === tag.globalId &&
    ((tag.projectId && target.projectId === tag.projectId) || (tag.fingerprint && target.fingerprint === tag.fingerprint)));
  const original = candidates.filter(target => tag.fingerprint && target.fingerprint === tag.fingerprint);
  return original.length === 1 ? original[0] : candidates.length === 1 ? candidates[0] : undefined;
}

export function tagFields(target: TagTarget, svgValues?: Map<string, string>): { key: string; label: string; value: string }[] {
  const { data, mutations } = dataFor(target.ref);
  if (!data) return [];
  const id = target.ref.expressId;
  const record = effectiveMetadataRecord(data, id, mutations);
  if (!record || !drawingTagClass(record.type)) return [];
  const text = (value: unknown) => ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value).replace(/\s+/g, ' ').trim() : '';
  const attr = (name: string) => text(record.attributes[record.names.indexOf(name)]);
  const sets = mutations ? mutations.getForEntity(id) : extractPropertiesOnDemand(data, id);
  const mark = sets.flatMap(set => set.properties).find(prop => prop.name === 'Mark' && text(prop.value));
  const fields = [
    { key: 'mark', label: 'Mark', value: attr('Tag') || text(mark?.value) },
    { key: 'name', label: 'Name', value: attr('Name') },
    ...(record.type.toLowerCase() === 'ifcspace'
      ? [{ key: 'long-name', label: 'Long name', value: attr('LongName') }] : []),
    { key: 'object-type', label: 'Object type', value: attr('ObjectType') },
    { key: 'class', label: 'IFC class', value: record.type },
  ];
  if (svgValues) {
    record.names.forEach((name, index) => {
      const value = text(record.attributes[index]);
      if (value) svgValues.set(name, value);
    });
    svgValues.set('GlobalId', target.globalId);
    svgValues.set('IfcClass', record.type);
    if (fields[0].value) svgValues.set('Mark', fields[0].value);
  }
  const seen = new Set<string>();
  for (const set of sets) for (const prop of set.properties) {
    const key = JSON.stringify([set.name, prop.name]);
    const value = text(prop.value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    fields.push({ key, label: set.name + ' / ' + prop.name, value });
    svgValues?.set(set.name + '.' + prop.name, value);
  }
  // Keep IFC quantities in the source units and expose unambiguous short
  // names in SVG templates. A projected area is a separate derived field.
  if (record.type.toLowerCase() === 'ifcspace') {
    const aliases = new Map<string, string | null>();
    for (const set of extractQuantitiesOnDemand(data, id)) {
      for (const quantity of set.quantities) {
        if (!Number.isFinite(quantity.value)) continue;
        const value = String(quantity.value);
        const key = JSON.stringify([set.name, quantity.name]);
        if (!seen.has(key)) {
          seen.add(key);
          fields.push({ key, label: set.name + ' / ' + quantity.name, value });
          svgValues?.set(set.name + '.' + quantity.name, value);
        }
        if (!aliases.has(quantity.name)) aliases.set(quantity.name, value);
        else if (aliases.get(quantity.name) !== value) aliases.set(quantity.name, null);
      }
    }
    for (const [name, value] of aliases) {
      if (value !== null && !svgValues?.has(name)) svgValues?.set(name, value);
    }
    if (target.planArea !== undefined && Number.isFinite(target.planArea) && target.planArea > 0) {
      const value = target.planArea.toFixed(2) + ' m²';
      fields.push({ key: 'plan-area', label: 'Projected plan area (m²)', value });
      svgValues?.set('PlanArea', value);
    }
  }
  return fields.filter(field => field.value);
}

export function drawingHeight(plane: Drawing2D['config']['plane'], point: Point2D): number {
  const basis = plane.customPlane;
  return basis ? basis.origin.y + point.x * basis.tangent.y + point.y * basis.bitangent.y : point.y;
}

export function measurementLabel(kind: 'spotElevation' | 'slope', value: number): string {
  return kind === 'spotElevation' ? value.toFixed(3) + ' m'
    : Number.isFinite(value) ? value.toFixed(1) + '%' : '90°';
}

export function measureDrawingSymbol(
  kind: 'spotElevation' | 'slope', drawing: Drawing2D | null, point: Point2D, tolerance: number,
): string | undefined {
  if (!drawing) return undefined;
  const plane = drawing.config.plane;
  if (plane.axis === 'y' && !plane.customPlane) {
    let nearest = Infinity;
    let grade = 0;
    // The projection engine emits visible planar pieces and their depths.
    for (const { polygon, vertexDepths, isCut } of drawing.projectionPolygons ?? []) {
      const { outer, holes } = polygon;
      if (isCut || !vertexDepths || vertexDepths.length !== outer.length ||
        !inside(point, outer) || holes.some(hole => inside(point, hole))) continue;
      const a = outer[0], z = vertexDepths[0];
      for (let index = 2; index < outer.length; index++) {
        const b = outer[index - 1], c = outer[index];
        const dx = b.x - a.x, dy = b.y - a.y, ex = c.x - a.x, ey = c.y - a.y;
        const det = dx * ey - dy * ex;
        if (Math.abs(det) < 1e-12) continue;
        const dz = vertexDepths[index - 1] - z, ez = vertexDepths[index] - z;
        const gx = (dz * ey - ez * dy) / det, gy = (dx * ez - ex * dz) / det;
        const depth = z + gx * (point.x - a.x) + gy * (point.y - a.y);
        if (Number.isFinite(depth) && depth < nearest) {
          nearest = depth;
          grade = Math.hypot(gx, gy) * 100;
        }
        break;
      }
    }
    if (!Number.isFinite(nearest) || drawing.cutPolygons.some(({ polygon }) =>
      inside(point, polygon.outer) && !polygon.holes.some(hole => inside(point, hole)))) return undefined;
    return measurementLabel(kind, kind === 'slope' ? grade : plane.position + (plane.flipped ? nearest : -nearest));
  }

  if (kind !== 'slope') return undefined;
  let best = tolerance;
  let slope: number | undefined;
  for (const edge of drawing.lines) {
    if (edge.visibility === 'hidden' || edge.category === 'hidden' || edge.overhead) continue;
    const { start, end } = edge.line;
    const planarLength = Math.hypot(end.x - start.x, end.y - start.y);
    if (planarLength < 1e-8) continue;
    const distance = distanceToSegment(point, start, end);
    if (distance > best || (slope !== undefined && distance === best)) continue;
    const depth = (edge.depthEnd ?? edge.depth) - edge.depth;
    const rise = drawingHeight(plane, end) - drawingHeight(plane, start) +
      depth * (plane.customPlane?.normal.y ?? 0) * (plane.flipped ? 1 : -1);
    const run = Math.sqrt(Math.max(0, planarLength ** 2 + depth ** 2 - rise ** 2));
    best = distance;
    slope = run < 1e-8 ? Infinity : Math.abs(rise) * 100 / run;
  }
  return slope === undefined ? undefined : measurementLabel(kind, slope);
}

export function resolveFreeSymbol(tag: DrawingElementTag, templates: readonly TagTemplate[], options?: Partial<Record<AnnotationStyleKind | 'ifc', AnnotationSymbolStyle>>, weights?: LineweightRow): ResolvedDrawingTag | null {
  const template = templates.find(item => item.id === tag.templateId && isPlacedSymbol(symbolUse(item)));
  if (!template) return null;
  const use = symbolUse(template);
  const kind = ANNOTATION_STYLE_KINDS.find(value => value === use);
  const style = kind && options?.[kind];
  const label = formattedSymbolValue(tag.field, use, style);
  const field = use === 'grid' ? 'Grid' : use === 'slope' ? 'Slope' : 'Elevation';
  const values = use === 'free' ? new Map<string, string>() : new Map([[field, label]]);
  try {
    const grid = use === 'grid';
    const marker = (id: string | undefined) => templates.find(item => item.id === id && symbolUse(item) === 'grid');
    const start = grid && tag.gridStart ? marker(style?.startSymbolId) : undefined;
    const end = grid ? marker(style?.endSymbolId) ?? template : template;
    const hideEnd = grid && style?.endSymbolId === '';
    return {
      tag, anchor: tag.gridStart ?? tag.position, hideEnd,
      startGraphic: start && renderTagSvg(start.svg, values),
      graphic: hideEnd ? undefined : renderTagSvg(end.svg, values),
      style, lineWidth: style?.weight && weights?.[style.weight], text: label || template.name,
    };
  } catch {
    return null;
  }
}

export function resolveDrawingTag(
  tag: DrawingElementTag, target: TagTarget, fields?: ReturnType<typeof tagFields>,
  templates?: readonly TagTemplate[], style?: AnnotationSymbolStyle,
): ResolvedDrawingTag {
  let graphic: ResolvedDrawingTag['graphic'];
  const template = tag.templateId
    ? (templates ?? useSavedSectionCuts.getState().tagLibrary.templates).find(item => item.id === tag.templateId)
    : undefined;
  const svg = template?.svg ?? tag.svg;
  if (svg) {
    const values = new Map<string, string>();
    fields = tagFields(target, values);
    try { graphic = renderTagSvg(svg, values); } catch { /* Fall back to the original field. */ }
  }
  return {
    tag, graphic, style, text: graphic?.text || (fields ?? tagFields(target)).find(field => field.key === tag.field)?.value || '\u2014',
    anchor: { x: target.center.x + tag.anchorOffset.x, y: target.center.y + tag.anchorOffset.y },
  };
}

/** A missing target is not necessarily deleted: it may be outside this view.
 * Keep a selectable placeholder without inventing IFC values or a leader tip. */
export function unresolvedDrawingTag(tag: DrawingElementTag): ResolvedDrawingTag {
  return { tag, hostUnavailable: true, anchor: tag.position, text: 'Host unavailable' };
}

/** Rebind only identity and leader reference; keep label position and all style data. */
export function rehostDrawingTag(tag: DrawingElementTag, target: TagTarget, point: Point2D): DrawingElementTag | undefined {
  if (tag.free || tag.gridStart || !target.globalId || !(target.projectId || target.fingerprint)
    || !isPoint(point) || !isPoint(target.center)) return undefined;
  if (tag.globalId === target.globalId && tag.projectId === target.projectId && tag.fingerprint === target.fingerprint) return tag;
  const anchorOffset = { x: point.x - target.center.x, y: point.y - target.center.y };
  if (!isPoint(anchorOffset)) return undefined;
  return { ...tag, globalId: target.globalId, projectId: target.projectId, fingerprint: target.fingerprint, anchorOffset };
}

/** Reuse Space-compatible SVGs without pretending an authored polygon is IFC. */
export function isAreaTagTemplate(template: TagTemplate): boolean {
  return symbolUse(template) === 'ifc' && template.classes.includes('IfcSpace');
}

export function areaTagValues(area: Pick<PolygonArea2DResult, 'area' | 'perimeter' | 'tagName'>): Map<string, string> {
  const name = area.tagName?.trim() || 'Area';
  const value = area.area.toFixed(2);
  return new Map([
    ['Name', name], ['LongName', name],
    ['Area', value + ' m²'], ['PlanArea', value + ' m²'],
    // Compatibility with Space templates that add their own unit suffix.
    ['NetFloorArea', value], ['Perimeter', area.perimeter.toFixed(2) + ' m'],
  ]);
}

export function resolveAreaTag(area: PolygonArea2DResult, templates: readonly TagTemplate[]): ResolvedDrawingTag | undefined {
  const template = templates.find(item => item.id === area.tagTemplateId && isAreaTagTemplate(item));
  if (!template || area.points.length < 3 || !Number.isFinite(area.area) || area.area <= 0
    || !Number.isFinite(area.perimeter)) return undefined;
  const center = computePolygonSurfaceCentroid(area.points);
  const anchor = area.tagLeaderOffset
    ? { x: center.x + area.tagLeaderOffset.x, y: center.y + area.tagLeaderOffset.y } : center;
  const position = area.tagPosition ?? center;
  if (!isPoint(position) || !isPoint(anchor)) return undefined;
  const values = areaTagValues(area);
  try {
    const graphic = renderTagSvg(template.svg, values);
    // Only a derived export/render item; not a persisted IFC entity tag.
    const tag: DrawingElementTag = { id: area.id, templateId: template.id,
      globalId: '', projectId: '', fingerprint: '', free: true, field: 'area',
      position, anchorOffset: { x: 0, y: 0 }, leader: area.tagLeader === true };
    return { tag, anchor, graphic, text: graphic.text || values.get('PlanArea') || '' };
  } catch { return undefined; }
}

/** Same screen rectangle for paint, point picking and window selection. */
export function areaTagScreenRect(item: ResolvedDrawingTag, screen: (point: Point2D) => Point2D, paperUnit: number) {
  const graphic = item.graphic;
  if (!graphic || !(paperUnit > 0) || !Number.isFinite(paperUnit)) return undefined;
  const p = screen(item.tag.position);
  return { id: item.tag.id, href: graphic.href, x: p.x - graphic.anchor.x * paperUnit,
    y: p.y - graphic.anchor.y * paperUnit, width: graphic.width * paperUnit, height: graphic.height * paperUnit,
    leader: item.tag.leader ? { start: screen(item.anchor), end: tagLeaderEnd(graphic, p, screen(item.anchor), paperUnit) } : undefined };
}

const tagHeight = 2.5;
const ink = '#000000';
type Mapper = (x: number, y: number) => Point2D;

export function tagExportBounds(bounds: Drawing2D['bounds'], tags: readonly ResolvedDrawingTag[], scale: number) {
  const result = { min: { ...bounds.min }, max: { ...bounds.max } };
  const unit = (scale || 100) / 1000;
  for (const { tag, text, anchor, graphic, startGraphic, style } of tags) {
    if (startGraphic) {
      result.min.x = Math.min(result.min.x, anchor.x - Math.max(startGraphic.anchor.x, startGraphic.width - startGraphic.anchor.x) * unit);
      result.max.x = Math.max(result.max.x, anchor.x + Math.max(startGraphic.anchor.x, startGraphic.width - startGraphic.anchor.x) * unit);
      result.min.y = Math.min(result.min.y, anchor.y - Math.max(startGraphic.anchor.y, startGraphic.height - startGraphic.anchor.y) * unit);
      result.max.y = Math.max(result.max.y, anchor.y + Math.max(startGraphic.anchor.y, startGraphic.height - startGraphic.anchor.y) * unit);
    }
    const left = (graphic?.anchor.x ?? Math.max(1, text.length / 2) * (style?.textHeight ?? tagHeight)) * unit;
    const top = (graphic?.anchor.y ?? style?.textHeight ?? tagHeight) * unit;
    const right = graphic ? graphic.width * unit - left : left;
    const bottom = graphic ? graphic.height * unit - top : top;
    result.min.x = Math.min(result.min.x, tag.position.x - Math.max(left, right), anchor.x);
    result.min.y = Math.min(result.min.y, tag.position.y - top, tag.position.y - bottom, anchor.y);
    result.max.x = Math.max(result.max.x, tag.position.x + Math.max(left, right), anchor.x);
    result.max.y = Math.max(result.max.y, tag.position.y + top, tag.position.y + bottom, anchor.y);
  }
  return result;
}

/** Inline the already-sanitized tag artwork in exported SVGs. SVG-as-image resources
 * cannot reliably load another SVG-as-image, so <image href="data:image/svg+xml">
 * renders the leader but often drops the tag or grid heads in standalone files. */
function inlineDrawingTagGraphic(graphic: NonNullable<ResolvedDrawingTag['graphic']>, point: Point2D, unit: number): string {
  const prefix = 'data:image/svg+xml;charset=utf-8,';
  if (!graphic.href.startsWith(prefix)) return '';
  const x = point.x - graphic.anchor.x * unit;
  const y = point.y - graphic.anchor.y * unit;
  const width = graphic.width * unit;
  const height = graphic.height * unit;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return '';
  try {
    // renderTagSvg has already sanitized this source and substituted its fields.
    const source = decodeURIComponent(graphic.href.slice(prefix.length));
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    const svg = document.documentElement;
    if (svg.namespaceURI !== 'http://www.w3.org/2000/svg' || svg.localName !== 'svg'
      || document.querySelector('parsererror')) return '';
    // Artwork authored without a viewBox uses CSS pixels as its coordinates.
    // Preserve that coordinate system when replacing its paper dimensions.
    if (!svg.hasAttribute('viewBox')) {
      const originalWidth = Number(svg.getAttribute('width'));
      const originalHeight = Number(svg.getAttribute('height'));
      if (!(originalWidth > 0 && originalHeight > 0)) return '';
      svg.setAttribute('viewBox', `0 0 ${originalWidth} ${originalHeight}`);
    }
    svg.setAttribute('x', String(x));
    svg.setAttribute('y', String(y));
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    return new XMLSerializer().serializeToString(svg);
  } catch {
    return '';
  }
}

export function drawingTagsSvg(tags: readonly ResolvedDrawingTag[], map: Mapper, unit: number, escape: (s: string) => string) {
  if (!tags.length) return '';
  return '<g id="ifc-tags" fill="' + ink + '" font-family="Arial,sans-serif" font-size="' + tagHeight * unit + '">' +
    tags.map(({ tag, text, anchor, graphic, startGraphic, hideEnd, style, lineWidth }) => {
      const p = map(tag.position.x, tag.position.y), a = map(anchor.x, anchor.y);
      const leader = tag.leader || tag.gridStart ? '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + p.x + '" y2="' + p.y +
        '" stroke="' + (style?.color ?? ink) + '" stroke-width="' + (lineWidth ?? 0.18) * unit + '"/>' : '';
      const start = startGraphic ? inlineDrawingTagGraphic(startGraphic, a, unit) : '';
      if (hideEnd) return leader + start;
      if (graphic) return leader + start + inlineDrawingTagGraphic(graphic, p, unit);
      return leader + '<text font-family="' + (style?.font ?? 'sans-serif') + '" font-size="' + ((style?.textHeight ?? tagHeight) * unit) + '" x="' + p.x + '" y="' + p.y + '" text-anchor="middle" dominant-baseline="middle">' + escape(text) + '</text>';
    }).join('') + '</g>\n';
}

export function addDrawingTagsDxf(options: DXFExportOptions, tags: readonly ResolvedDrawingTag[], scale: number): DXFExportOptions {
  if (!tags.length) return options;
  const layer = 'IFC-TAGS';
  const leaders = tags.filter(({ tag }) => tag.leader || tag.gridStart).map(({ tag, anchor, style }, index) =>
    ({ name: style?.color ? `IFC-TAGS-${index + 1}` : layer,
      color: style?.color ?? ink, polylines: [[anchor, tag.position]], closed: false }));
  return {
    ...options,
    polylineLayers: [...(options.polylineLayers ?? []), { name: layer, color: ink, polylines: leaders.filter(item => item.name === layer).flatMap(item => item.polylines), closed: false },
      ...leaders.filter(item => item.name !== layer)],
    labels: [...(options.labels ?? []), ...tags.filter(({ tag }) => !tag.free || tag.field).flatMap(({ tag, text, style, hideEnd, startGraphic, anchor }) =>
      [...(startGraphic ? [anchor] : []), ...(hideEnd ? [] : [tag.position])].map(position =>
        ({ layer, color: ink, text, position, height: (style?.textHeight ?? tagHeight) * scale / 1000 })))],
  };
}

export function drawDrawingTagsPdf(doc: jsPDF, tags: readonly ResolvedDrawingTag[], map: Mapper): void {
  if (!tags.length) return;
  doc.setDrawColor(ink);
  doc.setTextColor(ink);
  doc.setLineWidth(0.18);
  doc.setLineDashPattern([], 0);
  const font = doc.getFont();
  for (const { tag, text, anchor, style, lineWidth, startGraphic, hideEnd } of tags) {
    doc.setFont(style?.font === 'serif' ? 'times' : style?.font === 'monospace' ? 'courier' : 'helvetica');
    doc.setFontSize((style?.textHeight ?? tagHeight) * 72 / 25.4);
    doc.setDrawColor(style?.color ?? ink);
    doc.setLineWidth(lineWidth ?? 0.18);
    if (tag.free && !tag.field) continue;
    const p = map(tag.position.x, tag.position.y);
    if (tag.leader || tag.gridStart) {
      const a = map(anchor.x, anchor.y);
      doc.line(a.x, a.y, p.x, p.y);
    }
    if (startGraphic) {
      const start = map(anchor.x, anchor.y);
      doc.text(text, start.x, start.y, { align: 'center', baseline: 'middle' });
    }
    if (!hideEnd) doc.text(text, p.x, p.y, { align: 'center', baseline: 'middle' });
  }
  doc.setFont(font.fontName, font.fontStyle);
}
