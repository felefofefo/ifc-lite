/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D, SelectedAnnotation2D } from '@/store/slices/drawing2DSlice';
import { bounds, boxContains, boxesOverlap, insideRing, segmentCrossesBox } from '@/lib/drawing/drawing-model-pick';
import { textAnnotationLayout } from '@/lib/drawing/annotation-types';
import { DEFAULT_DIMENSION_STYLE, resolveDimensionStyle, styledDimension } from '@/lib/drawing/dimension-style';
import { mapDimensionShape } from '@/lib/drawing/dimension-line';
import { generateCloudArcs } from '@/components/viewer/tools/cloudPathGenerator';
import { drawingAnnotationVisible } from '@/store/savedSectionCutsStore';
import type { DrawingViewModel } from './useDrawingViewModel';

type Shape = { points: readonly Point2D[]; closed?: boolean; filled?: boolean };
export type WindowDrawingSelection = SelectedAnnotation2D | { type: 'tag'; id: string } | { type: 'marker'; id: string };

export function isCanvasWindowAnnotation(item: WindowDrawingSelection): item is SelectedAnnotation2D {
  return item.type !== 'tag' && item.type !== 'marker';
}

/** Use only explicitly marked, rendered SVG geometry. Invisible hit targets,
 * handles, drafts and SVG filters are not part of a selection window. */
export function selectDrawingSymbols(container: HTMLDivElement | null, a: Point2D, b: Point2D): WindowDrawingSelection[] {
  if (!container) return [];
  const origin = container.getBoundingClientRect();
  const selected: WindowDrawingSelection[] = [];
  const seen = new Set<string>();
  for (const group of Array.from(container.querySelectorAll<SVGGElement>('[data-window-symbol]'))) {
    const type = group.dataset.windowSymbol;
    const id = group.dataset.windowId;
    if ((type !== 'tag' && type !== 'marker') || !id || seen.has(`${type}:${id}`)) continue;
    const shapes: Shape[] = [];
    for (const element of Array.from(group.querySelectorAll<SVGGraphicsElement>('[data-window-shape]'))) {
      const matrix = element.getScreenCTM();
      if (!matrix || !element.getClientRects().length) continue;
      const screen = (x: number, y: number): Point2D => ({
        x: matrix.a * x + matrix.c * y + matrix.e - origin.left,
        y: matrix.b * x + matrix.d * y + matrix.f - origin.top,
      });
      if (element.localName === 'line') {
        const line = element as SVGLineElement;
        shapes.push({ points: [screen(line.x1.baseVal.value, line.y1.baseVal.value), screen(line.x2.baseVal.value, line.y2.baseVal.value)] });
      } else {
        // SVG image contents are opaque to the DOM; use their transformed
        // view rectangle (also for text and the small fallback arrow).
        const box = element.getBBox();
        if (!(box.width > 0 || box.height > 0)) continue;
        shapes.push({ points: [screen(box.x, box.y), screen(box.x + box.width, box.y),
          screen(box.x + box.width, box.y + box.height), screen(box.x, box.y + box.height)], closed: true, filled: true });
      }
    }
    if (windowMatches(shapes, a, b, b.x < a.x)) {
      selected.push({ type, id });
      seen.add(`${type}:${id}`);
    }
  }
  return selected;
}
export function windowMatches(shapes: readonly Shape[], a: Point2D, b: Point2D, crossing: boolean): boolean {
  const box = bounds([a, b]);
  const valid = shapes.filter(shape => shape.points.length > 0);
  if (!valid.length) return false;
  if (!crossing) return valid.every(shape => boxContains(box, bounds(shape.points)));
  return valid.some(({ points, closed, filled }) => {
    if (!boxesOverlap(box, bounds(points))) return false;
    if (points.some(p => boxContains(box, bounds([p])))) return true;
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      if (segmentCrossesBox(points[i], points[(i + 1) % points.length], box)) return true;
    }
    return !!filled && insideRing({ x: box.minX, y: box.minY }, points);
  });
}

function rectangle(x: number, y: number, width: number, height: number): Shape {
  return { points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], closed: true, filled: true };
}

function rotatedLabel(center: Point2D, width: number, height: number, degrees: number): Shape {
  const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return { points: rectangle(-width / 2, -height / 2, width, height).points.map(p => ({
    x: center.x + p.x * cos - p.y * sin, y: center.y + p.x * sin + p.y * cos,
  })), closed: true, filled: true };
}

