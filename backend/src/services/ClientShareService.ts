// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import { Prisma, ShareScope, type MediaKind, type MediaObject, type ShareLink } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { shareState, verifyShareSession } from '../lib/shareAccess';
import { AppError, notFound, unauthorized } from '../lib/errors';
import { SETTING_KEYS } from '../lib/settings';

/**
 * Accès public par lien de partage (35.C/35.D) — logique commune aux routes `/api/client`.
 * Principe : l'ouverture d'une session de partage (JWT court) consomme une vue ; les
 * sous-routes exigent cette session, la limite de vues ne peut donc pas être contournée.
 */

export const STUDIO_LOGO_KEY = SETTING_KEYS.STUDIO_LOGO;

/**
 * Plafond de médias servis par la page publique. Un lien de projet sur un long-métrage
 * renvoyait la table entière, sans `take` : plusieurs milliers de lignes et autant d'URLs
 * présignées de miniature, à chaque ouverture. Au-delà de ce plafond, la page annonce
 * `hasMore` — la réponse d'un lien qui montre trop est de le restreindre, pas de pagineer
 * un catalogue devant un client.
 */
export const SHARE_MEDIA_LIMIT = 200;

/**
 * Médias visibles côté client : publiés, READY, version publiée, dans le projet partagé.
 * Les filtres `deletedAt: null` sont indispensables : la corbeille est un soft-delete, et
 * sans eux un plan mis à la corbeille reste listé — et téléchargeable — sur le lien public,
 * alors qu'il a disparu de l'interface interne.
 */
export const publishedMediaWhere = (projectId: number) => ({
  status: 'READY' as const,
  published: true,
  deletedAt: null,
  version: {
    published: true,
    deletedAt: null,
    OR: [
      { task: { shot: { projectId, deletedAt: null } } },
      { task: { asset: { projectId, deletedAt: null } } },
      { asset: { projectId, deletedAt: null } },
    ],
  },
});

/** Ce qu'il faut savoir d'un lien pour décider ce qu'il ouvre. */
export interface ShareScopeRef {
  projectId: number;
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  /** Sélection explicite (portée MEDIA) ; vide pour les autres portées. */
  mediaIds: number[];
}

/** Lien chargé, sa sélection de médias aplatie en identifiants. */
export type ShareRecord = ShareLink & { mediaIds: number[] };

/**
 * Filtre qui ne retient aucun média. Une portée dont la cible a disparu ne doit pas
 * retomber sur « tout le projet » : c'est exactement l'élargissement silencieux que la
 * portée existe pour empêcher.
 */
const MATCHES_NOTHING: Prisma.MediaObjectWhereInput = { id: { in: [] } };

/**
 * Ce que CE lien ouvre — à appliquer partout où le partage lit un média (liste, URL
 * présignée, fil de commentaires), et pas seulement à l'affichage de la liste : sinon un
 * client à qui l'on n'a montré qu'un plan télécharge les autres en devinant leur id.
 */
export function shareMediaWhere(share: ShareScopeRef): Prisma.MediaObjectWhereInput {
  const base = publishedMediaWhere(share.projectId);
  switch (share.scope) {
    case ShareScope.PLAYLIST:
      return share.playlistId == null
        ? MATCHES_NOTHING
        : {
            ...base,
            version: { ...base.version, playlistItems: { some: { playlistId: share.playlistId } } },
          };
    case ShareScope.VERSION:
      return share.versionId == null ? MATCHES_NOTHING : { ...base, versionId: share.versionId };
    case ShareScope.MEDIA:
      return share.mediaIds.length === 0 ? MATCHES_NOTHING : { ...base, id: { in: share.mediaIds } };
    case ShareScope.PROJECT:
    default:
      return base;
  }
}

/** Lien par token, ou 404 s'il est inconnu/révoqué/expiré (sans distinguer, anti-énumération). */
export async function loadShare(token: string): Promise<ShareRecord> {
  const share = await prisma.shareLink.findUnique({
    where: { token },
    include: { media: { select: { mediaObjectId: true } } },
  });
  if (!share) throw notFound('Invalid or expired link');
  const state = shareState(share);
  if (state === 'revoked' || state === 'expired') throw notFound('Invalid or expired link');
  const { media, ...rest } = share;
  return { ...rest, mediaIds: media.map((m) => m.mediaObjectId) };
}

/**
 * Sous-routes : lien valide + session de partage obligatoire (header `X-Share-Auth`).
 * Un lien épuisé reste lisible pour une session déjà ouverte (la vue est comptée).
 */
export async function loadShareWithSession(token: string, req: Request): Promise<ShareRecord> {
  const share = await loadShare(token);
  if (!verifyShareSession(req.header('x-share-auth') ?? undefined, share.id)) {
    throw unauthorized('A share session is required');
  }
  return share;
}

/** Une tuile de la page publique. */
export interface ShareMediaTile {
  id: number;
  kind: MediaKind;
  originalName: string;
  thumbnailUrl: string | null;
}

/** Médias du lien, bornés, avec de quoi dire au destinataire qu'il n'a pas tout. */
export async function listShareMedia(
  share: ShareScopeRef,
): Promise<{ media: ShareMediaTile[]; total: number; hasMore: boolean }> {
  const where = shareMediaWhere(share);
  const [rows, total] = await Promise.all([
    prisma.mediaObject.findMany({
      where,
      // `id` départage : deux médias créés dans la même milliseconde (un import de lot)
      // s'échangeaient leur place d'un appel à l'autre.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SHARE_MEDIA_LIMIT,
      select: { id: true, kind: true, originalName: true, thumbnailKey: true },
    }),
    prisma.mediaObject.count({ where }),
  ]);
  const media = await Promise.all(
    rows.map(async (m) => ({
      id: m.id,
      kind: m.kind,
      originalName: m.originalName,
      thumbnailUrl: m.thumbnailKey ? await storage.getPresignedGetUrl(m.thumbnailKey) : null,
    })),
  );
  return { media, total, hasMore: total > rows.length };
}

/**
 * Un média précis, s'il est dans la portée du lien. Le `AND` n'est pas cosmétique : la
 * portée MEDIA pose elle-même un filtre `id`, qu'un objet littéral écraserait.
 */
export async function findShareMedia(share: ShareScopeRef, id: number): Promise<MediaObject> {
  const media = await prisma.mediaObject.findFirst({ where: { AND: [{ id }, shareMediaWhere(share)] } });
  if (!media) throw notFound('Media not found, or not published');
  return media;
}

/**
 * Consomme une vue (incrément atomique, borné par `maxViews` côté SQL pour éviter toute
 * course). Lève 410 si la limite est atteinte.
 */
export async function consumeView(share: ShareLink): Promise<void> {
  const where =
    share.maxViews != null ? { id: share.id, viewCount: { lt: share.maxViews } } : { id: share.id };
  const updated = await prisma.shareLink.updateMany({
    where,
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });
  if (updated.count === 0) throw new AppError('This link has reached its view limit', 410);
}

/** Habillage studio de la page client : nom + logo (Setting `studio_logo_key`, présigné). */
export async function studioBranding(): Promise<{ name: string; logoUrl: string | null }> {
  const [studio, logo] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: STUDIO_LOGO_KEY } }),
  ]);
  return {
    name: studio?.name ?? 'ReView',
    logoUrl: logo?.value
      ? await storage.getPresignedGetUrl(logo.value, 3600, imageTypeFromKey(logo.value))
      : null,
  };
}
