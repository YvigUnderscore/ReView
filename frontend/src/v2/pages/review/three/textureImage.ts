// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * What can be done with a Three texture **outside the scene**: a thumbnail in the dock, and a
 * full-screen image in the lightbox.
 *
 * Three shapes come from the glTF loader, and only one is directly displayable in HTML:
 *   - `HTMLImageElement` — the common case, and the only one already carrying an address (`blob:`
 *     for a texture embedded in the GLB). It is served as is: no canvas, hence no risk of a
 *     "tainted" canvas, and full resolution without copying;
 *   - `ImageBitmap` / `HTMLCanvasElement` — drawable, but without an address: a canvas is needed to
 *     extract an image from them;
 *   - `DataTexture` — an array of bytes (procedural UV checkerboard, matcap): same thing, via
 *     `ImageData`.
 *
 * Classification is separated from drawing so it can be tested without a 2D context: happy-dom does
 * not implement `getContext('2d')`, and a test that cannot draw anything must still be able to check
 * that an image texture gives its address.
 */

/** Underlying image of a texture, reduced to what can render it. */
export type TextureImageSource =
  | { kind: 'element'; image: CanvasImageSource; width: number; height: number; src: string }
  | { kind: 'drawable'; image: CanvasImageSource; width: number; height: number }
  | { kind: 'data'; data: ArrayLike<number>; width: number; height: number };

type RawImage = CanvasImageSource & {
  data?: ArrayLike<number>;
  width?: number;
  height?: number;
  src?: string;
};

/** Classifies the image of a texture, or `null` if nothing is usable outside WebGL. */
export function textureImageSource(texture: THREE.Texture): TextureImageSource | null {
  const img = texture.image as RawImage | null | undefined;
  if (!img) return null;
  const width = img.width ?? 0;
  const height = img.height ?? 0;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement)
    // `naturalWidth` rather than `width`: an `<img>` not attached to the document reports 0 in
    // `width` until it is laid out, although the pixel data is there.
    return img.src
      ? {
          kind: 'element',
          image: img,
          width: img.naturalWidth || width,
          height: img.naturalHeight || height,
          src: img.src,
        }
      : null;
  const drawable =
    (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap);
  if (drawable) return { kind: 'drawable', image: img, width, height };
  if (img.data && width && height) return { kind: 'data', data: img.data, width, height };
  return null;
}

/** Canvas at native resolution, filled with the source — `null` if drawing is impossible. */
function paint(source: TextureImageSource): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !source.width || !source.height) return null;
  if (source.kind === 'data') {
    const arr = new Uint8ClampedArray(source.data);
    if (arr.length < source.width * source.height * 4) return null;
    ctx.putImageData(new ImageData(arr, source.width, source.height), 0, 0);
    return canvas;
  }
  ctx.drawImage(source.image, 0, 0, source.width, source.height);
  return canvas;
}

/**
 * Displayable address of the texture at full resolution (lightbox). An image keeps its own;
 * everything else goes through a canvas, whose export can fail — 2D context absent (tests), or a
 * canvas tainted by an image served without a CORS header. In that case the texture cannot be
 * opened enlarged, and the caller simply keeps its thumbnail.
 */
export function textureFullUrl(texture: THREE.Texture): string | null {
  const source = textureImageSource(texture);
  if (!source) return null;
  if (source.kind === 'element') return source.src;
  try {
    return paint(source)?.toDataURL() ?? null;
  } catch {
    return null;
  }
}

/** Draws the thumbnail of a texture into an already-sized canvas. */
export function drawTexturePreview(canvas: HTMLCanvasElement, texture: THREE.Texture): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const source = textureImageSource(texture);
  if (!source) return;
  try {
    if (source.kind === 'data') {
      // Blit at native resolution, then scale: `putImageData` ignores any transformation,
      // it cannot downscale.
      const native = paint(source);
      if (native) ctx.drawImage(native, 0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  } catch {
    /* preview unavailable (texture not readable in 2D) — the empty frame stays displayed */
  }
}
