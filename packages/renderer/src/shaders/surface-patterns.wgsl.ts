/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
export const surfacePatternsWgsl = `
@binding(6) @group(1) var<storage, read> surfacePatterns: array<u32>;

fn surfacePatternAlpha(position: f32, footprint: f32, spacing: f32) -> f32 {
  let phase = fract(position / spacing) * spacing;
  let distance = min(phase, spacing - phase);
  let w = spacing * 0.052;
  return mix(1.0 - smoothstep(max(0.0, w - footprint), w + footprint, distance),
    0.104, smoothstep(spacing * 0.25, spacing, footprint));
}

fn surfacePatternColor(base: vec4<f32>, id: u32, p: vec3<f32>, n: vec3<f32>, dx: vec3<f32>, dy: vec3<f32>) -> vec4<f32> {
  if (surfacePatterns[2] == 0u || id == 0xFFFFFFFFu) { return base; }
  let capacity = surfacePatterns[0];
  let materialId = uniforms.overrideParams.z;
  var slot = entityColorSlotHash(id ^ entityColorSlotHash(materialId)) & (capacity - 1u);
  for (var i = 0u; i <= surfacePatterns[1] && i < capacity; i++) {
    let key = surfacePatterns[4u + slot];
    if (key == 0xFFFFFFFFu) { break; }
    if (key == id && surfacePatterns[4u + capacity + slot] == materialId) {
      let index = surfacePatterns[3] + 4u * slot;
      let fg = u32(bitcast<f32>(surfacePatterns[index]));
      let bg = u32(bitcast<f32>(surfacePatterns[index + 1u]));
      let spacing = max(0.0001, bitcast<f32>(surfacePatterns[index + 2u]));
      let kind = bitcast<f32>(surfacePatterns[index + 3u]);
      let normal = abs(n);
      var u = vec3<f32>(1.0, 0.0, 0.0);
      var v = vec3<f32>(0.0, 1.0, 0.0);
      if (normal.y >= max(normal.x, normal.z)) { v = vec3<f32>(0.0, 0.0, 1.0); }
      else if (normal.x > normal.z) { u = vec3<f32>(0.0, 0.0, 1.0); }
      let a = (u + v) * 0.70710678;
      let b = (u - v) * 0.70710678;
      let alphaA = surfacePatternAlpha(dot(p, a), max(0.000001, abs(dot(dx, a)) + abs(dot(dy, a))), spacing);
      let alphaB = surfacePatternAlpha(dot(p, b), max(0.000001, abs(dot(dx, b)) + abs(dot(dy, b))), spacing);
      let background = select(base.rgb, unpack4x8unorm(max(bg, 1u) - 1u).bgr, bg != 0u);
      let alpha = select(alphaA, max(alphaA, alphaB), kind == 2.0);
      return vec4<f32>(mix(background, unpack4x8unorm(max(fg, 1u) - 1u).bgr, select(alpha, 0.0, kind == 0.0)), base.a);
    }
    slot = (slot + 1u) & (capacity - 1u);
  }
  return base;
}
`;
