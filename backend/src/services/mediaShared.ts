// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role } from '@prisma/client';

/**
 * Pure helpers shared by the media services: the caller type, JSON serialisation and the keys actually
 * served.
 */

/** The caller of a media operation, as the routes hand it over. */
export type SessionUser = { id: number; role: Role };

/** Serializes a media's BigInt `size` to a Number for the JSON response. */
export const serializeMedia = <T extends { size: bigint }>(m: T): Omit<T, 'size'> & { size: number } => ({
  ...m,
  size: Number(m.size),
});
/**
 * "Source" key actually served for a media: after video transcoding the original is deleted
 * (space saving) and the MP4 proxy becomes the source.
 */
export function mediaSourceKey(media: { storageKey: string; metadata: unknown }): string {
  const meta = (media.metadata ?? {}) as { proxyKey?: string; sourceDeleted?: boolean };
  return meta.sourceDeleted && meta.proxyKey ? meta.proxyKey : media.storageKey;
}

/**
 * Key actually **displayable** for a media: the web proxy when the original format is not
 * rendered by browsers (EXR, DPX, TIFF, TGA; see `lib/imageProxy`), the source otherwise.
 *
 * The distinction from `mediaSourceKey` is the cornerstone of production image review: the
 * viewer, A/B, wipe and diff consume this key, while download, API v1 and ShotGrid sends keep
 * delivering the original, which is the file the artist deposited.
 */
export function mediaViewKey(media: { storageKey: string; metadata: unknown }): string {
  const meta = (media.metadata ?? {}) as { webProxyKey?: string };
  return typeof meta.webProxyKey === 'string' && meta.webProxyKey.length > 0
    ? meta.webProxyKey
    : mediaSourceKey(media);
}
