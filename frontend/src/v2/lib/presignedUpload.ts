// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '@/lib/apiClient';

/**
 * Direct uploads to object storage: the API signs a URL, the browser PUTs the bytes to it.
 *
 * The PUT goes to MinIO/S3, not to our API — on purpose, it carries no session token and must not
 * go through `apiClient`. Its failure therefore comes back without any message from us; every
 * caller passes the sentence the reader should see. This sequence had been copied into a dozen
 * screens, each with its own slight variant.
 */

/** PUT `body` to a presigned URL. `contentType: null` sends none (the signature did not include one). */
export async function putToPresignedUrl(
  url: string,
  body: Blob,
  failureMessage: string,
  contentType: string | null = body.type,
): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body,
    headers: contentType ? { 'Content-Type': contentType } : undefined,
  });
  if (!res.ok) throw new Error(failureMessage);
}

/**
 * Asks the API for a presigned URL (`presignPath`, body `presignBody`), uploads `file` to it, and
 * returns the presign response (the storage key, sometimes a read URL).
 */
export async function presignAndUpload<P extends { url: string; key: string }>(
  presignPath: string,
  presignBody: Record<string, unknown>,
  file: Blob,
  failureMessage: string,
): Promise<P> {
  const presigned = await api.post<P>(presignPath, presignBody);
  await putToPresignedUrl(presigned.url, file, failureMessage);
  return presigned;
}

/** Image formats accepted for logos, avatars and backgrounds. */
export const isWebImage = (type: string): boolean => /^image\/(png|jpe?g|webp)$/.test(type);
