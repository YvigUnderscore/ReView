// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toTiles, type CubeLut } from './cubeLut';
import { SHADERS, type ShaderFlavor } from './displayShader';

/**
 * GPU application of the project's display/view LUT to a still image. An off-screen canvas, a
 * full-frame triangle, the shader from `displayShader.ts`, and the result is rendered as an image:
 * the review viewer keeps its zoom, pan, annotations and view capture, which keep working on a plain
 * `img` element.
 *
 * WebGL2 when available (3D texture in hardware), WebGL1 otherwise (2D atlas). If no context is
 * available, returns `null`: the caller shows the original image.
 */

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

/** WebGL context on a fresh canvas, WebGL2 first. `null` if the browser has none. */
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
 * Renders the transformed image into a canvas the size of the source. The context is disposable: a
 * review image is transformed a few times per session, not sixty times per second.
 */
export function renderTransform(
  image: TexImageSource,
  width: number,
  height: number,
  lut: CubeLut,
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
  const lutTex = lutTexture(gl, lut);
  if (!lutTex) return null;

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
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(flavor === 'webgl2' ? (gl as WebGL2RenderingContext).TEXTURE_3D : gl.TEXTURE_2D, lutTex.tex);
  gl.uniform1i(gl.getUniformLocation(prog, 'uLut'), 1);
  gl.uniform2f(gl.getUniformLocation(prog, 'uTiles'), lutTex.tiles[0], lutTex.tiles[1]);
  gl.uniform1f(gl.getUniformLocation(prog, 'uLutSize'), lut.size);

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.deleteBuffer(buffer);
  gl.deleteTexture(src);
  gl.deleteTexture(lutTex.tex);
  gl.deleteProgram(prog);
  return { canvas, flavor };
}

/** Encodes the canvas as PNG (lossless, since we judge a colour) and returns an object URL. */
export function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
  });
}