export function selectDrawingAnnotations(vm: DrawingViewModel, a: Point2D, b: Point2D): SelectedAnnotation2D[] {
  const { x, y, scale } = vm.markupTransform;
  if (!(scale > 0) || !vm.displayOptions.showAnnotations) return [];
  const sx = vm.drawnPlane.axis === 'side' ? -scale : scale;
  const sy = vm.drawnPlane.axis === 'down' ? scale : -scale;
  const screen = (p: Point2D): Point2D => ({ x: p.x * sx + x, y: p.y * sy + y });
  const paperUnit = vm.sheetEnabled && vm.activeSheet ? vm.viewTransform.scale : scale * (vm.publicationScale || 100) / 1000;
  const crossing = b.x < a.x;
  const selected: SelectedAnnotation2D[] = [];
  const ctx = vm.containerRef.current?.ownerDocument.createElement('canvas').getContext('2d');
  const measure = (text: string, font: string) => {
    if (!ctx) return undefined;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const add = (type: SelectedAnnotation2D['type'], id: string, shapes: Shape[]) => {
    if (windowMatches(shapes, a, b, crossing)) selected.push({ type, id });
  };
  for (const note of vm.styledNotes) {
    if (!note.text.trim()) continue;
    const p = screen(note.position);
    const layout = textAnnotationLayout(note, paperUnit, measure);
    add('text', note.id, [rectangle(p.x, p.y, layout.bgW, layout.bgH)]);
  }
  for (const area of vm.styledAreas) {
    if (area.points.length < 3) continue;
    const shapes: Shape[] = [{ points: area.points.map(screen), closed: true, filled: true }];
    const tag = vm.areaTagRects.find(item => item.id === area.id);
    if (tag) shapes.push(rectangle(tag.x, tag.y, tag.width, tag.height));
    add('polygon', area.id, shapes);
  }
  for (const cloud of vm.styledClouds) {
    if (cloud.points.length < 2) continue;
    const [p, q] = cloud.points;
    const radius = Math.min(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) * 0.15 || 0.2;
    const arcs = generateCloudArcs(p, q, radius);
    // Sample the same clockwise screen-space semicircles used by the canvas.
    const points = arcs.flatMap(arc => {
      const c = screen(arc.center), start = screen(arc.start);
      const angle = Math.atan2(start.y - c.y, start.x - c.x);
      // Canvas uses transform.scale for the radius, including sheet mode.
      const r = arc.radius * Math.abs(vm.viewTransform.scale);
      return Array.from({ length: 13 }, (_, i) => ({ x: c.x + r * Math.cos(angle + Math.PI * i / 12), y: c.y + r * Math.sin(angle + Math.PI * i / 12) }));
    });
    const shapes: Shape[] = points.length ? [{ points, closed: true, filled: true }] : [];
    if (cloud.label) {
      const center = screen({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const w = (measure(cloud.label, 'bold 12px system-ui, sans-serif') ?? cloud.label.length * 7.2) + 10;
      shapes.push(rectangle(center.x - w / 2, center.y - 10, w, 20));
    }
    add('cloud', cloud.id, shapes);
  }
  const annotationView = vm.savedView ?? (vm.viewAnnotationOptions ? { annotationOptions: vm.viewAnnotationOptions } : undefined);
  if (!drawingAnnotationVisible(annotationView, 'dimensions')) return selected;
  const chains = new Map<string, { id: string; shapes: Shape[] }>();
  const fallback = vm.dimensionSettings.styles.get(vm.dimensionSettings.library.defaultId) ?? DEFAULT_DIMENSION_STYLE;
  const labelHits = new Map(vm.dimensionEditing.dimensionLabelHits.current.map(hit => [hit.id, hit]));
  for (const item of vm.displayedMeasurements) {
    if (!drawingAnnotationVisible(annotationView, 'dimensions', item.dimension?.styleId)) continue;
    const style = resolveDimensionStyle(vm.dimensionSettings.styles, item.dimension?.styleId, fallback);
    const anchors = item.dimension?.anchors;
    const graphic = styledDimension(screen(item.start), screen(item.end),
      anchors && [screen(anchors[0]), screen(anchors[1])], style, paperUnit,
      mapDimensionShape(item.dimension?.shape, screen), vm.lineweights);
    if (!graphic) continue;
    const key = item.dimension?.chainId ? 'chain:' + item.dimension.chainId : 'item:' + item.id;
    let chain = chains.get(key);
    if (!chain) chains.set(key, chain = { id: item.id, shapes: [] });
    for (const stroke of graphic.strokes) chain.shapes.push({ points: stroke });
    for (const triangle of graphic.triangles) chain.shapes.push({ points: triangle, closed: true, filled: true });
    for (const circle of graphic.circles) {
      chain.shapes.push({ points: Array.from({ length: 24 }, (_, i) => ({
        x: circle.center.x + circle.radius * Math.cos(i * Math.PI / 12),
        y: circle.center.y + circle.radius * Math.sin(i * Math.PI / 12),
      })), closed: true, filled: circle.filled });
    }
    const label = labelHits.get(item.id);
    if (label) chain.shapes.push(rotatedLabel(label.center, label.width, label.height, label.angle));
  }
  for (const chain of chains.values()) add('measure', chain.id, chain.shapes);
  return selected;
}
