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

/**
 * Lecture des fichiers depuis l'API v1 — la moitié qui manquait au contrat.
 *
 * L'API savait publier un rendu mais pas en rapatrier un : un script Nuke ne pouvait pas
 * récupérer la dernière plate approuvée sans passer par `/api/media/:id/url`, c'est-à-dire
 * par la surface interne que la documentation v1 déclare instable.
 *
 * Le fichier ne transite jamais par l'API : on rend une URL présignée, comme à l'envoi.
 * Trois variantes seulement, celles qui existent pour tous les types de média — la
 * diffusion HLS reste au lecteur web, elle n'a pas de sens pour un poste d'artiste qui
 * veut le fichier.
 */

export const MEDIA_VARIANTS = ['source', 'proxy', 'thumbnail'] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/** Durée de validité par défaut d'une URL de lecture (une heure), bornée à 24 h. */
export const DEFAULT_URL_TTL = 3600;

export const urlQuery = z.object({
  variant: z.enum(MEDIA_VARIANTS).default('source'),
  expiresIn: z.coerce.number().int().min(60).max(86_400).default(DEFAULT_URL_TTL),
});

/** Colonnes nécessaires au contrôle de visibilité ET à la signature des variantes. */
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
 * Média lisible par l'appelant : il existe, il n'est pas à la corbeille, et il est publié
 * — ou déposé par l'appelant lui-même. Même règle que l'API interne (`MediaService.getUrl`),
 * précédée des trois gardes v1 (projet, appartenance, cantonnement du token).
 */
export async function loadReadableMedia(req: Request, id: number): Promise<ReadableMedia> {
  await requireMediaProject(req, id);
  const media = await prisma.mediaObject.findUnique({ where: { id }, select: readableSelect });
  if (!media || media.deletedAt) throw notFound('Media not found');
  if (!media.published && media.uploaderId !== req.user!.id) throw notFound('Media not found');
  return media;
}

type MediaMeta = { proxyKey?: string; trim?: unknown; trimProxyKey?: string };

/**
 * Clé de stockage d'une variante, ou `null` si ce média ne la porte pas.
 * `proxy` suit la coupe non-destructive quand elle a été produite : c'est le fichier que
 * la review joue, donc celui qu'un outil doit récupérer pour montrer la même chose.
 */
export function variantKey(media: ReadableMedia, variant: MediaVariant): string | null {
  const meta = (media.metadata ?? {}) as MediaMeta;
  if (variant === 'thumbnail') return media.thumbnailKey;
  if (variant === 'proxy') {
    return (meta.trim && meta.trimProxyKey ? meta.trimProxyKey : meta.proxyKey) ?? null;
  }
  return mediaSourceKey(media);
}

/** URL présignée d'une variante — 404 explicite plutôt qu'une URL qui ne rendra rien. */
export async function signVariant(
  media: ReadableMedia,
  variant: MediaVariant,
  expiresIn: number,
): Promise<string> {
  const key = variantKey(media, variant);
  if (!key) throw notFound(`This media has no « ${variant} » variant`, 'VARIANT_UNAVAILABLE');
  return storage.getPresignedGetUrl(key, expiresIn);
}

/** Le minimum pour signer la source d'un média : le contrat v1 plus la clé de stockage. */
export type SignableMedia = Prisma.MediaObjectGetPayload<{ select: typeof mediaSelect }> & {
  storageKey: string;
  metadata: Prisma.JsonValue;
};

/** Ressource média du contrat v1, augmentée de l'URL de sa source. */
export const toMediaWithUrl = async (
  row: SignableMedia,
  expiresIn: number,
): Promise<ReturnType<typeof toMedia> & { url: string }> => ({
  ...toMedia(row),
  url: await storage.getPresignedGetUrl(mediaSourceKey(row), expiresIn),
});
