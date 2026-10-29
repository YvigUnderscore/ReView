// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '@/lib/apiClient';
import { MAX_COMMENT_ATTACHMENTS, type CommentAttachment } from '@/v2/lib/commentAttachments';
import { t } from '@/v2/i18n';
import type { SplatEditBlob, SplatEditBlobRef, SplatEditDraft } from './splatEditPart';

/**
 * Upload of the two binaries of a cloud-edit proposal (Phase 50, lot 14): the deletion mask and the
 * subset ops.
 *
 * They go as **attachments of the comment**: same presigning, same folder, and therefore the same
 * purge when the comment is edited or deleted. The `splat-edit` part keeps only their key, and it is
 * the server that then checks that each declared key is indeed one of the comment's attachments,
 * exists, and stays under the cap.
 *
 * Two refusals are decided HERE, before any upload, because they are better explained to the author
 * than after a 400: the blob that is too heavy, and the comment that no longer has room in its
 * attachment list.
 */

/** Cap of a blob: mirror of `MAX_SPLAT_EDIT_BLOB_BYTES` on the server side (4 MB). */
export const MAX_SPLAT_EDIT_BLOB_BYTES = 4_000_000;

const BLOB_TYPE = 'application/octet-stream';
/**
 * Names of the two objects. They are concatenated with the extension rather than interpolated: a
 * template would make these file names look like interface text to `check-untranslated`.
 */
const MASK_NAME = 'splat-mask.bin';
const SUBSET_NAME = 'splat-subset.bin';

/** What the upload returns: the references to set in the part, and the attachments to declare. */
export interface SplatEditUpload {
  refs: { mask: SplatEditBlobRef | null; subset: SplatEditBlobRef | null };
  attachments: CommentAttachment[];
  /** Why the binaries stayed on the ground, if they did: the caller tells the author. */
  dropped: 'size' | 'room' | null;
}

const NOTHING: SplatEditUpload = { refs: { mask: null, subset: null }, attachments: [], dropped: null };

/**
 * Uploads the binaries of the proposal. Nothing to deposit means nothing is called: a proposal that
 * deletes nothing must not cost a request.
 *
 * `slotsUsed` is the number of attachments the comment already carries (images of points of
 * interest, composer files): the two blobs enter the same list, and therefore the same cap.
 */
export async function uploadSplatEditBlobs(
  draft: SplatEditDraft | null,
  slotsUsed: number,
): Promise<SplatEditUpload> {
  const blobs: Array<[keyof SplatEditUpload['refs'], SplatEditBlob, string]> = [];
  if (draft?.mask) blobs.push(['mask', draft.mask, MASK_NAME]);
  if (draft?.subset) blobs.push(['subset', draft.subset, SUBSET_NAME]);
  if (blobs.length === 0) return NOTHING;
  if (blobs.some(([, blob]) => blob.bytes.byteLength > MAX_SPLAT_EDIT_BLOB_BYTES))
    return { ...NOTHING, dropped: 'size' };
  if (slotsUsed + blobs.length > MAX_COMMENT_ATTACHMENTS) return { ...NOTHING, dropped: 'room' };

  const out: SplatEditUpload = { refs: { mask: null, subset: null }, attachments: [], dropped: null };
  for (const [which, blob, name] of blobs) {
    const key = await putBlob(blob.bytes, name);
    out.refs[which] = { key, count: blob.count };
    out.attachments.push({ key, name, contentType: BLOB_TYPE });
  }
  return out;
}

/** Presigning, then direct PUT to MinIO: the same path as any other attachment. */
async function putBlob(bytes: Uint8Array, filename: string): Promise<string> {
  const { url, key } = await api.post<{ url: string; key: string }>('/api/comments/attachments/presign', {
    filename,
    contentType: BLOB_TYPE,
  });
  // The body goes through a `Blob`: `fetch` only accepts a typed view if it sits on its own
  // `ArrayBuffer`, which an encoded mask does not guarantee. The copy is the price of a call that
  // compiles without forcing the type.
  const body = new Blob([new Uint8Array(bytes)], { type: BLOB_TYPE });
  const put = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': BLOB_TYPE } });
  if (!put.ok) throw new Error(t('splat.proposalUploadFailed'));
  return key;
}
