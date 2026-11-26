/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { SnapKind } from '@/lib/snap/types';

/** Screen-sized drawing snap markers, matching the Model workspace glyph vocabulary.
 * No viewport-only SVG filters, and no pointer interactions or persisted data. */
export function DrawingSnapGlyph({ kind }: { kind: SnapKind | null }) {
  const shape = kind === 'vertex' ? 'endpoint' : kind === 'edge' ? 'nearest' : kind;
  const outline = shape === 'endpoint'
    ? <rect x={-5} y={-5} width={10} height={10} />
    : shape === 'midpoint'
      ? <polygon points="0,-6 6,5 -6,5" />
      : shape === 'nearest'
        ? <path d="M-6 -5 L6 -5 L-6 5 L6 5 Z" />
        : shape === 'intersection'
          ? <path d="M-6 -6 L6 6 M6 -6 L-6 6" />
          : shape === 'parallel'
            ? <path d="M-6 3L3 -6 M-3 6L6 -3" />
            : <><path d="M-12 0 H12 M0 -12 V12"/><circle r={6}/></>;
  return <g data-drawing-snap-kind={shape ?? 'angle'} pointerEvents="none"
    fill="white" stroke="#4CAF50" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
    {outline}
  </g>;
}
