// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Comment attachments: which MinIO keys are accepted from a client, and which become orphans when the
 * list is rewritten.
 *
 * The key is supplied by the CLIENT and then used to sign a read URL: the prefix filter is a **security
 * guard**, not a writing convenience. Without it, attaching another user's key would be enough to read
 * their attachment, on another project.
 */

import { z } from 'zod';

/** Descriptor sent by the client: the object key and its display labels. */
export interface AttachmentRef {
  key: string;
  name?: string;
  contentType?: string;
}

/** Per-comment ceiling (mirrors the frontend). */
export const MAX_COMMENT_ATTACHMENTS = 8;

/**
 * Accepted input shape, on creation as on edit. It bounds the SHAPE and the volume; key ownership is
 * checked in the service (`filterAttachments`).
 */
export const attachmentsSchema = z
  .array(
    z.object({
      key: z.string().max(512),
      name: z.string().max(200).optional(),
      contentType: z.string().max(100).optional(),
    }),
  )
  .max(MAX_COMMENT_ATTACHMENTS);

/**
 * MinIO root of comment attachments.
 *
 * The folders are CONCATENATED rather than interpolated: a template would make this storage key look
 * like interface text to `check-untranslated`, which counts every fragment of a backend template
 * (same reason as `frontend/src/test/apiMock.ts`).
 */
const ROOT = 'comments/attachments/';

/** Folder a user fills in themselves, via a presigned URL under their name. */
export const ownAttachmentPrefix = (userId: number) => ROOT + userId + '/';

/**
 * Folder for the files pulled in from a ShotGrid note: it belongs to the comment, not to a person.
 * An edit must be able to keep them — refusing them would erase the files coming from the remote site
 * at the first text correction.
 */
export const shotgridAttachmentPrefix = (commentId: number) => ROOT + 'shotgrid/' + commentId + '/';

/** Keeps only keys from one of the allowed folders (and never a `..` traversal). */
export function filterAttachments(
  attachments: AttachmentRef[] | undefined,
  prefixes: string[],
): AttachmentRef[] {
  return (attachments ?? []).filter(
    (a) => !a.key.includes('..') && prefixes.some((prefix) => a.key.startsWith(prefix)),
  );
}

/** Keys of an `attachments` blob re-read from the database — a JSON column, so the shape is not guaranteed. */
export function attachmentKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((a) => (a && typeof a === 'object' ? (a as { key?: unknown }).key : null))
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
}

/**
 * Objects to delete from storage: present before, absent after. Without this, removing an image from a
 * comment (or deleting the comment) left it in MinIO forever.
 */
export function orphanedKeys(before: unknown, after: unknown): string[] {
  const kept = new Set(attachmentKeys(after));
  return [...new Set(attachmentKeys(before))].filter((key) => !kept.has(key));
}
