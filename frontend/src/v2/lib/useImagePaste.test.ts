// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { fileToImageDataUrl, imageFilesFromClipboard, isAcceptedImageType } from './useImagePaste';

/** Builds a minimal DataTransfer-like object for the test (items + files). */
function makeClipboard(files: { type: string }[]): DataTransfer {
  const asFiles = files.map((f) => new File(['x'], 'p', { type: f.type }));
  return {
    items: asFiles.map((file) => ({
      kind: 'file' as const,
      type: file.type,
      getAsFile: () => file,
    })),
    files: asFiles,
  } as unknown as DataTransfer;
}

describe('imageFilesFromClipboard (Phase 18)', () => {
  it('returns [] for an empty clipboard', () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
  });

  it('extracts only image files', () => {
    const out = imageFilesFromClipboard(makeClipboard([{ type: 'image/png' }, { type: 'text/plain' }]));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('image/png');
  });

  it('extrait plusieurs images', () => {
    const out = imageFilesFromClipboard(makeClipboard([{ type: 'image/jpeg' }, { type: 'image/webp' }]));
    expect(out.map((f) => f.type)).toEqual(['image/jpeg', 'image/webp']);
  });
});

describe('fileToImageDataUrl (fix for Ctrl+V on invalid images)', () => {
  it('accepts backend types as they are', () => {
    for (const t of ['image/png', 'image/JPEG', 'image/webp', 'image/gif'])
      expect(isAcceptedImageType(t)).toBe(true);
    expect(isAcceptedImageType('image/bmp')).toBe(false);
    expect(isAcceptedImageType('')).toBe(false);
  });

  it('reads an accepted type as a data URL without re-encoding', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const url = await fileToImageDataUrl(file);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });
});
