// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { detectImage } from '../lib/fileSignatures';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { checkProjectAccess } from '../middleware/rbac';
import { assertProjectWritable } from '../lib/projectGuard';
import { resolveProjectIdForMedia } from '../lib/pipeline';
import { assertMediaManage } from './MediaService';

/**
 * 2D review reference images (Phase 24, reworked): **linked to a comment**. They are shown only
 * while their comment is selected (ending the permanent display), and are **no longer movable once
 * placed** (position frozen when the comment is sent). Pinned to the canvas as fractions of the base
 * image, overflow allowed. Review aid: not subject to the publish lock. Added by the comment's author;
 * removed by the author or by a media manager.
 */

type SessionUser = { id: number; role: Role };

const MAX_BYTES = 6_000_000;
const MAX_REFS = 12;
/**
 * Canvas bounds: a reference can be placed around the base image (the letterbox bands), not only on it.
 * Same ceiling as the router schema (`POS_LIMIT`): the service clamps again because it also serves its own defaults.
 */
const POS_LIMIT = 3;

function decodeImageDataUrl(dataUrl: string): { buf: Buffer; ext: string; contentType: string } {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/i.exec(dataUrl);
  if (!m) throw badRequest('Invalid image (an image data URL is expected)', 'INVALID_IMAGE');
  const contentType = m[1]!.toLowerCase();
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES)
    throw badRequest('Image is empty or too large (6 MB max)', 'INVALID_IMAGE');
  if (!detectImage(buf.subarray(0, 16)))
    throw badRequest('Content is not a recognised image', 'INVALID_IMAGE');
  const ext =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/webp'
        ? 'webp'
        : contentType === 'image/gif'
          ? 'gif'
          : 'jpg';
  return { buf, ext, contentType };
}

const clampPos = (v: number) => Math.min(Math.max(v, -POS_LIMIT), POS_LIMIT);
const clampWidth = (v: number) => Math.min(Math.max(v, 0.02), 3);

async function serialize(ref: {
  id: number;
  storageKey: string;
  x: number;
  y: number;
  width: number;
  commentId: number | null;
}) {
  return {
    id: ref.id,
    url: await storage.getPresignedGetUrl(ref.storageKey),
    x: ref.x,
    y: ref.y,
    width: ref.width,
    commentId: ref.commentId,
  };
}

/**
 * Write access to the carrier media (project member, project neither removed nor archived).
 *
 * Ownership of a comment is not authorization: it reasons about a past state. The comment survives removal
 * of the membership, archiving of the project and its move to the trash: a contractor who left a finished
 * project replayed one of their old `commentId` values and could still store up to 6 MB under the studio's
 * `derived/` prefix. Access is therefore rechecked at the moment of the action, as in the neighbouring router
 * (`TimelineMarkerService.assertMediaRead`).
 */
async function assertMediaWrite(mediaId: number, user: SessionUser): Promise<void> {
  const projectId = await resolveProjectIdForMedia(mediaId);
  if (!projectId) throw notFound('Media not found');
  if (!(await checkProjectAccess(user.id, user.role, projectId)))
    throw forbidden('No access to this project');
  await assertProjectWritable(projectId);
}

/**
 * Adds a reference image (data URL) linked to a comment on the media. Reserved for the **comment's author**,
 * and only while they still have access to the project. The position is frozen at creation.
 */
export async function add(
  user: SessionUser,
  mediaId: number,
  dataUrl: string,
  commentId: number,
  pos?: { x?: number; y?: number; width?: number },
) {
  await assertMediaWrite(mediaId, user);
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { mediaObjectId: true, userId: true },
  });
  if (!comment || comment.mediaObjectId !== mediaId)
    throw badRequest('This comment does not belong to this media');
  if (comment.userId !== user.id)
    throw forbidden("Seul l'auteur du commentaire peut y joindre une référence");
  const count = await prisma.reviewReference.count({ where: { mediaObjectId: mediaId } });
  if (count >= MAX_REFS)
    throw badRequest(`At most ${MAX_REFS} reference images per media`, 'TOO_MANY_REFERENCES');
  const { buf, ext, contentType } = decodeImageDataUrl(dataUrl);
  const key = `derived/${mediaId}/reference-${randomUUID()}.${ext}`;
  await storage.putObject(key, buf, contentType);
  const ref = await prisma.reviewReference.create({
    data: {
      mediaObjectId: mediaId,
      commentId,
      storageKey: key,
      createdById: user.id,
            // Without a position (client outside the review screen): just right of the frame, where the
            // letterbox usually leaves room. If the player has no band, the display will pull it back
            // against the media's right edge.
      x: clampPos(pos?.x ?? 1.02 + count * 0.03),
      y: clampPos(pos?.y ?? 0.02 + count * 0.03),
      width: clampWidth(pos?.width ?? 0.3),
    },
  });
  return serialize(ref);
}

/** Removes a reference image (DB and MinIO). Comment author or manager only. */
export async function remove(user: SessionUser, mediaId: number, refId: number) {
  const ref = await prisma.reviewReference.findUnique({
    where: { id: refId },
    include: { comment: { select: { userId: true } } },
  });
  if (!ref || ref.mediaObjectId !== mediaId) return;
  if (ref.comment?.userId !== user.id) await assertMediaManage(mediaId, user);
  await prisma.reviewReference.delete({ where: { id: refId } });
  await storage.deleteObject(ref.storageKey).catch(() => undefined);
}

/** Purges the MinIO objects of a comment's references (before deletion; the DB cascades). */
export async function purgeForComment(commentId: number) {
  const refs = await prisma.reviewReference.findMany({ where: { commentId }, select: { storageKey: true } });
  await Promise.all(refs.map((r) => storage.deleteObject(r.storageKey).catch(() => undefined)));
}
