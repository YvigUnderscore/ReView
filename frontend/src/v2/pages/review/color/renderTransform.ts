// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toTiles, type CubeLut } from './cubeLut';
import { SHADERS, type ShaderFlavor } from './displayShader';

/**
 * Application GPU de la transformée d'affichage à une image fixe. Un canvas hors écran, un
 * triangle plein cadre, le shader de `displayShader.ts`, et on rend le résultat sous forme
 * d'image : le viewer de review garde son zoom, son pan, ses annotations et sa capture de
 * vue, qui continuent de travailler sur une simple balise `img`.
 *
 * WebGL2 quand il existe (texture 3D en matériel), WebGL1 sinon (atlas 2D). Si aucun contexte
 * n'est disponible, on rend `null` : l'appelant affiche l'image d'origine et le dit.
 */

export interface TransformParams {
  exposure: number;
  gamma: number;
  /** LUT display/view, ou `null` : exposition et gamma restent appliqués. */
  lut: CubeLut | null;
}

export interface TransformResult {
  canvas: HTMLCanvasElement;
  flavor: ShaderFlavor;
}

type AnyGl = WebGL2RenderingContext | WebGLRenderingContext;

const isGl2 = (gl: AnyGl): gl is WebGL2RenderingContext =>
  typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

function compile(gl: AnyGl, type: number, source: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function program(gl: AnyGl, flavor: ShaderFlavor): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, SHADERS[flavor].vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, SHADERS[flavor].fragment);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

function sourceTexture(gl: AnyGl, image: TexImageSource): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return tex;
}

function lutTexture(gl: AnyGl, lut: CubeLut): { tex: WebGLTexture; tiles: [number, number] } | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  if (isGl2(gl)) {
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA8,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lut.volume,
    );
    return { tex, tiles: [1, 1] };
  }
  const atlas = toTiles(lut);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    atlas.width,
    atlas.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    atlas.data,
  );
  return { tex, tiles: [atlas.cols, atlas.rows] };
}

/** Contexte WebGL sur un canvas neuf, WebGL2 d'abord. `null` si le navigateur n'en a aucun. */
export function acquireContext(canvas: HTMLCanvasElement): { gl: AnyGl; flavor: ShaderFlavor } | null {
  const attrs: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  };
  const gl2 = canvas.getContext('webgl2', attrs);
  if (gl2) return { gl: gl2, flavor: 'webgl2' };
  const gl1 = canvas.getContext('webgl', attrs);
  return gl1 ? { gl: gl1, flavor: 'webgl1' } : null;
}

/**
 * Rend l'image transformée dans un canvas de la taille de la source. Le contexte est jetable :
 * une image de review se transforme quelques fois par session, pas soixante fois par seconde.
 */
export function renderTransform(
  image: TexImageSource,
  width: number,
  height: number,
  params: TransformParams,
): TransformResult | null {
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const acquired = acquireContext(canvas);
  if (!acquired) return null;
  const { gl, flavor } = acquired;

  const prog = program(gl, flavor);
  const src = prog ? sourceTexture(gl, image) : null;
  if (!prog || !src) return null;
  const lutTex = params.lut ? lutTexture(gl, params.lut) : null;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.useProgram(prog);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 0);
  if (lutTex) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(
      flavor === 'webgl2' ? (gl as WebGL2RenderingContext).TEXTURE_3D : gl.TEXTURE_2D,
      lutTex.tex,
    );
    gl.uniform1i(gl.getUniformLocation(prog, 'uLut'), 1);
    gl.uniform2f(gl.getUniformLocation(prog, 'uTiles'), lutTex.tiles[0], lutTex.tiles[1]);
  }
  gl.uniform1f(gl.getUniformLocation(prog, 'uExposure'), params.exposure);
  gl.uniform1f(gl.getUniformLocation(prog, 'uGamma'), params.gamma || 1);
  gl.uniform1f(gl.getUniformLocation(prog, 'uLutSize'), params.lut?.size ?? 2);
  gl.uniform1f(gl.getUniformLocation(prog, 'uUseLut'), params.lut ? 1 : 0);

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.deleteBuffer(buffer);
  gl.deleteTexture(src);
  if (lutTex) gl.deleteTexture(lutTex.tex);
  gl.deleteProgram(prog);
  return { canvas, flavor };
}

/** Encode le canvas en PNG (sans perte : on juge une couleur) et rend une URL d'objet. */
export function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
  });
}
