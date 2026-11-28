/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { textLeaderGeometry, textLeaderStyle } from '@/lib/drawing/annotation-types';
import type { resolveTextLeaderArrow } from '@/lib/drawing/drawing-tag-library';

export function TextLeaderGraphic({ geometry, pen, unit, arrow }: {
  geometry: NonNullable<ReturnType<typeof textLeaderGeometry>>;
  pen: ReturnType<typeof textLeaderStyle>;
  unit: number;
  arrow?: ReturnType<typeof resolveTextLeaderArrow>;
}) {
  const { start, tip, angle, triangle } = geometry;
  return <g pointerEvents="none">
    <line x1={start.x} y1={start.y} x2={tip.x} y2={tip.y} stroke={pen.color}
      strokeWidth={pen.weight * unit} strokeDasharray={pen.dash.map(value => value * unit).join(' ') || undefined} />
    {arrow ? <image href={arrow.href} transform={`translate(${tip.x} ${tip.y}) rotate(${angle})`}
      x={-arrow.anchor.x * unit} y={-arrow.anchor.y * unit} width={arrow.width * unit} height={arrow.height * unit} />
      : pen.arrowSymbolId !== '' && <polygon points={triangle.map(p => `${p.x},${p.y}`).join(' ')} fill={pen.color} />}
  </g>;
}
