// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The sheet's images: the right sprite tile for the commented instant, an object read only once per media,
 * and a byte budget that prevents a loaded review from producing a hundred-megabyte document.
 */

const { store } = vi.hoisted(() => ({ store: { getObjectBuffer: vi.fn() } }));
vi.mock('./StorageService', () => ({ storage: store }));
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { createSheetImages, spriteTile } from './CommentExportSheet';
import type { ClipContext } from './CommentExportScope';

const clip = (over: Partial<ClipContext> = {}): ClipContext => ({
  mediaId: 7,
  mediaName: 'SH010.mov',
  location: 'SH010',
  sequence: 'SQ010',
  shot: 'SH010',
  task: 'comp',
  version: 'v003',
  decision: '',
  duration: 30,
  fps: 24,
  thumbnailKey: 'derived/7/thumb.jpg',
  sprite: {
    key: 'derived/7/timeline-sprite.jpg',
    intervalSec: 3,
    count: 10,
    cols: 5,
    rows: 2,
    tileW: 160,
    tileH: 90,
  },
  aspect: 16 / 9,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  store.getObjectBuffer.mockResolvedValue(Buffer.from('jpeg-bytes'));
});

describe('spriteTile', () => {
  it('chooses the thumbnail of the interval containing the instant', () => {
    const sprite = { intervalSec: 3, count: 10, cols: 5 };
    expect(spriteTile(sprite, 0)).toEqual({ col: 0, row: 0 });
    expect(spriteTile(sprite, 7)).toEqual({ col: 2, row: 0 });
    expect(spriteTile(sprite, 16)).toEqual({ col: 0, row: 1 });
  });

  it('is bounded to the existing thumbnails', () => {
    const sprite = { intervalSec: 3, count: 10, cols: 5 };
    expect(spriteTile(sprite, 9999)).toEqual({ col: 4, row: 1 });
    expect(spriteTile(sprite, -5)).toEqual({ col: 0, row: 0 });
  });
});

describe('createSheetImages', () => {
  it('crops the sprite at the commented instant', async () => {
    const image = await createSheetImages()(clip(), 7);
    expect(image?.src.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(image?.width).toBe(160);
    expect(image?.tile).toEqual({ offsetX: 320, offsetY: 0, sheetWidth: 800, sheetHeight: 180 });
  });

  it('reads the object only once, even for twenty notes on the same media', async () => {
    const images = createSheetImages();
    for (let i = 0; i < 20; i++) await images(clip(), i);
    expect(store.getObjectBuffer).toHaveBeenCalledTimes(1);
  });

  it('falls back to the thumbnail when the note has no time reference', async () => {
    const image = await createSheetImages()(clip(), null);
    expect(store.getObjectBuffer).toHaveBeenCalledWith('derived/7/thumb.jpg');
    expect(image?.tile).toBeUndefined();
    expect(image?.height).toBe(90);
  });

  it('returns null when the media has neither sprite nor thumbnail', async () => {
    expect(await createSheetImages()(clip({ sprite: null, thumbnailKey: null }), 3)).toBeNull();
  });

  it('outputs the note without an image rather than failing when the object is unreadable', async () => {
    store.getObjectBuffer.mockRejectedValue(new Error('gone'));
    expect(await createSheetImages()(clip({ sprite: null }), null)).toBeNull();
  });

  it('discards an image too heavy for a printable document', async () => {
    store.getObjectBuffer.mockResolvedValue(Buffer.alloc(3 * 1024 * 1024));
    expect(await createSheetImages()(clip({ sprite: null }), null)).toBeNull();
  });
});
