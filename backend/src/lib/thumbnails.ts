// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';
import { storage } from '../services/StorageService';

/**
 * Résolution des miniatures « effectives » pour les cartes (projets, assets, shots).
 * Règle : miniature explicite (thumbnailKey) si définie, sinon celle du premier média
 * publié rattaché. Renvoie une URL présignée prête à l'affichage (ou null).
 */

const firstMediaThumbKey = async (versionFilter: object): Promise<string | null> => {
  const media = await prisma.mediaObject.findFirst({
    where: { published: true, deletedAt: null, thumbnailKey: { not: null }, version: versionFilter },
    orderBy: { createdAt: 'asc' },
    select: { thumbnailKey: true },
  });
  return media?.thumbnailKey ?? null;
};

export const firstMediaThumbKeyForProject = (projectId: number) =>
  firstMediaThumbKey({
    OR: [{ task: { shot: { projectId } } }, { task: { asset: { projectId } } }, { asset: { projectId } }],
  });

export const firstMediaThumbKeyForAsset = (assetId: number) =>
  firstMediaThumbKey({ OR: [{ assetId }, { task: { assetId } }] });

export const firstMediaThumbKeyForShot = (shotId: number) => firstMediaThumbKey({ task: { shotId } });

/**
 * Variantes groupées (B3) : une seule requête pour toute une page de cartes.
 *
 * Les listes appelaient la variante unitaire dans un `.map` : cent plans, cent requêtes,
 * suivies de cent signatures MinIO. C'est ce qui rendait l'ouverture d'un projet lente
 * bien avant que le volume ne devienne un problème.
 *
 * On récupère les miniatures candidates en une passe, triées de la plus ancienne à la
 * plus récente, puis on élit la première par parent en mémoire — même règle qu'avant,
 * un seul aller-retour.
 */
async function firstThumbKeysBy(
  where: object,
  pick: (media: { thumbnailKey: string | null; version: unknown }) => number | null,
): Promise<Map<number, string>> {
  const rows = await prisma.mediaObject.findMany({
    where: { published: true, deletedAt: null, thumbnailKey: { not: null }, ...where },
    orderBy: { createdAt: 'asc' },
    select: {
      thumbnailKey: true,
      version: { select: { assetId: true, task: { select: { shotId: true, assetId: true } } } },
    },
  });
  const out = new Map<number, string>();
  for (const row of rows) {
    const id = pick(row);
    // Le premier rencontré gagne : la requête est déjà triée par date de création.
    if (id !== null && row.thumbnailKey && !out.has(id)) out.set(id, row.thumbnailKey);
  }
  return out;
}

/** Miniature de repli de chaque plan de la liste, en une requête. */
export function firstMediaThumbKeysForShots(shotIds: number[]): Promise<Map<number, string>> {
  if (shotIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy({ version: { task: { shotId: { in: shotIds } } } }, (m) => {
    const version = m.version as { task: { shotId: number | null } | null } | null;
    return version?.task?.shotId ?? null;
  });
}

/** Miniature de repli de chaque asset de la liste, en une requête. */
export function firstMediaThumbKeysForAssets(assetIds: number[]): Promise<Map<number, string>> {
  if (assetIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    {
      version: {
        OR: [{ assetId: { in: assetIds } }, { task: { assetId: { in: assetIds } } }],
      },
    },
    (m) => {
      const version = m.version as {
        assetId: number | null;
        task: { assetId: number | null } | null;
      } | null;
      return version?.assetId ?? version?.task?.assetId ?? null;
    },
  );
}

/** URL présignée de la miniature effective (explicite ou fallback premier média). */
export async function effectiveThumbnailUrl(
  explicitKey: string | null,
  fallbackKey: string | null,
): Promise<string | null> {
  const key = explicitKey ?? fallbackKey;
  return key ? storage.getPresignedGetUrl(key) : null;
}
