// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkProjectAccess } from '../middleware/rbac';
import { storage, StorageService } from '../lib/storage';
import { detectImage } from '../lib/fileSignatures';
import { resolveProjectIdForVersion } from '../lib/pipeline';
import { softDeleteMedia, restoreMedia, purgeMedia } from '../lib/trash';
import { logAudit } from './AuditService';
import { emitToProject } from './SocketService';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertCanContribute, isProjectManager } from '../lib/projectRoles';
import { ignoreFailure } from '../lib/ignoreFailure';
import type { SessionUser } from './mediaShared';

/** Media management by its managers: thumbnails, trash, restore, purge. */

const MAX_THUMBNAIL_BYTES = 1_500_000;

/** Decodes and validates a base64 image data URL into buffer + type + extension (throws if invalid). */
function decodeThumbnailDataUrl(dataUrl: string): { buf: Buffer; contentType: string; ext: string } {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) throw badRequest('Invalid thumbnail (an image data URL is expected)', 'INVALID_THUMBNAIL');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_THUMBNAIL_BYTES)
    throw badRequest('Thumbnail is empty or too large', 'INVALID_THUMBNAIL');
  if (!detectImage(buf.subarray(0, 16)))
    throw badRequest('Thumbnail content is not a recognised image', 'INVALID_THUMBNAIL');
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  return { buf, contentType, ext };
}

/**
 * Stores a thumbnail provided by the client (capture of a render or a chosen file).
 * base64 image/jpeg|png|webp data URL, validated by magic bytes, stored in MinIO, referenced
 * by `thumbnailKey`. Reserved to the media's managers (uploader/supervisor+).
 * The thumbnail is **presentation** (like `splatPresentation`): it remains editable after
 * publication, a deliberate exception to the Phase 11 lock (the media content itself stays frozen).
 */
export async function setThumbnail(user: SessionUser, id: number, dataUrl: string) {
  await assertMediaManage(id, user);
  const media = await prisma.mediaObject.findUnique({ where: { id }, select: { published: true } });
  if (!media) throw notFound('Media not found');
  const { buf, contentType, ext } = decodeThumbnailDataUrl(dataUrl);
  const key = StorageService.thumbnailKey(id, ext);
  await storage.putObject(key, buf, contentType);
  await prisma.mediaObject.update({ where: { id }, data: { thumbnailKey: key } });
  return { thumbnailUrl: await storage.getPresignedGetUrl(key) };
}

/**
 * **Automatic** thumbnail captured client-side at the first viewing of a 3D/splat media (no
 * headless server rendering). Idempotent bootstrap: writes only if `thumbnailKey` is **absent**
 * (it never overwrites, so it does not conflict with the publication lock: a missing preview is
 * filled, the media itself is not modified). Read access is enough (any project member who sees
 * the media). Concurrency is handled by a conditional update (a single write).
 */
export async function setAutoThumbnail(user: SessionUser, id: number, dataUrl: string) {
  const media = await prisma.mediaObject.findUnique({
    where: { id },
    select: { published: true, uploaderId: true, versionId: true, thumbnailKey: true },
  });
  if (!media) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== user.id) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  // Already has a thumbnail (worker or concurrent capture): leave everything untouched.
  if (media.thumbnailKey) {
    return { thumbnailUrl: await storage.getPresignedGetUrl(media.thumbnailKey), created: false };
  }
  const { buf, contentType, ext } = decodeThumbnailDataUrl(dataUrl);
  const key = StorageService.thumbnailKey(id, ext);
  await storage.putObject(key, buf, contentType);
  // Conditional write: only sets the key if it is still null (race protection).
  const { count } = await prisma.mediaObject.updateMany({
    where: { id, thumbnailKey: null },
    data: { thumbnailKey: key },
  });
  if (count === 0) {
    // A concurrent capture won: delete our object and return theirs.
    await storage
      .deleteObject(key)
      .catch(ignoreFailure('duplicate thumbnail cleanup failed', { mediaId: id, key }));
    const fresh = await prisma.mediaObject.findUnique({ where: { id }, select: { thumbnailKey: true } });
    const url = fresh?.thumbnailKey ? await storage.getPresignedGetUrl(fresh.thumbnailKey) : null;
    return { thumbnailUrl: url, created: false };
  }
  return { thumbnailUrl: await storage.getPresignedGetUrl(key), created: true };
}

/** Checks that the user can manage this media (uploader or supervisor+) and returns the project. */
export async function assertMediaManage(
  mediaId: number,
  user: SessionUser,
): Promise<{ projectId: number; versionId: number }> {
  const media = await prisma.mediaObject.findUnique({
    where: { id: mediaId },
    select: { uploaderId: true, versionId: true },
  });
  if (!media) throw notFound('Media not found');
  const projectId = await resolveProjectIdForVersion(media.versionId);
  if (!projectId || !(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  // 38.E: the global role decides nothing here. An ARTIST demoted to CLIENT keeps their
  // membership (so `checkProjectAccess` still says yes) but no longer manages the media they
  // deposited earlier; an ARTIST promoted to SUPERVISOR locally manages the others.
  await assertCanContribute(user.id, user.role, projectId);
  const manager = await isProjectManager(user.id, user.role, projectId);
  if (!manager && media.uploaderId !== user.id)
    throw forbidden('Deletion is reserved to the uploader or a supervisor');
  return { projectId, versionId: media.versionId };
}

/** Soft-deletes (trashes) a media. */
export async function trash(user: SessionUser, id: number) {
  const { projectId, versionId } = await assertMediaManage(id, user);
  await softDeleteMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_DELETE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}

/** Restores a media from the trash. */
export async function restore(user: SessionUser, id: number) {
  const { projectId, versionId } = await assertMediaManage(id, user);
  await restoreMedia(id);
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}

/** Permanently purges a media (supervisor+). */
export async function purge(user: SessionUser, id: number) {
  if (user.role !== Role.ADMIN && user.role !== Role.SUPERVISOR)
    throw forbidden('Supervisors and administrators only');
  const { projectId, versionId } = await assertMediaManage(id, user);
  await purgeMedia(id);
  logAudit({ userId: user.id, action: 'MEDIA_PURGE', entityType: 'MediaObject', entityId: id });
  emitToProject(projectId, 'media:update', { projectId, id, versionId });
}
