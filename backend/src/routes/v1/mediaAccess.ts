// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { mediaSelect, toMedia } from '../../lib/v1Resources';
import { storage } from '../../services/StorageService';
import { mediaSourceKey } from '../../services/MediaService';
import { requireMediaProject } from './helpers';
import { requireUser } from '../../middleware/auth';

/**
 * File reads from API v1: the half of the contract that was missing.
 *
 * The API could publish a render but not fetch one back: a Nuke script could not retrieve the
 * latest approved plate without going through `/api/media/:id/url`, that is, the internal surface
 * the v1 documentation declares unstable.
 *
 * The file never transits through the API: a presigned URL is returned, as on upload. Only three
 * variants, those that exist for every media type; HLS delivery stays with the web player, it makes
 * no sense for an artist workstation that wants the file.
 */

export const MEDIA_VARIANTS = ['source', 'proxy', 'thumbnail'] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/** Default validity of a read URL (one hour), capped at 24 h. */
export const DEFAULT_URL_TTL = 3600;

export const urlQuery = z.object({
  variant: z.enum(MEDIA_VARIANTS).default('source'),
  expiresIn: z.coerce.number().int().min(60).max(86_400).default(DEFAULT_URL_TTL),
});

/** Columns needed for the visibility check AND for signing the variants. */
const readableSelect = {
  ...mediaSelect,
  versionId: true,
  uploaderId: true,
  deletedAt: true,
  storageKey: true,
  thumbnailKey: true,
  metadata: true,
} satisfies Prisma.MediaObjectSelect;

export type ReadableMedia = Prisma.MediaObjectGetPayload<{ select: typeof readableSelect }>;

/**
 * Media readable by the caller: it exists, is not in the trash, and is published, or was uploaded
 * by the caller themselves. Same rule as the internal API (`MediaService.getUrl`), preceded by the
 * three v1 guards (project, membership, token scoping).
 */
export async function loadReadableMedia(req: Request, id: number): Promise<ReadableMedia> {
  await requireMediaProject(req, id);
  const media = await prisma.mediaObject.findUnique({ where: { id }, select: readableSelect });
  if (!media || media.deletedAt) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== requireUser(req).id) throw notFound('Media not found');
  return media;
}

type MediaMeta = { proxyKey?: string; trim?: unknown; trimProxyKey?: string };

/**
 * Storage key of a variant, or `null` if this media does not carry it.
 *
 * `proxy` follows the non-destructive cut when one was produced: it is the file the review plays,
 * so the one a tool must fetch to show the same thing. Trimming was removed in Phase 50 (batch 4)
 * and nothing produces `trimProxyKey` any more; this read stays for **historical** cuts. Without
 * it, an external client fetching `proxy` for a conform would get a longer file than the review,
 * with no error or warning.
 */
export function variantKey(media: ReadableMedia, variant: MediaVariant): string | null {
  const meta = (media.metadata ?? {}) as MediaMeta;
  if (variant === 'thumbnail') return media.thumbnailKey;
  if (variant === 'proxy') {
    return (meta.trim && meta.trimProxyKey ? meta.trimProxyKey : meta.proxyKey) ?? null;
  }
  return mediaSourceKey(media);
}

/** Presigned URL of a variant: an explicit 404 rather than a URL that renders nothing. */
export async function signVariant(
  media: ReadableMedia,
  variant: MediaVariant,
  expiresIn: number,
): Promise<string> {
  const key = variantKey(media, variant);
  if (!key) throw notFound(`This media has no « ${variant} » variant`, 'VARIANT_UNAVAILABLE');
  return storage.getPresignedGetUrl(key, expiresIn);
}

/** Minimum needed to sign a media's source: the v1 contract plus the storage key. */
export type SignableMedia = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }> & {
  storageKey: string;
  metadata: Prisma.JsonValue;
};

/** Media resource of the v1 contract, plus the URL of its source. */
export const toMediaWithUrl = async (
  row: SignableMedia,
  expiresIn: number,
): Promise<ReturnType<typeof toMedia> & { url: string }> => ({
  ...toMedia(row),
  url: await storage.getPresignedGetUrl(mediaSourceKey(row), expiresIn),
});
