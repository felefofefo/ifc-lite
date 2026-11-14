/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { useMemo } from 'react';
import { patternSegments } from '@ifc-lite/drawing-2d';
import { patternRepeatScale, type ImportedPattern } from '@/lib/drawing/pattern-library';

export function DrawingPatternSwatch({ pattern, compact = false }: { pattern: ImportedPattern; compact?: boolean }) {
  const path = useMemo(() => {
    const outer = [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 22 }, { x: 0, y: 22 }];
    return patternSegments({ outer, holes: [] }, pattern.lines, patternRepeatScale(pattern))
      .slice(0, 800).map(({ start, end }) => `M${start.x} ${22 - start.y}L${end.x} ${22 - end.y}`).join('');
  }, [pattern]);
  return <svg aria-hidden viewBox="0 0 32 22" className={`shrink-0 overflow-hidden rounded-sm border bg-background text-foreground ${compact ? 'h-4 w-6' : 'h-8 w-11'}`}>
    <path d={path} fill="none" stroke="currentColor" strokeWidth="0.35" />
  </svg>;
}
