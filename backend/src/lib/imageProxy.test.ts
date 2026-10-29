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
  it('claims a derivative for images the browser cannot decode', () => {
    for (const ext of ['.exr', '.dpx', '.tif', '.tiff', '.tga']) {
      expect(needsWebProxy(ext), ext).toBe(true);
    }
  });

  it('leaves alone those it displays natively', () => {
    for (const ext of BROWSER_IMAGE_EXTENSIONS) {
      expect(needsWebProxy(ext), ext).toBe(false);
    }
  });

  it('ignores case: the extension comes from the uploaded file name', () => {
    expect(needsWebProxy('.EXR')).toBe(true);
    expect(needsWebProxy('.PNG')).toBe(false);
  });

  /**
   * The useful invariant: an accepted image is either rendered by the browser or proxied. Nothing must be able to
   * enter and remain invisible in review.
   */
  it('covers all accepted image extensions', () => {
    for (const ext of SUPPORTED_EXTENSIONS[MediaKind.IMAGE]) {
      const covered = needsWebProxy(ext) || (BROWSER_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
      expect(covered, ext).toBe(true);
    }
  });
});

describe('imageDecodeInputOptions', () => {
  it("applies the sRGB curve to the EXR, which is linear", () => {
    expect(imageDecodeInputOptions('.exr')).toEqual(['-apply_trc', 'iec61966_2_1']);
    expect(imageDecodeInputOptions('.EXR')).toEqual(['-apply_trc', 'iec61966_2_1']);
  });

  it("sets nothing on the other decoders — the option would make the command fail", () => {
    for (const ext of ['.dpx', '.tif', '.tga', '.png', '.mov']) {
      expect(imageDecodeInputOptions(ext), ext).toEqual([]);
    }
  });
});

describe('webProxyOutputOptions', () => {
  it('enforces a mjpeg-compatible pixel format and a single image', () => {
    const opts = webProxyOutputOptions();
    expect(opts).toContain('yuvj420p');
    // Without it, a multi-page TIFF would produce a sequence instead of an image.
    expect(opts.join(' ')).toContain('-frames:v 1');
  });
});

describe('webProxyScaleFilter', () => {
  it('does not resize a production plate: full resolution is the point', () => {
    expect(webProxyScaleFilter(4096, 2160)).toBeNull();
    expect(webProxyScaleFilter(WEB_PROXY_MAX_SIDE, WEB_PROXY_MAX_SIDE)).toBeNull();
  });

  it('bounds out-of-gauge panoramas, keeping the ratio and an even dimension', () => {
    expect(webProxyScaleFilter(40000, 2000)).toBe(`scale=${WEB_PROXY_MAX_SIDE}:-2`);
    expect(webProxyScaleFilter(2000, 40000)).toBe(`scale=-2:${WEB_PROXY_MAX_SIDE}`);
  });

  it('unknown dimensions (silent probe): no filter rather than a wrong one', () => {
    expect(webProxyScaleFilter(0, 0)).toBeNull();
    expect(webProxyScaleFilter(Number.NaN, Number.NaN)).toBeNull();
  });
});

describe('webProxyKey', () => {
  it('stores the derivative with the others, under the media prefix', () => {
    expect(webProxyKey(42)).toBe('derived/42/proxy.jpg');
  });
});
