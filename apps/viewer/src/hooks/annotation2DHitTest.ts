/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hit-testing for 2D annotations (cloud, text, polygon area, measure),
 * split out of `useAnnotation2D.ts` to keep that hook under its
 * module-size budget and to make the hit-test resolution independently
 * unit-testable.
 *
 * Resolution has two passes rather than a single first-match-by-type scan
 * (see #4195, #4198):
 *
 *  1. GENUINE hits — the click falls inside a shape's actual rendered
 *     extent (a cloud's true bbox, a text box, a polygon's centroid
 *     label). Checked in reverse paint order (cloud -> text -> polygon),
 *     each array walked backwards, so the topmost item wins when shapes
 *     genuinely overlap.
 *  2. PADDED hits — the click is only within a type's click-tolerance
 *     padding (a cloud's bbox expanded by HIT_TEST_RADIUS_PX, a polygon
 *     edge or measure line within threshold px). Resolved by nearest
 *     distance across ALL padded candidates, not by paint order or type.
 *
 * Pass 1 always wins over pass 2: a genuine hit on a lower shape must not
 * be stolen by a higher shape's padding-only "near miss". Without this
 * split, a cloud's padded bbox (checked first for paint order) could hit-
 * test a click that is actually well inside a neighbouring text box and
 * outside the cloud's drawn extent — a real regression, not merely a
 * cosmetic one, because `handleMouseDown`/delete act on whatever this
 * function returns.
 */

import { dimensionArc } from '@/lib/drawing/dimension-line';
import { pathDisplayPoints } from '@/lib/drawing/sketch-input';
import { canvasMarkupGroups } from '@/lib/drawing/drawing-arrange';
import type {
  Point2D, TextAnnotation2D, SelectedAnnotation2D,
  Measure2DResult, PolygonArea2DResult, CloudAnnotation2D,
} from '@/store/slices/drawing2DSlice';
import { insideRing } from '@/lib/drawing/drawing-model-pick';
import { textAnnotationLayout, textLeaderTip, textLeaderGeometry } from '@/lib/drawing/annotation-types';

/** Nearest point on segment a-b to p, in drawing coordinates. */
export function nearestPointOnSegment(
  p: Point2D, a: Point2D, b: Point2D
): { point: Point2D; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) {
    return { point: a, dist: Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const nearest = { x: a.x + t * dx, y: a.y + t * dy };
  return { point: nearest, dist: Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2) };
}

/** Distance from p to the nearest point on segment a-b, in screen coordinates. */
function nearestPointOnScreenSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.01) {
    return { dist: Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const nx = a.x + t * dx;
  const ny = a.y + t * dy;
  return { dist: Math.sqrt((p.x - nx) ** 2 + (p.y - ny) ** 2) };
}

export interface HitTestAnnotationsParams {
  screenX: number;
  screenY: number;
  threshold: number;
  drawingToScreen: (pt: Point2D) => { x: number; y: number };
  texts: TextAnnotation2D[];
  clouds: CloudAnnotation2D[];
  polys: PolygonArea2DResult[];
  measures: Measure2DResult[];
  paperUnit?: number;
  dimensionLabelId?: string;
  genuineOnly?: boolean;
  areaTagRects?: readonly { id: string; x: number; y: number; width: number; height: number; leader?: { start: Point2D; end: Point2D } }[];
  measureText?: (text: string, font: string) => number | undefined;
}

/** A padded-tier candidate: a hit that only registers via click tolerance. */
interface PaddedCandidate {
  dist: number;
  selection: SelectedAnnotation2D;
}

export function hitTestAnnotations({
  screenX, screenY, threshold, drawingToScreen, texts, clouds, polys, measures,
  paperUnit = 1, measureText, areaTagRects = [], dimensionLabelId, genuineOnly = false,
}: HitTestAnnotationsParams): SelectedAnnotation2D | null {
  // ── Pass 1: genuine hits, reverse paint order (topmost wins) ───────────
  const ranks = new Map<string, number>();
  canvasMarkupGroups(measures, polys, texts, clouds).forEach((group, rank) => {
    for (const entry of group.entries) ranks.set(`${entry.type}:${entry.item.id}`, rank);
  });
  let genuine: SelectedAnnotation2D | null = null;
  let genuineRank = -1;
  function offer(selection: SelectedAnnotation2D) {
    const rank = ranks.get(`${selection.type}:${selection.id}`) ?? -1;
    if (rank > genuineRank) { genuine = selection; genuineRank = rank; }
  }
  if (dimensionLabelId) offer({ type: 'measure', id: dimensionLabelId, dimensionLabel: true });
  // The Area Tag is painted at its polygon's rank, not in an always-front
  // overlay. Resolve genuine rectangle hits in the same common order.
  for (let i = areaTagRects.length - 1; i >= 0; i--) {
    const rect = areaTagRects[i];
    if (screenX >= rect.x && screenX <= rect.x + rect.width
      && screenY >= rect.y && screenY <= rect.y + rect.height
      && polys.some(area => area.id === rect.id)) offer({ type: 'polygon', id: rect.id });
  }
  for (let i = clouds.length - 1; i >= 0; i--) {
    const cloud = clouds[i];
    if (cloud.points.length < 2) continue;
    const sp1 = drawingToScreen(cloud.points[0]);
    const sp2 = drawingToScreen(cloud.points[1]);
    const minX = Math.min(sp1.x, sp2.x);
    const maxX = Math.max(sp1.x, sp2.x);
    const minY = Math.min(sp1.y, sp2.y);
    const maxY = Math.max(sp1.y, sp2.y);
    if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
      offer({ type: 'cloud', id: cloud.id });
    }
  }

  for (let i = texts.length - 1; i >= 0; i--) {
    const annotation = texts[i];
    if (!annotation.text.trim()) continue;
    const sp = drawingToScreen(annotation.position);
    const { bgW, bgH } = textAnnotationLayout(annotation, paperUnit, measureText);
    if (screenX >= sp.x - 2 && screenX <= sp.x + bgW + 2 &&
        screenY >= sp.y - 2 && screenY <= sp.y + bgH + 2) {
      offer({ type: 'text', id: annotation.id });
    }
  }

  for (let i = polys.length - 1; i >= 0; i--) {
    const result = polys[i];
    if (result.pathClosed === undefined && result.points.length >= 3 && insideRing({ x: screenX, y: screenY }, result.points.map(drawingToScreen))) {
      offer({ type: 'polygon', id: result.id });
    }
  }

  // ── Pass 2: padded (tolerance-only) hits, nearest wins across types ────

  let best: PaddedCandidate | null = null;
  function preferred(candidate: SelectedAnnotation2D, distance: number, previous: PaddedCandidate | null) {
    return !previous || distance < previous.dist || (distance === previous.dist
      && (ranks.get(`${candidate.type}:${candidate.id}`) ?? -1) > (ranks.get(`${previous.selection.type}:${previous.selection.id}`) ?? -1));
  }

  for (let i = clouds.length - 1; i >= 0; i--) {
    const cloud = clouds[i];
    if (cloud.points.length < 2) continue;
    const sp1 = drawingToScreen(cloud.points[0]);
    const sp2 = drawingToScreen(cloud.points[1]);
    const minX = Math.min(sp1.x, sp2.x);
    const maxX = Math.max(sp1.x, sp2.x);
    const minY = Math.min(sp1.y, sp2.y);
    const maxY = Math.max(sp1.y, sp2.y);
    const dx = Math.max(minX - screenX, 0, screenX - maxX);
    const dy = Math.max(minY - screenY, 0, screenY - maxY);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < threshold && preferred({ type: 'cloud', id: cloud.id }, dist, best)) {
      best = { dist, selection: { type: 'cloud', id: cloud.id } };
    }
  }

  for (let i = polys.length - 1; i >= 0; i--) {
    const result = polys[i];
    const origin = drawingToScreen({ x: 0, y: 0 }), unit = drawingToScreen({ x: 1, y: 0 });
    const scale = Math.hypot(unit.x - origin.x, unit.y - origin.y);
    const points = pathDisplayPoints(result, 0.2 / Math.max(1, scale));
    if (points.length < (result.pathClosed === false ? 2 : 3)) continue;
    for (let j = 0; j < points.length - (result.pathClosed === false ? 1 : 0); j++) {
      const a = drawingToScreen(points[j]);
      const b = drawingToScreen(points[(j + 1) % points.length]);
      const { dist } = nearestPointOnScreenSegment({ x: screenX, y: screenY }, a, b);
      if (result.pathClosed !== undefined && dist <= 1) offer({ type: 'polygon', id: result.id });
      if (dist < threshold && preferred({ type: 'polygon', id: result.id }, dist, best)) {
        best = { dist, selection: { type: 'polygon', id: result.id } };
      }
    }
  }

  for (const note of texts) {
    const tip = textLeaderTip(note);
    if (!tip || !note.text.trim()) continue;
    const p = drawingToScreen(note.position);
    const { bgW, bgH } = textAnnotationLayout(note, paperUnit, measureText);
    const leader = textLeaderGeometry({ ...p, width: bgW, height: bgH }, drawingToScreen(tip), paperUnit);
    if (!leader) continue;
    const { dist } = nearestPointOnScreenSegment({ x: screenX, y: screenY }, leader.start, leader.tip);
    const selection: SelectedAnnotation2D = { type: 'text', id: note.id };
    if (dist <= 1) offer(selection);
    if (dist < threshold && preferred(selection, dist, best)) best = { dist, selection };
  }
  for (const rect of areaTagRects) {
    if (!rect.leader || !polys.some(area => area.id === rect.id)) continue;
    const { dist } = nearestPointOnScreenSegment({ x: screenX, y: screenY }, rect.leader.start, rect.leader.end);
    const selection: SelectedAnnotation2D = { type: 'polygon', id: rect.id };
    if (dist <= 1) offer(selection);
    if (dist < threshold && preferred(selection, dist, best)) best = { dist, selection };
  }
  for (let i = measures.length - 1; i >= 0; i--) {
    const result = measures[i];
    const sa = drawingToScreen(result.start);
    const sb = drawingToScreen(result.end);
    const { shape, anchors } = result.dimension ?? {};
    const points = shape?.kind === 'angular'
      ? dimensionArc(sa, sb, drawingToScreen(shape.center), drawingToScreen(shape.label))
      : [sa, sb];
    const strokes = points.slice(1).map((point, index) => [points[index], point] as const);
    if (shape?.kind === 'angular' && anchors) strokes.push([sa, drawingToScreen(anchors[0])], [sb, drawingToScreen(anchors[1])]);
    const dist = Math.min(...strokes.map(([a, b]) => nearestPointOnScreenSegment({ x: screenX, y: screenY }, a, b).dist));
    if (dist <= 1) offer({ type: 'measure', id: result.id });
    if (dist < threshold && preferred({ type: 'measure', id: result.id }, dist, best)) {
      best = { dist, selection: { type: 'measure', id: result.id } };
    }
  }

  return genuine ?? (!genuineOnly && best ? best.selection : null);
}
