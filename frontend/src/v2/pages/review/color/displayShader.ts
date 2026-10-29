// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GLSL sources for the display transform. Pure module (strings only): the WebGL
 * context lives in `renderTransform.ts`, which keeps the processing chain readable and
 * testable without a GPU.
 *
 * The chain is now the studio's own, and the only one: the image source code is used
 * directly as the domain of the project's display/view **3D LUT**, exactly what
 * `ociobakelut --inputspace … --displayview …` bakes.
 *
 * Display exposure and gamma were removed along with the Color panel (Phase 50): nobody
 * could adjust them anymore, and a sRGB <-> linear round trip at zero exposure only copied
 * the pixels.
 */

export const VERTEX_300 = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAGMENT_300 = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler3D uLut;
uniform float uLutSize;
void main() {
  vec4 src = texture(uSrc, vUv);
  // Sample at texel centers: without this offset, the LUT edges are read half outside
  // the grid and blacks/whites drift.
  vec3 uvw = clamp(src.rgb, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + (0.5 / uLutSize);
  fragColor = vec4(texture(uLut, uvw).rgb, src.a);
}
`;

export const VERTEX_100 = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** WebGL1 fallback: the LUT is a 2D atlas, so interpolation on blue is done by hand. */
export const FRAGMENT_100 = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uLut;
uniform float uLutSize;
uniform vec2 uTiles;
vec2 rvTileUv(float slice, vec2 rg) {
  float col = mod(slice, uTiles.x);
  float row = floor(slice / uTiles.x);
  vec2 base = vec2(col, row) / uTiles;
  vec2 inner = (rg * (uLutSize - 1.0) + 0.5) / (uLutSize * uTiles);
  return base + inner;
}
vec3 rvSampleTiled(vec3 code) {
  float slice = clamp(code.b, 0.0, 1.0) * (uLutSize - 1.0);
  float s0 = floor(slice);
  float s1 = min(s0 + 1.0, uLutSize - 1.0);
  vec3 a = texture2D(uLut, rvTileUv(s0, code.rg)).rgb;
  vec3 b = texture2D(uLut, rvTileUv(s1, code.rg)).rgb;
  return mix(a, b, slice - s0);
}
void main() {
  vec4 src = texture2D(uSrc, vUv);
  gl_FragColor = vec4(rvSampleTiled(clamp(src.rgb, 0.0, 1.0)), src.a);
}
`;

/** Available programs, depending on the context generation obtained. */
export const SHADERS = {
  webgl2: { vertex: VERTEX_300, fragment: FRAGMENT_300 },
  webgl1: { vertex: VERTEX_100, fragment: FRAGMENT_100 },
} as const;

export type ShaderFlavor = keyof typeof SHADERS;
