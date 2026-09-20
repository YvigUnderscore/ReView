// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { textureFullUrl, textureImageSource } from './textureImage';

/**
 * Ouvrir une texture en grand suppose de savoir l'extraire de la scène. Trois formes arrivent
 * du chargeur glTF et une seule est directement affichable ; le reste passe par un canvas, qui
 * peut refuser (contexte 2D absent sous happy-dom, ou canvas marqué par une image servie sans
 * en-tête CORS). Dans ce cas la texture n'est simplement pas ouvrable — jamais un cadre noir.
 */

/** `<img>` détachée, avec une adresse : le cas d'une texture embarquée dans le GLB. */
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
  it('reconnaît une image et rapporte sa résolution native', () => {
    // `naturalWidth` et non `width` : une `<img>` non mise en page rapporte 0 en `width`.
    expect(textureImageSource(imageTexture('blob:review/albedo'))).toMatchObject({
      kind: 'element',
      src: 'blob:review/albedo',
      width: 2048,
      height: 1024,
    });
  });

  it('reconnaît une texture procédurale comme un tableau d’octets', () => {
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    expect(textureImageSource(tex)).toMatchObject({ kind: 'data', width: 1, height: 1 });
  });

  it('ne rend rien d’une texture sans image, ni d’une image sans adresse', () => {
    expect(textureImageSource(new THREE.Texture())).toBeNull();
    // Une `<img>` dont la source n'a jamais été posée n'est pas affichable en lightbox.
    const tex = new THREE.Texture();
    tex.image = document.createElement('img');
    expect(textureImageSource(tex)).toBeNull();
  });
});

describe('textureFullUrl', () => {
  it('sert l’adresse de l’image telle quelle, sans passer par un canvas', () => {
    expect(textureFullUrl(imageTexture('blob:review/normal'))).toBe('blob:review/normal');
  });

  it('rend `null` plutôt que de lever quand le canvas ne sait pas exporter', () => {
    // happy-dom n'implémente pas `getContext('2d')` : c'est exactement le repli attendu
    // d'un navigateur qui refuse l'export (canvas marqué).
    expect(textureFullUrl(new THREE.DataTexture(new Uint8Array(4), 1, 1))).toBeNull();
    expect(textureFullUrl(new THREE.Texture())).toBeNull();
  });
});
