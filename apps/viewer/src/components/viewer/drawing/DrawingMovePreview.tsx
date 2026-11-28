/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D } from '@ifc-lite/drawing-2d';
import { repositionCurvedDimension } from '@/lib/drawing/dimension-line';
import { tagLeaderEnd } from '@/lib/drawing/drawing-tag-svg';
import { DrawingSnapGlyph } from './DrawingSnapGlyph';
import { textAnnotationLayout, textBoxStyle, textLeaderGeometry, textLeaderStyle, textLeaderTip } from '@/lib/drawing/annotation-types';
import type { resolveTextLeaderArrow } from '@/lib/drawing/drawing-tag-library';
import { TextLeaderGraphic } from './TextLeaderGraphic';
import type { DrawingViewModel } from './useDrawingViewModel';
import { pathDisplayPoints } from '@/lib/drawing/sketch-input';

/** Non-interactive ghost of the selected authored element, in drawing coordinates. */
type ArrowMap = ReadonlyMap<string, NonNullable<ReturnType<typeof resolveTextLeaderArrow>>>;
export function DrawingMovePreview({ vm, arrows }: { vm: DrawingViewModel; arrows?: ArrowMap }) {
  const preview = vm.movePreview;
  if (!preview) return null;
  if (!preview.batch) return <MoveGhost vm={vm} preview={preview} arrows={arrows} />;
  return <>
    {preview.batch.map((item, index) => {
      let delta = preview.delta;
      if (item.tag?.gridStart && vm.drawing?.config.plane.axis !== 'y') delta = { ...delta, y: 0 };
      return <MoveGhost key={index} vm={vm} arrows={arrows} preview={{ ...item, delta, reference: index === 0 ? preview.reference : null }} />;
    })}
  </>;
}

type MoveGhostData = Omit<NonNullable<DrawingViewModel['movePreview']>, 'batch'> & {
  annotation?: DrawingViewModel['selectedAnnotation2D'];
};

