// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isImageAttachment, type CommentAttachment } from '../../../lib/commentAttachments';

/**
 * Attachments of a composer: those already stored (when editing a comment) and the local files
 * still pending, merged into a single displayable list.
 *
 * Before sending, an attachment was only identified by its file name, so there was no way to
 * check what was being sent when the capture was named "image (3).png". Each item is therefore
 * given a URL: presigned for existing ones, `blob:` for a pending file.
 */
export interface AttachmentDraft {
  /** Removal identifier: the MinIO key of an already stored attachment, otherwise `file:<index>`. */
  id: string;
  name: string;
  contentType?: string;
  /** Display URL, or `null` until the local thumbnail is ready. */
  url: string | null;
}

/** A local file has no key, only a place in the pending list. */
export const fileDraftId = (index: number): string => `file:${index}`;

/** Index of the designated local file, or `null` if the identifier targets an already stored attachment. */
export function fileIndexOf(id: string): number | null {
  const match = /^file:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** Merges the two batches in display order: existing items first, additions after. */
export function toDrafts(
  existing: readonly CommentAttachment[],
  files: readonly File[],
  previews: readonly string[],
): AttachmentDraft[] {
  return [
    ...existing.map((a) => ({
      id: a.key,
      name: a.name ?? '',
      contentType: a.contentType,
      url: a.url ?? null,
    })),
    ...files.map((f, i) => ({
      id: fileDraftId(i),
      name: f.name,
      contentType: f.type,
      url: previews[i] ?? null,
    })),
  ];
}

/** Removes the designated item from its batch, leaving the other one untouched. */
export function removeDraft(
  id: string,
  files: readonly File[],
  existing: readonly CommentAttachment[],
): { files: File[]; existing: CommentAttachment[] } {
  const index = fileIndexOf(id);
  return index === null
    ? { files: [...files], existing: existing.filter((a) => a.key !== id) }
    : { files: files.filter((_, i) => i !== index), existing: [...existing] };
}

/** Thumbnails openable in the carousel: the images for which a URL is actually available. */
export const imageDrafts = (drafts: readonly AttachmentDraft[]): AttachmentDraft[] =>
  drafts.filter((d) => !!d.url && isImageAttachment(d.contentType));
