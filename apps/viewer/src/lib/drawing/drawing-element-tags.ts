/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { effectiveMetadataRecord, extractPropertiesOnDemand } from '@ifc-lite/parser';
import type { Drawing2D, DXFExportOptions, Point2D } from '@ifc-lite/drawing-2d';
import type { jsPDF } from 'jspdf';
import { resolveEntityRef, useViewerStore } from '@/store';
import { resolveEntityRefGlobalId } from '@/store/resolveEntityRef';
import { MAX_TAG_SVG_SIZE, renderTagSvg } from './drawing-tag-svg';
import { drawingTagClass, isPlacedSymbol, symbolUse, type TagClass, type TagTemplate } from './drawing-tag-library';
import { useSavedSectionCuts } from '@/store/savedSectionCutsStore';

export interface DrawingElementTag {
  id: string;
  globalId: string;
  projectId: string;
  fingerprint: string;
  field: string;
  svg?: string;
  templateId?: string;
  free?: true;
  gridStart?: Point2D;
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
}

export interface ResolvedDrawingTag {
  tag: DrawingElementTag;
  text: string;
  anchor: Point2D;
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
    && (row.gridStart === undefined || (row.free === true && isPoint(row.gridStart)))
    && isPoint(row.position) && isPoint(row.anchorOffset));
}

const dataFor = (ref: EntityRef) => {
  const state = useViewerStore.getState();
  const model = state.models.get(ref.modelId);
  return { model, data: ref.modelId === 'legacy' ? state.ifcDataStore : model?.ifcDataStore,
    mutations: state.mutationViews.get(ref.modelId === 'legacy' ? '__legacy__' : ref.modelId) };
};

export function collectTagTargets(drawing: Drawing2D, showHidden: boolean): TagTarget[] {
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
    return { id, ref, globalId, projectId, fingerprint, center, ...shape };
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

export function resolveFreeSymbol(tag: DrawingElementTag, templates: readonly TagTemplate[]): ResolvedDrawingTag | null {
  const template = templates.find(item => item.id === tag.templateId && isPlacedSymbol(symbolUse(item)));
  if (!template) return null;
  const use = symbolUse(template);
  const field = use === 'grid' ? 'Grid' : use === 'slope' ? 'Slope' : 'Elevation';
  const values = use === 'free' ? new Map<string, string>() : new Map([[field, tag.field]]);
  try {
    return { tag, anchor: tag.gridStart ?? tag.position, graphic: renderTagSvg(template.svg, values),
      text: tag.field || template.name };
  } catch {
    return null;
  }
}

export function resolveDrawingTag(
  tag: DrawingElementTag, target: TagTarget, fields?: ReturnType<typeof tagFields>,
  templates?: readonly TagTemplate[],
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
    tag, graphic, text: graphic?.text || (fields ?? tagFields(target)).find(field => field.key === tag.field)?.value || '\u2014',
    anchor: { x: target.center.x + tag.anchorOffset.x, y: target.center.y + tag.anchorOffset.y },
  };
}

const tagHeight = 2.5;
const ink = '#000000';
type Mapper = (x: number, y: number) => Point2D;

export function tagExportBounds(bounds: Drawing2D['bounds'], tags: readonly ResolvedDrawingTag[], scale: number) {
  const result = { min: { ...bounds.min }, max: { ...bounds.max } };
  const unit = (scale || 100) / 1000;
  for (const { tag, text, anchor, graphic } of tags) {
    const left = (graphic?.anchor.x ?? Math.max(1, text.length / 2) * tagHeight) * unit;
    const top = (graphic?.anchor.y ?? tagHeight) * unit;
    const right = graphic ? graphic.width * unit - left : left;
    const bottom = graphic ? graphic.height * unit - top : top;
    result.min.x = Math.min(result.min.x, tag.position.x - Math.max(left, right), anchor.x);
    result.min.y = Math.min(result.min.y, tag.position.y - top, tag.position.y - bottom, anchor.y);
    result.max.x = Math.max(result.max.x, tag.position.x + Math.max(left, right), anchor.x);
    result.max.y = Math.max(result.max.y, tag.position.y + top, tag.position.y + bottom, anchor.y);
  }
  return result;
}

export function drawingTagsSvg(tags: readonly ResolvedDrawingTag[], map: Mapper, unit: number, escape: (s: string) => string) {
  if (!tags.length) return '';
  return '<g id="ifc-tags" fill="' + ink + '" font-family="Arial,sans-serif" font-size="' + tagHeight * unit + '">' +
    tags.map(({ tag, text, anchor, graphic }) => {
      const p = map(tag.position.x, tag.position.y), a = map(anchor.x, anchor.y);
      const leader = tag.leader || tag.gridStart ? '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + p.x + '" y2="' + p.y +
        '" stroke="' + ink + '" stroke-width="' + 0.18 * unit + '"/>' : '';
      if (graphic) {
        const width = graphic.width * unit, height = graphic.height * unit;
        return leader + '<image x="' + (p.x - graphic.anchor.x * unit) + '" y="' + (p.y - graphic.anchor.y * unit) +
          '" width="' + width + '" height="' + height + '" href="' + escape(graphic.href) + '"/>';
      }
      return leader + '<text x="' + p.x + '" y="' + p.y + '" text-anchor="middle" dominant-baseline="middle">' + escape(text) + '</text>';
    }).join('') + '</g>\n';
}

export function addDrawingTagsDxf(options: DXFExportOptions, tags: readonly ResolvedDrawingTag[], scale: number): DXFExportOptions {
  if (!tags.length) return options;
  const layer = 'IFC-TAGS';
  const leaders = tags.filter(({ tag }) => tag.leader || tag.gridStart).map(({ tag, anchor }) => [anchor, tag.position]);
  return {
    ...options,
    polylineLayers: [...(options.polylineLayers ?? []), { name: layer, color: ink, polylines: leaders, closed: false }],
    labels: [...(options.labels ?? []), ...tags.filter(({ tag }) => !tag.free || tag.field).map(({ tag, text }) =>
      ({ layer, color: ink, text, position: tag.position, height: tagHeight * scale / 1000 }))],
  };
}

export function drawDrawingTagsPdf(doc: jsPDF, tags: readonly ResolvedDrawingTag[], map: Mapper): void {
  if (!tags.length) return;
  doc.setDrawColor(ink);
  doc.setTextColor(ink);
  doc.setLineWidth(0.18);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(tagHeight * 72 / 25.4);
  for (const { tag, text, anchor } of tags) {
    if (tag.free && !tag.field) continue;
    const p = map(tag.position.x, tag.position.y);
    if (tag.leader || tag.gridStart) {
      const a = map(anchor.x, anchor.y);
      doc.line(a.x, a.y, p.x, p.y);
    }
    doc.text(text, p.x, p.y, { align: 'center', baseline: 'middle' });
  }
}
