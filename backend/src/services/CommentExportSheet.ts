// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { storage } from './StorageService';
import { logger } from '../lib/logger';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { t, type Locale } from '../i18n';
import type { SheetImage, SheetLabels } from '../lib/notesSheetHtml';
import type { ClipContext } from './CommentExportScope';

/**
 * Images and labels of the printable notes sheet.
 *
 * The sheet must stay readable once saved: images are therefore encoded as data URIs rather than presigned (a
 * signed URL expires in an hour; a PDF printed six months later would only show empty frames).
 *
 * The commented frame comes from the **timeline sprite** the worker already computes for the player's hover:
 * one thumbnail every three seconds, cut with CSS. Extracting the exact frame would require one ffmpeg call
 * per note: minutes for a busy shot, which an HTTP request cannot afford. Without a sprite (image, 3D,
 * splat), the media's thumbnail is used.
 */

/** Beyond this, a single image alone would make up the weight of the document. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Total image budget of a sheet: past this point, the following notes are output without a frame. */
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

/** Display width of a media thumbnail, in pixels. */
const THUMB_WIDTH = 160;

/** Default aspect ratio when the media did not record its dimensions. */
const DEFAULT_ASPECT = 16 / 9;

/** Retrieves the translated labels of the sheet. */
export function sheetLabels(locale: Locale): SheetLabels {
  return {
    frame: t(locale, 'notesSheet.frame'),
    timecode: t(locale, 'notesSheet.timecode'),
    state: t(locale, 'notesSheet.state'),
    decision: t(locale, 'notesSheet.decision'),
    noFrame: t(locale, 'notesSheet.noFrame'),
    printHint: t(locale, 'notesSheet.printHint'),
    empty: t(locale, 'notesSheet.empty'),
    reply: t(locale, 'notesSheet.reply'),
  };
}

/** Index of the sprite thumbnail closest to an instant. */
export function spriteTile(
  sprite: { intervalSec: number; count: number; cols: number },
  seconds: number,
): { col: number; row: number } {
  const index = Math.min(
    Math.max(0, sprite.count - 1),
    Math.max(0, Math.floor(seconds / sprite.intervalSec)),
  );
  return { col: index % sprite.cols, row: Math.floor(index / sprite.cols) };
}

/** Builds the image loader of a sheet: cache per media and shared byte budget. */
export function createSheetImages(): (clip: ClipContext, at: number | null) => Promise<SheetImage | null> {
  const cache = new Map<string, string | null>();
  let spent = 0;

  const load = async (key: string, cacheKey: string): Promise<string | null> => {
    const known = cache.get(cacheKey);
    if (known !== undefined) return known;
    let uri: string | null = null;
    try {
      const buffer = await storage.getObjectBuffer(key);
      if (buffer.byteLength <= MAX_IMAGE_BYTES && spent + buffer.byteLength <= MAX_TOTAL_BYTES) {
        spent += buffer.byteLength;
        uri = `data:${imageTypeFromKey(key)};base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      // A missing thumbnail must not sink the sheet: the note is output without an image.
      logger.warn({ err, key }, 'Image de planche de notes illisible');
    }
    cache.set(cacheKey, uri);
    return uri;
  };

  return async (clip, at) => {
    const sprite = clip.sprite;
    if (sprite && at !== null) {
      const src = await load(sprite.key, `sprite:${clip.mediaId}`);
      if (src) {
        const { col, row } = spriteTile(sprite, at);
        return {
          src,
          width: sprite.tileW,
          height: sprite.tileH,
          tile: {
            offsetX: col * sprite.tileW,
            offsetY: row * sprite.tileH,
            sheetWidth: sprite.cols * sprite.tileW,
            sheetHeight: sprite.rows * sprite.tileH,
          },
        };
      }
    }
    if (!clip.thumbnailKey) return null;
    const src = await load(clip.thumbnailKey, `thumb:${clip.mediaId}`);
    if (!src) return null;
    const aspect = clip.aspect && clip.aspect > 0 ? clip.aspect : DEFAULT_ASPECT;
    return { src, width: THUMB_WIDTH, height: Math.max(1, Math.round(THUMB_WIDTH / aspect)) };
  };
}
