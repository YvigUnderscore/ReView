// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../v2/i18n';
import { api } from './apiClient';

/**
 * Attachment as it is DISPLAYED. The MinIO key is not part of it: the client portal
 * receives the presigned URL, the name and the type, and nothing more.
 */
export interface DisplayAttachment {
  name?: string;
  contentType?: string;
  url?: string | null;
}

/** Studio-side attachment: the key is added to it, and it alone serves to rewrite the list. */
export interface CommentAttachment extends DisplayAttachment {
  key: string;
}

/** Types accepted as attachments (mirror of the backend Zod): images + PDF/zip/text. */
export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,.pdf,.zip,.txt';

/** Maximum number of attachments per comment (mirror of the backend Zod). */
export const MAX_COMMENT_ATTACHMENTS = 8;

export function isAllowedAttachment(contentType: string): boolean {
  return /^(image\/(png|jpe?g|webp|gif)|application\/(pdf|zip)|text\/plain|audio\/(webm|ogg|mp4|mpeg|wav))(;.*)?$/.test(
    contentType,
  );
}

/** Attachment displayed as a thumbnail (the others are downloadable file chips). */
export function isImageAttachment(contentType?: string): boolean {
  return !!contentType && contentType.startsWith('image/');
}

/** Voice note (32.F): played inline in the thread via an audio player. */
export function isAudioAttachment(contentType?: string): boolean {
  return !!contentType && contentType.startsWith('audio/');
}

/**
 * Uploads the attachments of a comment: presigning, then direct PUT to MinIO.
 * Returns the descriptors (key/name/type) to attach to the comment.
 */
export async function uploadCommentAttachments(files: File[]): Promise<CommentAttachment[]> {
  const allowed = files.filter((f) => isAllowedAttachment(f.type)).slice(0, MAX_COMMENT_ATTACHMENTS);
  const out: CommentAttachment[] = [];
  for (const file of allowed) {
    const { url, key } = await api.post<{ url: string; key: string }>('/api/comments/attachments/presign', {
      filename: file.name,
      contentType: file.type,
    });
    const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!put.ok) throw new Error(t('uploads.failedFor', { name: file.name }));
    out.push({ key, name: file.name, contentType: file.type });
  }
  return out;
}
