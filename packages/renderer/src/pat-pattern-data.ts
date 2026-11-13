/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const PAT_BUFFER_WORDS = 262_144;

type PatFamily = { angle: number; x: number; y: number; dx: number; dy: number; dash: readonly number[] };

/** Float lanes are exact for offsets into this buffer. Zero means no custom pattern. */
export function packPatPatterns<P extends { id: string; lines: readonly PatFamily[]; repeatScale?: number }>(patterns: readonly P[]) {
  const words = [0];
  const offsets = new Map<string, number>();
  for (const { id, lines, repeatScale } of patterns) {
    const length = 2 + lines.reduce((n, line) => n + 8 + line.dash.length, 0);
    if (lines.length > 64 || lines.some(line => line.dash.length > 256) || words.length + length > PAT_BUFFER_WORDS) continue;
    offsets.set(id, words.length);
    const scale = repeatScale ?? 1;
    words.push(lines.length, Number.isFinite(scale) && scale >= 0.01 && scale <= 100 ? scale : 1);
    for (const { angle, x, y, dx, dy, dash } of lines) {
      const radians = angle * Math.PI / 180;
      words.push(Math.cos(radians), Math.sin(radians), x, y, dx, dy,
        dash.length, dash.reduce((sum, value) => sum + Math.abs(value), 0), ...dash);
    }
  }
  return { data: new Float32Array(words), offsets };
}
