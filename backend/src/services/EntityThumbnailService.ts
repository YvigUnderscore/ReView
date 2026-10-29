// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { storage, StorageService } from './StorageService';

/**
 * Thumbnail chosen by hand for a sequence, a shot or an asset (C3).
 *
 * The `thumbnailKey` column existed, the PATCH accepted it, and yet no entity had ever been able to carry an
 * image: nothing in the application knew how to produce the key. The upload
 * therefore works like an avatar's — a presigned URL, then the recording of the key — and the key is rebuilt
 * here rather than received from the client, so that a caller cannot point an
 * entity at any object in the bucket.
 */

export type ThumbnailHolder = 'sequence' | 'shot' | 'asset';

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

/** The project carrying the entity — it is that which decides access. */
export async function resolveProject(holder: ThumbnailHolder, id: number): Promise<number> {
  if (holder === 'sequence') {
    const row = await prisma.sequence.findFirst({
      where: { id, deletedAt: null },
      select: { projectId: true },
    });
    if (!row) throw notFound('Sequence not found');
    return row.projectId;
  }
  if (holder === 'shot') {
    const row = await prisma.shot.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
    if (!row) throw notFound('Shot not found');
    return row.projectId;
  }
  const row = await prisma.asset.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
  if (!row) throw notFound('Asset not found');
  return row.projectId;
}

/** Short-lived upload URL + key to return afterwards. */
export async function presign(holder: ThumbnailHolder, id: number, contentType: string) {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw badRequest('Unsupported image type', 'BAD_CONTENT_TYPE');
  const key = StorageService.entityThumbnailKey(holder, id, ext);
  const url = await storage.getPresignedPutUrl(key, contentType, 900);
  return { url, key };
}

/**
 * Records the thumbnail. `null` removes it — the entity then falls back on the thumbnail of the first
 * published media, as before.
 */
export async function set(holder: ThumbnailHolder, id: number, key: string | null) {
  // The key must designate the targeted entity: without this check, a PATCH would suffice to display any
  // object in the bucket, including the media of a project one has no access to.
  if (key !== null) {
    const prefix = `entity-thumbs/${holder}/${id}.`;
    if (!key.startsWith(prefix)) throw badRequest('Thumbnail key does not match the entity', 'BAD_KEY');
    // The browser has just uploaded the image directly into MinIO, under a key that depends only on the
    // entity and the extension: replacing a thumbnail therefore rewrites the same
    // object. The memoized URL must be forgotten, otherwise the cards would keep serving the old image from
    // the browser cache (URL unchanged).
    storage.forgetPresignedUrl(key);
  }
  const data = { thumbnailKey: key };
  if (holder === 'sequence') await prisma.sequence.update({ where: { id }, data });
  else if (holder === 'shot') await prisma.shot.update({ where: { id }, data });
  else await prisma.asset.update({ where: { id }, data });
  return key;
}
