// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { storage } from '../StorageService';
import { safeUploadContentType } from '../../lib/uploadContentType';
import { belongsToProject } from './shotgridProjectGuard';
import { attachmentName, attachmentUrl, asEntityRef, type SgRecord } from './shotgridMapper';
import type { PullContext } from './ShotgridPullService';

/**
 * ShotGrid note attachments -> ReView comment attachments.
 *
 * This is where the annotated image passes: ShotGrid flattens the supervisor's drawing and attaches it to the note. Without this path, the review only receives
 * the text, and the feedback loses precisely what it pointed to on screen.
 *
 * The file is copied into ReView's storage rather than pointed to on ShotGrid: a site URL expires, requires authentication, and disappears with the note.
 */

const ATTACHMENT_FIELDS = [
  'this_file',
  'filename',
  'display_name',
    // Mandatory: `belongsToProject` refuses any entity whose project it cannot read, and an Attachment is not an out-of-project entity.
  'project',
];

/** Beyond this, we do not suck it in: a note may carry an entire render by mistake. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Type alias (not `interface`) on purpose: an interface has no implicit index signature, and Prisma then refuses to see it as a storable JSON value.
 */
export type CommentAttachmentRef = {
  key: string;
  name: string;
  contentType: string;
};

/** MIME type from the file name, when the site does not announce one. */
export function guessType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Type retained for the attachment fetched: the one that will be stored **and** recorded on the comment.
 *
 * The type announced by the transport takes precedence, but a generic `application/octet-stream` would deprive the image of its thumbnail: the file name then decides.
 * The result then goes through the allowlist, because the remote site chooses this header: a `text/html` or an `image/svg+xml` would be served from the application's origin.
 * `putObject` already normalizes what it writes; we record the same value here, so that the comment's record does not promise an image that storage serves as binary.
 */
export function storedContentType(announced: string | null | undefined, name: string): string {
  const base = announced?.split(';')[0]?.trim();
  const chosen = base && base !== 'application/octet-stream' ? base : guessType(name);
  return safeUploadContentType(chosen);
}

/**
 * Fetches a note's attachments and attaches them to the comment.
 *
 * Returns the number of files actually fetched. A failure on one of them does not bring down the others, nor the note: a missing attachment is an impoverishment,
 * not a reason to lose the feedback itself.
 */
export async function importNoteAttachments(
  ctx: PullContext,
  record: SgRecord,
  commentId: number,
): Promise<number> {
  const refs = asRefs(record.attachments);
  if (refs.length === 0) return 0;

  const existing = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { attachments: true },
  });
  const already = Array.isArray(existing?.attachments)
    ? (existing.attachments as unknown as CommentAttachmentRef[])
    : [];
  const known = new Set(already.map((a) => a.key));

  const imported: CommentAttachmentRef[] = [];
  for (const ref of refs) {
    try {
      const one = await fetchOne(ctx, ref.id, commentId);
      if (one && !known.has(one.key)) imported.push(one);
    } catch (err) {
      ctx.journal.count('notes', 'failed');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.noteAttachmentFailed',
        { sgId: ref.id, error: err instanceof Error ? err.message : String(err) },
        { sgType: 'Attachment', sgId: ref.id, localType: 'comment', localId: commentId },
      );
    }
  }
  if (imported.length === 0) return 0;

  await prisma.comment.update({
    where: { id: commentId },
    data: { attachments: [...already, ...imported] as Prisma.InputJsonArray },
  });
  logger.info({ commentId, count: imported.length }, 'Pièces jointes de note importées');
  return imported.length;
}

/** One file: read the entity, check the project, download, deposit. */
async function fetchOne(
  ctx: PullContext,
  sgId: number,
  commentId: number,
): Promise<CommentAttachmentRef | null> {
  const rec = await ctx.client.findById('Attachment', sgId, ATTACHMENT_FIELDS);
  if (!rec) return null;

    // The same requirement as everywhere else: nothing enters without its project being verified.
  if (!belongsToProject(rec, ctx.scope).ok) {
    ctx.journal.count('guard', 'skipped');
    return null;
  }

    // The dedicated endpoint first, the address carried by the field next: depending on the site and the field, one or the other answers.
  const url = (await ctx.client.downloadUrl('Attachment', sgId, 'this_file')) ?? attachmentUrl(rec.this_file);
  if (!url) return null;

  const name = attachmentName(rec.this_file, `shotgrid-${sgId}`);
  const { stream, size, type } = await ctx.client.openStream(url);
  if (size && size > MAX_BYTES) {
    stream.destroy();
    ctx.journal.count('notes', 'skipped');
    return null;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    if (total > MAX_BYTES) {
      stream.destroy();
      ctx.journal.count('notes', 'skipped');
      return null;
    }
    chunks.push(chunk as Buffer);
  }

  const contentType = storedContentType(type, name);

    // The path cannot follow the `comments/attachments/{userId}` convention: an imported note has no local author. It is filed under the original note,
    // which stays classified by `AdminStorageService` and says where the file came from.
  const key = `comments/attachments/shotgrid/${commentId}/${sgId}-${sanitize(name)}`;
  await storage.putObject(key, Buffer.concat(chunks), contentType);
  return { key, name, contentType };
}

/**
 * File name reduced to what can live in a storage key.
 *
 * Sequences of dots fall before the rest: the single dot must survive to keep the extension, on which the MIME type depends, hence the thumbnail, but ".." has no reason
 * to reach a key that will be used to sign a read URL.
 */
export const sanitize = (name: string): string =>
  name
    .replace(/\.{2,}/g, '_')
    .replace(/[^\w.-]+/g, '_')
    .slice(-80);

export function asRefs(value: unknown): Array<{ id: number; type: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asEntityRef(v))
    .filter((r): r is { id: number; type: string } => r !== null && r.type === 'Attachment');
}
