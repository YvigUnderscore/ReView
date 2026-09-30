// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { MediaKind } from '@prisma/client';
import { SUPPORTED_EXTENSIONS } from './fileSignatures';
import {
  BROWSER_IMAGE_EXTENSIONS,
  imageDecodeInputOptions,
  needsWebProxy,
  webProxyKey,
  webProxyOutputOptions,
  webProxyScaleFilter,
  WEB_PROXY_MAX_SIDE,
} from './imageProxy';

describe('needsWebProxy', () => {
  it('réclame un dérivé pour les images que le navigateur ne décode pas', () => {
    for (const ext of ['.exr', '.dpx', '.tif', '.tiff', '.tga']) {
      expect(needsWebProxy(ext), ext).toBe(true);
    }
  });

  it('laisse tranquilles celles quʼil affiche nativement', () => {
    for (const ext of BROWSER_IMAGE_EXTENSIONS) {
      expect(needsWebProxy(ext), ext).toBe(false);
    }
  });

  it('ignore la casse : lʼextension vient du nom de fichier déposé', () => {
    expect(needsWebProxy('.EXR')).toBe(true);
    expect(needsWebProxy('.PNG')).toBe(false);
  });

  /**
   * L'invariant utile : une image acceptée est soit rendue par le navigateur, soit
   * proxifiée. Rien ne doit pouvoir entrer et rester invisible en review.
   */
  it('couvre toutes les extensions image admises', () => {
    for (const ext of SUPPORTED_EXTENSIONS[MediaKind.IMAGE]) {
      const covered = needsWebProxy(ext) || (BROWSER_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
      expect(covered, ext).toBe(true);
    }
  });
});

describe('imageDecodeInputOptions', () => {
  it("applique la courbe sRGB à l'EXR, qui est linéaire", () => {
    expect(imageDecodeInputOptions('.exr')).toEqual(['-apply_trc', 'iec61966_2_1']);
    expect(imageDecodeInputOptions('.EXR')).toEqual(['-apply_trc', 'iec61966_2_1']);
  });

  it("ne pose rien sur les autres décodeurs — l'option y ferait échouer la commande", () => {
    for (const ext of ['.dpx', '.tif', '.tga', '.png', '.mov']) {
      expect(imageDecodeInputOptions(ext), ext).toEqual([]);
    }
  });
});

describe('webProxyOutputOptions', () => {
  it('impose un format de pixel compatible mjpeg et une seule image', () => {
    const opts = webProxyOutputOptions();
    expect(opts).toContain('yuvj420p');
    // Sans cela un TIFF multi-page produirait une séquence au lieu d'une image.
    expect(opts.join(' ')).toContain('-frames:v 1');
  });
});

describe('webProxyScaleFilter', () => {
  it('ne redimensionne pas une plaque de production : la pleine résolution est le propos', () => {
    expect(webProxyScaleFilter(4096, 2160)).toBeNull();
    expect(webProxyScaleFilter(WEB_PROXY_MAX_SIDE, WEB_PROXY_MAX_SIDE)).toBeNull();
  });

  it('borne les panoramas hors gabarit, en gardant le rapport et une dimension paire', () => {
    expect(webProxyScaleFilter(40000, 2000)).toBe(`scale=${WEB_PROXY_MAX_SIDE}:-2`);
    expect(webProxyScaleFilter(2000, 40000)).toBe(`scale=-2:${WEB_PROXY_MAX_SIDE}`);
  });

  it('dimensions inconnues (sonde muette) : pas de filtre plutôt quʼun mauvais', () => {
    expect(webProxyScaleFilter(0, 0)).toBeNull();
    expect(webProxyScaleFilter(Number.NaN, Number.NaN)).toBeNull();
  });
});

describe('webProxyKey', () => {
  it('range le dérivé avec les autres, sous le préfixe du média', () => {
    expect(webProxyKey(42)).toBe('derived/42/proxy.jpg');
  });
});
