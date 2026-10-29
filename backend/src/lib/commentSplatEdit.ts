// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Binary parts of a **cloud-edit proposal** (Phase 50, batch 14): the deletion mask (bitset per splat
 * index) and the subset ops do not fit in an annotation — they are blobs of several hundred kilobytes.
 *
 * They therefore travel exactly like a **comment attachment**: same MinIO folder (`comments/attachments/<author>/`),
 * same presigned URL, same purge on edit and deletion. The `splat-edit` part keeps only their REFERENCE (the
 * key), and reading resolves that key only among the attachments OF THE SAME comment — which are already
 * prefix-filtered. A foreign key slipped into the part therefore yields no URL: same guarantee as for the
 * images of a point of interest.
 *
 * What this module adds, and which exists for no other attachment: a **size ceiling checked by the server**.
 * An ordinary attachment goes out as a presigned PUT with nothing re-reading its size; an edit blob, on the
 * other hand, is re-read (`statObject`) when the comment declares it, and refused above the media mask's
 * ceiling. Without this, the proposal would be the only path through which an unlimited deletion cloud could
 * enter a review.
 */

import { z } from 'zod';
import { badRequest } from './errors';

/**
 * Ceiling of a proposal blob: that of the media mask (`SplatEditService`, MAX_MASK_BYTES). A proposal must
 * not be able to carry more than what a manager would save for everyone.
 */
export const MAX_SPLAT_EDIT_BLOB_BYTES = 4_000_000;

/** Reference to a blob: the object's key and its count (masked splats / replayed ops). */
export interface SplatEditBlobRef {
  key: string;
  count: number;
}

/**
 * Accepted input shape. `count` is for display ("N splats removed"): it is bounded but never taken on trust
 * — the blob is what counts on replay.
 */
export const splatEditBlobRef = z
  .object({ key: z.string().min(1).max(512), count: z.number().int().positive().max(100_000_000) })
  .strict();

/** The two references of a `splat-edit` part, when the part carries them. */
function refsOf(part: unknown): SplatEditBlobRef[] {
  if (!part || typeof part !== 'object') return [];
  const { mask, subset } = part as { mask?: unknown; subset?: unknown };
  return [mask, subset].filter(
    (ref): ref is SplatEditBlobRef =>
      !!ref && typeof ref === 'object' && typeof (ref as { key?: unknown }).key === 'string',
  );
}

/**
 * Keys of the blobs referenced by the `splat-edit` parts of an annotation.
 *
 * The column is free JSON and may have been written by an earlier version: the read assumes nothing about
 * its shape.
 */
export function splatEditBlobKeys(annotation: unknown): string[] {
  if (!Array.isArray(annotation)) return [];
  const keys = annotation
    .filter((part) => (part as { type?: unknown } | null)?.type === 'splat-edit')
    .flatMap(refsOf)
    .map((ref) => ref.key);
  return [...new Set(keys)];
}

/**
 * Refuses a proposal whose blob is not an attachment of the comment, is missing from storage, or exceeds
 * the ceiling.
 *
 * All three refusals matter, and the first is the most important: **the blob must appear in the comment's
 * attachment list**. That list decides the object's life — it is prefix-filtered (so no one else's object),
 * and it is what the purge re-reads on edit as on deletion. A reference outside the list would yield an
 * object nothing collects: exactly the leak already found and closed here for comment images.
 *
 * `stat` is injected (the caller's `StorageService`): the check stays testable without MinIO, and it is what
 * makes the ceiling real rather than declarative.
 */
export async function assertSplatEditBlobs(
  annotation: unknown,
  opts: { attachedKeys: Iterable<string>; stat: (key: string) => Promise<{ size: number }> },
): Promise<void> {
  const keys = splatEditBlobKeys(annotation);
  if (keys.length === 0) return;
  const attached = new Set(opts.attachedKeys);
  for (const key of keys) {
    if (!attached.has(key)) throw badRequest('Splat edit data must be attached', 'SPLAT_EDIT_UNATTACHED');
    const size = await opts.stat(key).then(
      (o) => o.size,
      () => null,
    );
    if (size === null) throw badRequest('Splat edit data not found', 'SPLAT_EDIT_MISSING');
    if (size > MAX_SPLAT_EDIT_BLOB_BYTES)
      throw badRequest('Splat edit data too large', 'SPLAT_EDIT_TOO_LARGE');
  }
}
