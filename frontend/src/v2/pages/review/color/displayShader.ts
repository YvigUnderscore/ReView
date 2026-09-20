// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sources GLSL de la transformée d'affichage. Module **pur** (des chaînes) : le contexte
 * WebGL vit dans `renderTransform.ts`, ce qui rend la chaîne de traitement relisible et
 * testable sans GPU.
 *
 * La chaîne est désormais celle du studio, et elle seule : le code source de l'image sert
 * directement de domaine à la **LUT 3D** display/view de la config du projet — exactement ce
 * que cuit `ociobakelut --inputspace … --displayview …`.
 *
 * L'exposition et le gamma d'affichage ont disparu avec le panneau Color (Phase 50) : plus
 * personne ne pouvait les régler, et un aller-retour sRGB ↔ linéaire à exposition nulle ne
 * faisait que recopier les pixels.
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
  // Échantillonnage au centre des texels : sans ce recadrage, les extrémités de la LUT
  // sont lues à moitié hors grille et les noirs/blancs dérivent.
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

/** Repli WebGL1 : la LUT est un atlas 2D, l'interpolation sur le bleu est faite à la main. */
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

/** Programmes disponibles selon la génération de contexte obtenue. */
export const SHADERS = {
  webgl2: { vertex: VERTEX_300, fragment: FRAGMENT_300 },
  webgl1: { vertex: VERTEX_100, fragment: FRAGMENT_100 },
} as const;

export type ShaderFlavor = keyof typeof SHADERS;