function MoveGhost({ vm, preview, arrows }: { vm: DrawingViewModel; preview: MoveGhostData; arrows?: ArrowMap }) {
  const payload = preview.payload;
  const transform = vm.markupTransform;
  const sx = vm.drawnPlane.axis === 'side' ? -transform.scale : transform.scale;
  const sy = vm.drawnPlane.axis === 'down' ? transform.scale : -transform.scale;
  const screen = (p: Point2D) => ({ x: p.x * sx + transform.x, y: p.y * sy + transform.y });
  const translate = (p: Point2D) => screen({ x: p.x + preview.delta.x, y: p.y + preview.delta.y });
  const line = (a: Point2D, b: Point2D, key: string) => {
    const start = translate(a), end = translate(b);
    return <line key={key} x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
  };
  const snap = preview.reference && screen(vm.snapDisplayPoint(preview.reference));
  const tag = preview.tag;
  const tagGraphics = tag && vm.tags.items.find(item => item.tag.id === tag.id);
  const p = tag && translate(tag.position);
  const anchor = tag && (tag.gridStart ?? tagGraphics?.anchor);
  const markerStart = preview.marker && translate(preview.marker.start);
  const markerEnd = preview.marker && translate(preview.marker.end);
  const markerAngle = markerStart && markerEnd
    ? Math.atan2(markerEnd.y - markerStart.y, markerEnd.x - markerStart.x) * 180 / Math.PI
      + (preview.marker?.reverse ? -90 : 90) : 0;
  return <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full text-primary">
    <g stroke="currentColor" strokeWidth="1.8" strokeDasharray="5 4" fill="none" opacity="0.85">
      {preview.marker && line(preview.marker.start, preview.marker.end, 'marker')}
      {markerStart && markerEnd && <path
        transform={`translate(${(markerStart.x + markerEnd.x) / 2} ${(markerStart.y + markerEnd.y) / 2}) rotate(${markerAngle})`}
        d="M0 0H19m-6-4 6 4-6 4" />}
      {tag && anchor && p && (tag.leader || tag.gridStart) && (() => {
        const start = translate(anchor);
        const end = tag.gridStart ? p : tagLeaderEnd(tagGraphics?.graphic, p, start, vm.tags.paperUnit);
        return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />;
      })()}
      {payload?.kind === 'dimensions' && (() => {
        // Match the existing Move action: a chain moves normal to its axis;
        // curved dimensions reposition relative to their measured geometry.
        const source = payload.items.find(item => item.id === (preview.annotation?.id ?? vm.selectedAnnotation2D?.id)) ?? payload.items[0];
        if (!source) return null;
        let delta = preview.delta;
        if (source.dimension?.chainId && !source.dimension.shape) {
          const x = source.end.x - source.start.x, y = source.end.y - source.start.y;
          const length = Math.hypot(x, y);
          if (!length) return null;
          const nx = -y / length, ny = x / length, normal = delta.x * nx + delta.y * ny;
          delta = { x: normal * nx, y: normal * ny };
        }
        const shift = (p: Point2D) => ({ x: p.x + delta.x, y: p.y + delta.y });
        const stroke = (a: Point2D, b: Point2D, key: string) => {
          const p = screen(a), q = screen(b);
          return <line key={key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
        };
        return payload.items.map(item => {
          const moved = item.dimension?.shape
            ? repositionCurvedDimension({ ...item, anchors: item.dimension.anchors, shape: item.dimension.shape }, shift(item.start))
            : { start: shift(item.start), end: shift(item.end), anchors: item.dimension?.anchors };
          if (!moved) return null;
          return <g key={item.id}>
            {stroke(moved.start, moved.end, 'dimension')}
            {moved.anchors && <>
              {stroke(moved.anchors[0], moved.start, 'extension-1')}
              {stroke(moved.anchors[1], moved.end, 'extension-2')}
            </>}
          </g>;
        });
      })()}
      {payload?.kind === 'area' && (() => {
        const points = pathDisplayPoints(payload.item).map(point => { const p = translate(point); return `${p.x},${p.y}`; }).join(' ');
        return payload.item.pathClosed === false ? <polyline points={points} fill="none" />
          : <polygon points={points} fill={payload.item.pathClosed === undefined ? 'currentColor' : 'none'} fillOpacity="0.08" />;
      })()}
      {payload?.kind === 'cloud' && (() => {
        const [a, b] = payload.item.points.map(translate);
        return a && b ? <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
          width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} rx={7} /> : null;
      })()}
    </g>
    {payload?.kind === 'area' && (() => {
      const rect = vm.areaTagRects.find(item => item.id === payload.item.id);
      return rect && <g opacity="0.7">
        {rect.leader && <line x1={rect.leader.start.x + preview.delta.x * sx} y1={rect.leader.start.y + preview.delta.y * sy}
          x2={rect.leader.end.x + preview.delta.x * sx} y2={rect.leader.end.y + preview.delta.y * sy}
          stroke="currentColor" strokeWidth={1.5} />}
        <image href={rect.href} x={rect.x + preview.delta.x * sx} y={rect.y + preview.delta.y * sy}
          width={rect.width} height={rect.height} />
      </g>;
    })()}
    {payload?.kind === 'text' && (() => {
      const note = vm.styledNotes.find(item => item.id === payload.item.id) ?? payload.item;
      const unit = vm.sheetEnabled && vm.activeSheet ? vm.viewTransform.scale : transform.scale * (vm.publicationScale || 100) / 1000;
      const p = translate(note.position);
      const ctx = vm.containerRef.current?.ownerDocument.createElement('canvas').getContext('2d');
      const layout = textAnnotationLayout(note, unit, (text, font) => {
        if (!ctx) return undefined; ctx.font = font; return ctx.measureText(text).width;
      });
      const box = textBoxStyle(note, vm.lineweights), pen = textLeaderStyle(note.appearance, vm.lineweights);
      const tip = textLeaderTip(note);
      const leader = tip && textLeaderGeometry({ ...p, width: layout.bgW, height: layout.bgH }, translate(tip), unit);
      const align = note.align ?? note.appearance?.align ?? 'left';
      const textX = align === 'center' ? p.x + layout.bgW / 2 : align === 'right' ? p.x + layout.bgW - layout.padding : p.x + layout.padding;
      return <g opacity="0.75">
        {leader && <TextLeaderGraphic geometry={leader} pen={pen} unit={unit} arrow={arrows?.get(pen.arrowSymbolId ?? '')} />}
        <rect x={p.x} y={p.y} width={layout.bgW} height={layout.bgH} fill={box.background ?? 'none'}
          stroke={box.border?.color ?? 'none'} strokeWidth={(box.border?.weight ?? 0) * unit} strokeDasharray={box.border?.dash.map(value => value * unit).join(' ') || undefined} />
        <text x={textX} y={p.y + layout.padding} dominantBaseline="text-before-edge" textAnchor={align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'}
          style={{ font: layout.font }} fill={note.appearance?.color ?? note.color}>
          {layout.lines.map((line, i) => <tspan key={i} x={textX} y={p.y + layout.padding + i * layout.lineHeight}>{line}</tspan>)}
        </text>
      </g>;
    })()}
    {tagGraphics?.startGraphic && anchor && (() => {
      const at = translate(anchor), graphic = tagGraphics.startGraphic;
      return <image href={graphic.href}
        x={at.x - graphic.anchor.x * vm.tags.paperUnit} y={at.y - graphic.anchor.y * vm.tags.paperUnit}
        width={graphic.width * vm.tags.paperUnit} height={graphic.height * vm.tags.paperUnit} opacity="0.7" />;
    })()}
    {p && (tagGraphics?.graphic ? <image href={tagGraphics.graphic.href}
      x={p.x - tagGraphics.graphic.anchor.x * vm.tags.paperUnit}
      y={p.y - tagGraphics.graphic.anchor.y * vm.tags.paperUnit}
      width={tagGraphics.graphic.width * vm.tags.paperUnit}
      height={tagGraphics.graphic.height * vm.tags.paperUnit} opacity="0.7" />
      : <text x={p.x} y={p.y} fill="currentColor" fontSize={vm.tags.fontSize}
        textAnchor="middle" dominantBaseline="middle" opacity="0.75">{tagGraphics?.text ?? tag?.field}</text>)}
    {snap && <g transform={`translate(${snap.x} ${snap.y})`}>
      <DrawingSnapGlyph kind={vm.snapKindFor(preview.reference)} />
    </g>}
  </svg>;
}
