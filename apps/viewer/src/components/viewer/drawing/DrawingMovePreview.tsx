/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Point2D } from '@ifc-lite/drawing-2d';
import type { DrawingViewModel } from './useDrawingViewModel';

/** Non-interactive ghost of the selected authored element, in drawing coordinates. */
export function DrawingMovePreview({ vm }: { vm: DrawingViewModel }) {
  const preview = vm.movePreview;
  if (!preview) return null;
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
  const snap = preview.reference && screen(preview.reference);
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
      {tag && anchor && line(anchor, tag.position, 'tag-leader')}
      {payload?.kind === 'dimensions' && payload.items.map(item => <g key={item.id}>
        {line(item.start, item.end, 'dimension')}
        {item.dimension?.anchors && <>
          {line(item.dimension.anchors[0], item.start, 'extension-1')}
          {line(item.dimension.anchors[1], item.end, 'extension-2')}
        </>}
      </g>)}
      {payload?.kind === 'area' && <polygon points={payload.item.points.map(point => {
        const p = translate(point); return `${p.x},${p.y}`;
      }).join(' ')} fill="currentColor" fillOpacity="0.08" />}
      {payload?.kind === 'cloud' && (() => {
        const [a, b] = payload.item.points.map(translate);
        return a && b ? <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
          width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)} rx={7} /> : null;
      })()}
    </g>
    {payload?.kind === 'text' && <text {...translate(payload.item.position)}
      fontSize={14} fill="currentColor" opacity="0.75" stroke="none">{payload.item.text}</text>}
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
    {snap && <g transform={`translate(${snap.x} ${snap.y})`}
      stroke="#4CAF50" strokeWidth="1.5" fill="none">
      <path d="M-12 0H12M0-12V12"/><circle r="6" />
    </g>}
  </svg>;
}
