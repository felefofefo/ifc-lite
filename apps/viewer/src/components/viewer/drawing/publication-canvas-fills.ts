/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { patternSegments, surfacePatternSegments, type DrawingPolygon, type DXFHatchLayer, type Point2D } from '@ifc-lite/drawing-2d';

export function drawPublicationCanvasFills(
  ctx: CanvasRenderingContext2D, polygon: DrawingPolygon, paints: readonly DXFHatchLayer[],
  map: (x: number, y: number) => Point2D, worldToTarget: number, mmToTarget: number, orientation = 1, regions?: readonly DrawingPolygon[],
) {
  if (!paints.length || polygon.polygon.outer.length < 3) return;
  const rings = (regions ? regions.map(region => region.polygon.outer) : [polygon.polygon.outer, ...polygon.polygon.holes]).map((ring) => ring.map(({ x, y }) => map(x, y)));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of rings.flat()) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    ctx.moveTo(ring[0].x, ring[0].y);
    for (const { x, y } of ring.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
  }
  ctx.clip(regions ? 'nonzero' : 'evenodd');
  for (const paint of paints) {
    if (paint.pattern === 'solid') {
      ctx.fillStyle = paint.color;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      continue;
    }
    if (regions && polygon.surfacePatternTransform) {
      ctx.strokeStyle = paint.color;
      ctx.lineWidth = (paint.lineWeight ?? 0.13) * mmToTarget;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const region of regions) for (const { start, end } of surfacePatternSegments(region, { ...paint, pattern: paint.pattern })) {
        const a = map(start.x, start.y), b = map(end.x, end.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      continue;
    }
    if (paint.pattern === 'custom') {
      ctx.strokeStyle = paint.color;
      ctx.lineWidth = (paint.lineWeight ?? 0.13) * mmToTarget;
      ctx.setLineDash([]);
      const anchor = map(0, 0);
      const local = (p: Point2D) => ({ x: p.x - anchor.x, y: (p.y - anchor.y) * orientation });
      ctx.beginPath();
      for (const { start, end } of patternSegments({ outer: [
        { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
      ].map(local), holes: [] }, paint.families ?? [], paint.spacing * worldToTarget)) {
        ctx.moveTo(start.x + anchor.x, start.y * orientation + anchor.y);
        ctx.lineTo(end.x + anchor.x, end.y * orientation + anchor.y);
      }
      ctx.stroke();
      continue;
    }
    const gap = paint.spacing * worldToTarget * Math.SQRT2;
    const span = maxX - minX + maxY - minY;
    if (!Number.isFinite(gap) || gap <= 0 || span / gap > 10_000) continue;
    ctx.strokeStyle = paint.color;
    ctx.lineWidth = (paint.lineWeight ?? 0.13) * mmToTarget;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const sign of paint.pattern === 'cross-hatch' ? [-1, 1] : [-orientation]) {
      const from = minX + (sign === 1 ? -maxY : minY);
      const to = maxX + (sign === 1 ? -minY : maxY);
      const anchor = map(0, 0);
      const phase = polygon.isCut && !polygon.cutOutline ? from : anchor.x - sign * anchor.y;
      const first = phase + Math.floor((from - phase) / gap) * gap;
      const steps = Math.ceil((to - first) / gap);
      for (let step = 0; step <= steps; step++) {
        const intercept = first + step * gap;
        ctx.moveTo(intercept + sign * minY, minY);
        ctx.lineTo(intercept + sign * maxY, maxY);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw equal surface paints in one clip to remove antialiased triangle seams. */
export function drawPublicationSurfaces(
  ctx: CanvasRenderingContext2D, polygons: readonly DrawingPolygon[],
  resolve: (polygon: DrawingPolygon, fallback: string) => readonly DXFHatchLayer[] | undefined,
  map: (x: number, y: number) => Point2D, worldToTarget: number, mmToTarget: number, orientation = 1,
) {
  const groups = new Map<string, { paints: readonly DXFHatchLayer[]; regions: DrawingPolygon[] }>();
  for (const polygon of polygons) {
    const paints = resolve(polygon, '#666666');
    if (!paints?.length) continue;
    const key = JSON.stringify([paints, !!polygon.surfacePatternTransform]);
    const group = groups.get(key);
    if (group) group.regions.push(polygon);
    else groups.set(key, { paints, regions: [polygon] });
  }
  for (const { paints, regions } of groups.values()) {
    drawPublicationCanvasFills(ctx, regions[0], paints, map, worldToTarget, mmToTarget, orientation, regions);
  }
}
