// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sources GLSL de la transformée d'affichage. Module **pur** (des chaînes) : le contexte
 * WebGL vit dans `renderTransform.ts`, ce qui rend la chaîne de traitement relisible et
 * testable sans GPU.
 *
 * Chaîne appliquée, dans cet ordre — c'est l'ordre d'un viewer de lookdev :
 *   1. décodage sRGB du code source (un JPEG/PNG de review est encodé sRGB) ;
 *   2. **exposition** en diaphragmes, appliquée en linéaire de scène (`× 2^EV`) ;
 *   3. ré-encodage sRGB : la LUT a pour domaine le code d'entrée dans [0,1], exactement ce que
 *      cuit `ociobakelut --inputspace … --displayview …` ;
 *   4. **LUT 3D** display/view de la config du studio (sautée si la transformée est coupée) ;
 *   5. **gamma d'affichage**, après la transformée, pour ouvrir les basses lumières.
 *
 * Limite assumée : la source est 8 bits et déjà écrêtée ; une exposition positive ne fait pas
 * réapparaître des hautes lumières qui ne sont pas dans le fichier.
 */

/** Corps commun : conversions sRGB ↔ linéaire, exposition, gamma. */
const COMMON = /* glsl */ `
vec3 rvSrgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
vec3 rvLinearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
vec3 rvExpose(vec3 code, float ev) {
  vec3 lin = rvSrgbToLinear(clamp(code, 0.0, 1.0)) * exp2(ev);
  return clamp(rvLinearToSrgb(lin), 0.0, 1.0);
}
vec3 rvViewGamma(vec3 c, float g) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / g));
}
`;

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
uniform float uExposure;
uniform float uGamma;
uniform float uLutSize;
uniform float uUseLut;
${COMMON}
void main() {
  vec4 src = texture(uSrc, vUv);
  vec3 code = rvExpose(src.rgb, uExposure);
  if (uUseLut > 0.5) {
    // Échantillonnage au centre des texels : sans ce recadrage, les extrémités de la LUT
    // sont lues à moitié hors grille et les noirs/blancs dérivent.
    vec3 uvw = code * ((uLutSize - 1.0) / uLutSize) + (0.5 / uLutSize);
    code = texture(uLut, uvw).rgb;
  }
  fragColor = vec4(rvViewGamma(code, uGamma), src.a);
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
uniform float uExposure;
uniform float uGamma;
uniform float uLutSize;
uniform float uUseLut;
uniform vec2 uTiles;
${COMMON}
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
  vec3 code = rvExpose(src.rgb, uExposure);
  if (uUseLut > 0.5) code = rvSampleTiled(code);
  gl_FragColor = vec4(rvViewGamma(code, uGamma), src.a);
}
`;

/** Programmes disponibles selon la génération de contexte obtenue. */
export const SHADERS = {
  webgl2: { vertex: VERTEX_300, fragment: FRAGMENT_300 },
  webgl1: { vertex: VERTEX_100, fragment: FRAGMENT_100 },
} as const;

export type ShaderFlavor = keyof typeof SHADERS;
