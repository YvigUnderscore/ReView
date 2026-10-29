// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { storage, StorageService } from '../StorageService';
import * as EntityThumbnailService from '../EntityThumbnailService';
import type { ThumbnailHolder } from '../EntityThumbnailService';
import { asString } from './shotgridMapper';
import type { PullContext } from './ShotgridPullService';

/**
 * ShotGrid thumbnails of sequences, shots and assets.
 *
 * The `image` field of a ShotGrid entity is the picture the production chose and recognizes: it illustrates the shot in every list of the site. ReView already knew how to
 * carry an entity thumbnail (`thumbnailKey`, dropped by hand), but the synchronization never asked for the field — the cards stayed empty until a published media eventually
 * provided one, or forever on a shot without media.
 *
 * **The image is copied, not pointed to.** ShotGrid does not serve a stable address: the field returns a signed S3 URL that expires in fifteen minutes and changes at every read.
 * Displaying it directly would have produced broken cards after a quarter of an hour.
 *
 * **What serves as the change marker** is the path of this URL, signature removed: `…/<site fingerprint>/<content fingerprint>/<name>_t.jpg`. It is addressed by content,
 * so it is stable as long as the thumbnail does not change, and different as soon as it does. It is kept on the match (`sgThumbSrc`), which makes the pass idempotent: a nightly
 * reconciliation on an unchanged project downloads nothing at all.
 */

/** A thumbnail weighs a few kilobytes; beyond that, it is not one. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Accepted image types, and the extension under which they are filed.
 *
 * The list is closed on purpose: the type comes from the response of a remote service, and the storage key is then used to sign a read URL served by the application.
 * An `image/svg+xml` or a `text/html` has no business there.
 */
const EXTENSIONS: Record<string, { ext: string; contentType: string }> = {
  'image/jpeg': { ext: '.jpg', contentType: 'image/jpeg' },
  'image/jpg': { ext: '.jpg', contentType: 'image/jpeg' },
  'image/png': { ext: '.png', contentType: 'image/png' },
  'image/webp': { ext: '.webp', contentType: 'image/webp' },
};

/**
 * Change marker of a thumbnail: the private address of its signature.
 *
 * `null` means "no thumbnail on the site" — which is information, not an absence of information: it is what allows us to remove on our side the one we had set when the
 * production removes it over there.
 */
export function thumbnailIdentity(value: unknown): string | null {
  const url = asString(value);
  if (!url) return null;
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}

export interface ThumbnailSyncParams {
  holder: ThumbnailHolder;
  localId: number;
  sgType: string;
  sgId: number;
    /** Readable name of the entity — appears only in the journal. */
  name: string;
    /** Raw value of the `image` field as returned by the site. */
  image: unknown;
    /** Marker recorded at the previous pass, if there was one. */
  previous: string | null | undefined;
    /** Thumbnail currently carried by the entity on the ReView side. */
  currentKey: string | null;
}

/**
 * Aligns an entity's thumbnail with that of the site.
 *
 * Returns the marker to keep on the match. **Always a usable value**: a failure returns the previous marker rather than `null`, so that the next pass retries instead of
 * considering the entity as having no thumbnail.
 *
 * A missing thumbnail has never made an import fail: it is an impoverishment of the display, not a loss of production.
 */
export async function syncThumbnail(ctx: PullContext, params: ThumbnailSyncParams): Promise<string | null> {
  const previous = params.previous ?? null;
  if (!ctx.settings.media.thumbnails) return previous;

  const identity = thumbnailIdentity(params.image);

    /**
     * Thumbnail placed by hand in ReView: we do not touch it.
     *
     * `thumbnailKey` is only written by the manual upload (C3) — the fallback thumbnail of a card, for its part, is computed and is not recorded. A key present **without a marker**
     * can therefore only come from a human who chose this image. Covering it with the site's on the first pass would have erased their decision without conflict or trace, and across
     * a whole project at once. The site takes over again as soon as someone removes this image here.
     */
  if (params.currentKey && previous === null) return null;

  if (identity === null) {
        /**
         * Thumbnail removed from the site. We remove ONLY the one that came from there — the guard above has already set the others aside.
         */
    if (previous && params.currentKey) {
      await storage.deleteObject(params.currentKey).catch(() => undefined);
      await EntityThumbnailService.set(params.holder, params.localId, null);
      ctx.journal.count('thumbnails', 'updated');
    }
    return null;
  }

    // Identical marker AND image still in place: nothing to do, and above all nothing to download. This is the case of almost all entities at every pass.
  if (identity === previous && params.currentKey) return previous;

  try {
    const stored = await fetchAndStore(ctx, params, asString(params.image) ?? '');
    if (!stored) {
      ctx.journal.count('thumbnails', 'skipped');
      return previous;
    }
    ctx.journal.count('thumbnails', 'updated');
    return identity;
  } catch (err) {
    ctx.journal.count('thumbnails', 'failed');
    await ctx.journal.log(
      'warn',
      'shotgrid.log.thumbnailFailed',
      { name: params.name, error: err instanceof Error ? err.message : String(err) },
      {
        sgType: params.sgType,
        sgId: params.sgId,
        localType: params.holder,
        localId: params.localId,
      },
    );
    return previous;
  }
}

/** Download, type check, deposit, recording. `false` if nothing is retained. */
async function fetchAndStore(ctx: PullContext, params: ThumbnailSyncParams, url: string): Promise<boolean> {
  const { stream, size, type } = await ctx.client.openStream(url);
  if (size !== null && size > MAX_BYTES) {
    stream.destroy();
    return false;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
        // The `content-length` may lie or be missing: we recount while reading.
    if (total > MAX_BYTES) {
      stream.destroy();
      return false;
    }
    chunks.push(chunk as Buffer);
  }

  const announced = (type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const kind = EXTENSIONS[announced];
  if (!kind || total === 0) return false;

  const key = StorageService.entityThumbnailKey(params.holder, params.localId, kind.ext);
  await storage.putObject(key, Buffer.concat(chunks), kind.contentType);
    /**
     * The key depends only on the entity and the extension: replacing a JPEG with a JPEG rewrites the same object. A change of extension, on the other hand, would leave the old
     * file in the bucket with nothing designating it any more.
     */
  if (params.currentKey && params.currentKey !== key) {
    await storage.deleteObject(params.currentKey).catch(() => undefined);
  }
  await EntityThumbnailService.set(params.holder, params.localId, key);
  return true;
}
