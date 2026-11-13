/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export function patPatternWgsl(group: number, binding: number): string {
  return `
@group(${group}) @binding(${binding}) var<storage, read> patData: array<f32>;

fn patCoverage(offset: u32, p: vec2<f32>, dx: vec2<f32>, dy: vec2<f32>, scale: f32, width: f32) -> f32 {
  if (offset == 0u || offset >= arrayLength(&patData) || scale <= 0.0) { return 0.0; }
  var at = offset + 2u;
  var coverage = 0.0;
  let count = u32(patData[offset]);
  for (var family = 0u; family < min(count, 64u); family++) {
    let tangent = vec2<f32>(patData[at], patData[at + 1u]);
    let normal = vec2<f32>(-tangent.y, tangent.x);
    let relative = p - vec2<f32>(patData[at + 2u], patData[at + 3u]) * scale;
    let rowStep = patData[at + 5u] * scale;
    let dashes = min(u32(patData[at + 6u]), 256u);
    let cycle = patData[at + 7u] * scale;
    let across = dot(relative, normal);
    let row = round(across / rowStep);
    let distance = abs(across - row * rowStep);
    let pixel = max(abs(dot(dx, normal)) + abs(dot(dy, normal)), 0.000001);
    let edge = 1.0 - smoothstep(max(0.0, (width - pixel) * 0.5), (width + pixel) * 0.5, distance);
    let average = min(width / abs(rowStep), 1.0);
    let line = mix(edge * min(width / pixel, 1.0), average, smoothstep(abs(rowStep) * 0.25, abs(rowStep), pixel));
    var ink = 1.0;
    if (dashes > 0u && line > 0.0 && cycle > 0.0) {
      let phase = fract((dot(relative, tangent) - row * patData[at + 4u] * scale) / cycle) * cycle;
      var start = 0.0;
      ink = 0.0;
      for (var dash = 0u; dash < dashes; dash++) {
        let value = patData[at + 8u + dash];
        let end = start + abs(value) * scale;
        if (value >= 0.0 && phase >= start && phase < max(end, start + select(0.0, 0.05 * scale, value == 0.0))) {
          ink = 1.0;
          break;
        }
        start = end;
      }
    }
    coverage = max(coverage, line * ink);
    at += 8u + dashes;
  }
  return coverage;
}
`;
}
