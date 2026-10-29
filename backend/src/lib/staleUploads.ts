// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, type Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { storage } from '../services/StorageService';
import { ignoreFailure } from './ignoreFailure';

/** What is needed to know about an upload in order to erase the bytes it left in MinIO. */
export type AbandonedUpload = {
  id: number;
  storageKey: string;
  metadata: Prisma.JsonValue | null;
  imageSequence?: { storagePrefix: string } | null;
};

/**
 * Erases what an upload that will not complete has written to MinIO.
 *
 * Three write paths, three different traces, and the most expensive one is invisible.
 * A multipart upload that was never completed has NO object at `storageKey`:
 * `CompleteMultipartUpload` did not happen, so `DeleteObject` is a no-op there, and the
 * parts already received live in `.minio.sys/multipart/`, which neither `ListObjectsV2`,
 * `mc ls`, the administration storage report, nor `mc mirror` can see. Only
 * `AbortMultipartUpload` frees them, and it requires the `uploadId`, stored in
 * `metadata.multipartUploadId` and therefore lost with the `MediaObject` row. A sequence
 * of images, for its part, has scattered N whole frames under its prefix: once the row is
 * deleted, nothing would lead to them anymore.
 *
 * Hence this function is shared between the explicit abort (the client's "cancel"
 * button, `MediaUploadService.abortUpload`) and the purge of abandoned uploads: both
 * delete the same row, so they must erase exactly the same bytes.
 *
 * Everything here is best effort: the row, however, must go even if MinIO is unavailable.
 */
export async function discardUploadObjects(media: AbandonedUpload): Promise<void> {
  const meta = media.metadata as Record<string, unknown> | null;
  const uploadId = meta?.multipartUploadId;
  if (media.imageSequence) {
    await storage
      .deletePrefix(media.imageSequence.storagePrefix)
      .catch(ignoreFailure('stale sequence cleanup failed', { mediaId: media.id }));
    await storage
      .deleteObject(media.storageKey)
      .catch(ignoreFailure('stale upload cleanup failed', { mediaId: media.id }));
  } else if (typeof uploadId === 'string') {
    await storage
      .abortMultipartUpload(media.storageKey, uploadId)
      .catch(ignoreFailure('stale multipart abort failed', { mediaId: media.id }));
  } else if (media.storageKey) {
    // Key still empty: `createUpload` creates the row before knowing the identifier that
    // builds the key. There is then nothing to delete, and `DeleteObject ''` is a wasted
    // round trip to MinIO.
    await storage
      .deleteObject(media.storageKey)
      .catch(ignoreFailure('stale upload cleanup failed', { mediaId: media.id }));
  }
}

/**
 * Abandoned uploads in progress.
 *
 * A media is created as `UPLOADING` even before the first byte leaves for MinIO, and it
 * only leaves that state on the browser's end-of-upload signal. Tab closed, machine off,
 * network cut: the row stays `UPLOADING` forever. An abort route does exist, but it
 * assumes the client is still there to call it.
 *
 * This is not just noise: `MediaService.createUpload` refuses a new upload beyond
 * `MAX_CONCURRENT_UPLOADS` media in `UPLOADING` for the same account. At the Nth
 * accident (five by default), the user gets the error "Trop d'uploads simultanés" and
 * can no longer upload anything, permanently, without administrator intervention.
 *
 * The delay is deliberately generous: a very large file on a slow line may legitimately
 * spend several hours in `UPLOADING`. Twelve hours can no longer be a live upload.
 */
export const STALE_UPLOAD_HOURS = 12;

export async function purgeStaleUploads(hours = STALE_UPLOAD_HOURS): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000);
  const stale = await prisma.mediaObject.findMany({
    where: { status: MediaStatus.UPLOADING, createdAt: { lt: cutoff } },
    // `metadata` and `imageSequence` hold the only threads leading to the bytes already
    // stored (multipart identifier, frame prefix). Not reading them BEFORE the `deleteMany`
    // loses them: nothing afterwards can locate them anymore.
    select: {
      id: true,
      storageKey: true,
      metadata: true,
      imageSequence: { select: { storagePrefix: true } },
    },
  });
  if (stale.length === 0) return { purged: 0 };

  // The row first: it is the row that blocks the account. The MinIO object may never have
  // been written, so its deletion is "best effort", as everywhere else.
  await prisma.mediaObject.deleteMany({ where: { id: { in: stale.map((m) => m.id) } } });
  for (const media of stale) {
    await discardUploadObjects(media);
    await storage
      .deletePrefix(`derived/${media.id}/`)
      .catch(ignoreFailure('derived files cleanup failed', { mediaId: media.id }));
  }
  logger.info(
    { purged: stale.length, hours },
    '[Uploads] abandoned uploads cleaned up — the affected accounts can upload again',
  );
  return { purged: stale.length };
}
