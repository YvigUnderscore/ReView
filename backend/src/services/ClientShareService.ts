// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request } from 'express';
import type { ShareLink } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { storage } from './StorageService';
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

/** Lien par token, ou 404 s'il est inconnu/révoqué/expiré (sans distinguer, anti-énumération). */
export async function loadShare(token: string): Promise<ShareLink> {
  const share = await prisma.shareLink.findUnique({ where: { token } });
  if (!share) throw notFound('Lien invalide ou expiré');
  const state = shareState(share);
  if (state === 'revoked' || state === 'expired') throw notFound('Lien invalide ou expiré');
  return share;
}

/**
 * Sous-routes : lien valide + session de partage obligatoire (header `X-Share-Auth`).
 * Un lien épuisé reste lisible pour une session déjà ouverte (la vue est comptée).
 */
export async function loadShareWithSession(token: string, req: Request): Promise<ShareLink> {
  const share = await loadShare(token);
  if (!verifyShareSession(req.header('x-share-auth') ?? undefined, share.id)) {
    throw unauthorized('Session de partage requise');
  }
  return share;
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
  if (updated.count === 0) throw new AppError('Limite de vues de ce lien atteinte', 410);
}

/** Habillage studio de la page client : nom + logo (Setting `studio_logo_key`, présigné). */
export async function studioBranding(): Promise<{ name: string; logoUrl: string | null }> {
  const [studio, logo] = await Promise.all([
    prisma.studio.findFirst({ select: { name: true } }),
    prisma.setting.findUnique({ where: { key: STUDIO_LOGO_KEY } }),
  ]);
  return {
    name: studio?.name ?? 'ReView',
    logoUrl: logo?.value ? await storage.getPresignedGetUrl(logo.value) : null,
  };
}
