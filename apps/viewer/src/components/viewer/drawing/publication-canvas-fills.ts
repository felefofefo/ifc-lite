/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { DrawingPolygon, DXFHatchLayer, Point2D } from '@ifc-lite/drawing-2d';

export function drawPublicationCanvasFills(
  ctx: CanvasRenderingContext2D, polygon: DrawingPolygon, paints: readonly DXFHatchLayer[],
  map: (x: number, y: number) => Point2D, worldToTarget: number, mmToTarget: number, orientation = 1,
) {
  if (!paints.length || polygon.polygon.outer.length < 3) return;
  const rings = [polygon.polygon.outer, ...polygon.polygon.holes].map((ring) => ring.map(({ x, y }) => map(x, y)));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of rings[0]) {
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
  ctx.clip('evenodd');
  for (const paint of paints) {
    if (paint.pattern === 'solid') {
      ctx.fillStyle = paint.color;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
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
      const phase = polygon.isCut ? from : anchor.x - sign * anchor.y;
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
