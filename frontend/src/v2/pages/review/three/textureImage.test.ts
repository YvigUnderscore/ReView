// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { textureFullUrl, textureImageSource } from './textureImage';

/**
 * Opening a texture enlarged requires extracting it from the scene. Three shapes come from the glTF
 * loader and only one is directly displayable; the rest goes through a canvas, which may refuse
 * (2D context absent under happy-dom, or a canvas tainted by an image served without a CORS header).
 * In that case the texture is simply not openable — never a black frame.
 */

/** Detached `<img>` with an address: the case of a texture embedded in the GLB. */
function imageTexture(src: string, width = 2048, height = 1024): THREE.Texture {
  const img = document.createElement('img');
  img.src = src;
  Object.defineProperty(img, 'naturalWidth', { value: width });
  Object.defineProperty(img, 'naturalHeight', { value: height });
  const tex = new THREE.Texture();
  tex.image = img;
  return tex;
}

describe('textureImageSource', () => {
  it('recognizes an image and reports its native resolution', () => {
    // `naturalWidth` and not `width`: an unlaid-out `<img>` reports 0 in `width`.
    expect(textureImageSource(imageTexture('blob:review/albedo'))).toMatchObject({
      kind: 'element',
      src: 'blob:review/albedo',
      width: 2048,
      height: 1024,
    });
  });

  it('recognizes a procedural texture as an array of bytes', () => {
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    expect(textureImageSource(tex)).toMatchObject({ kind: 'data', width: 1, height: 1 });
  });

  it('renders nothing for a texture without an image, nor for an image without an address', () => {
    expect(textureImageSource(new THREE.Texture())).toBeNull();
    // An `<img>` whose source was never set cannot be displayed in the lightbox.
    const tex = new THREE.Texture();
    tex.image = document.createElement('img');
    expect(textureImageSource(tex)).toBeNull();
  });
});

describe('textureFullUrl', () => {
  it('serves the image address as is, without going through a canvas', () => {
    expect(textureFullUrl(imageTexture('blob:review/normal'))).toBe('blob:review/normal');
  });

  it('returns `null` rather than throwing when the canvas cannot export', () => {
    // happy-dom does not implement `getContext('2d')`: that is exactly the expected fallback
    // of a browser refusing the export (tainted canvas).
    expect(textureFullUrl(new THREE.DataTexture(new Uint8Array(4), 1, 1))).toBeNull();
    expect(textureFullUrl(new THREE.Texture())).toBeNull();
  });
});
