// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma } from '@prisma/client';
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
 * Une séquence et un épisode n'avaient, eux, aucune image de repli : seule une vignette
 * déposée à la main leur en donnait une, si bien que leurs cartes restaient vides alors
 * que leurs plans, eux, en avaient. Ils héritent donc de la même règle — la miniature du
 * premier média publié d'un de leurs plans. Les plans supprimés ou masqués sont écartés :
 * une séquence ne doit pas s'afficher avec l'image d'un plan qu'on n'y voit plus.
 */
export const firstMediaThumbKeyForSequence = (sequenceId: number) =>
  firstMediaThumbKey({ task: { shot: { sequenceId, deletedAt: null, hiddenAt: null } } });

export const firstMediaThumbKeyForEpisode = (episodeId: number) =>
  firstMediaThumbKey({
    task: { shot: { deletedAt: null, hiddenAt: null, sequence: { episodeId, deletedAt: null } } },
  });

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
  // Ce que la requête doit ramener de la version pour retrouver le parent. Le rattachement
  // par défaut (asset, plan) suffit aux listes de plans et d'assets ; une séquence ou un
  // épisode se rejoint plus loin, à travers le plan.
  versionSelect: Prisma.VersionSelect = { assetId: true, task: { select: { shotId: true, assetId: true } } },
): Promise<Map<number, string>> {
  const rows = await prisma.mediaObject.findMany({
    where: { published: true, deletedAt: null, thumbnailKey: { not: null }, ...where },
    orderBy: { createdAt: 'asc' },
    select: { thumbnailKey: true, version: { select: versionSelect } },
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

/** Miniature de repli de chaque séquence de la liste, en une requête. */
export function firstMediaThumbKeysForSequences(sequenceIds: number[]): Promise<Map<number, string>> {
  if (sequenceIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    {
      version: {
        task: { shot: { sequenceId: { in: sequenceIds }, deletedAt: null, hiddenAt: null } },
      },
    },
    (m) => {
      const version = m.version as { task: { shot: { sequenceId: number | null } | null } | null } | null;
      return version?.task?.shot?.sequenceId ?? null;
    },
    { task: { select: { shot: { select: { sequenceId: true } } } } },
  );
}

/** Miniature de repli de chaque épisode de la liste : le premier média d'un de ses plans. */
export function firstMediaThumbKeysForEpisodes(episodeIds: number[]): Promise<Map<number, string>> {
  if (episodeIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    {
      version: {
        task: {
          shot: {
            deletedAt: null,
            hiddenAt: null,
            sequence: { episodeId: { in: episodeIds }, deletedAt: null },
          },
        },
      },
    },
    (m) => {
      const version = m.version as {
        task: { shot: { sequence: { episodeId: number | null } | null } | null } | null;
      } | null;
      return version?.task?.shot?.sequence?.episodeId ?? null;
    },
    { task: { select: { shot: { select: { sequence: { select: { episodeId: true } } } } } } },
  );
}

/**
 * Miniature de repli de chaque projet de la page, en UNE requête.
 *
 * La liste appelait `firstMediaThumbKeyForProject` dans un `.map` : cent projets, cent
 * `findFirst` portant chacun un triple OR version → tâche → plan/asset → projet. Or la
 * barre latérale appelle cette route sur presque chaque écran. `DISTINCT ON` élit le
 * premier média publié de chaque projet côté PostgreSQL, sans rapatrier le reste.
 */
export async function firstMediaThumbKeysForProjects(projectIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (projectIds.length === 0) return out;
  const rows = await prisma.$queryRaw<{ projectId: number; thumbnailKey: string }[]>`
    SELECT DISTINCT ON (COALESCE(sh."projectId", ta."projectId", va."projectId"))
           COALESCE(sh."projectId", ta."projectId", va."projectId") AS "projectId",
           m."thumbnailKey"                                        AS "thumbnailKey"
    FROM "MediaObject" m
    JOIN "Version" v      ON v.id  = m."versionId"
    LEFT JOIN "Task" t    ON t.id  = v."taskId"
    LEFT JOIN "Shot" sh   ON sh.id = t."shotId"
    LEFT JOIN "Asset" ta  ON ta.id = t."assetId"
    LEFT JOIN "Asset" va  ON va.id = v."assetId"
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m."thumbnailKey" IS NOT NULL
      AND COALESCE(sh."projectId", ta."projectId", va."projectId") IN (${Prisma.join(projectIds)})
    ORDER BY COALESCE(sh."projectId", ta."projectId", va."projectId"), m."createdAt" ASC
  `;
  for (const row of rows) out.set(row.projectId, row.thumbnailKey);
  return out;
}

/** URL présignée de la miniature effective (explicite ou fallback premier média). */
export async function effectiveThumbnailUrl(
  explicitKey: string | null,
  fallbackKey: string | null,
): Promise<string | null> {
  const key = explicitKey ?? fallbackKey;
  return key ? storage.getPresignedGetUrl(key) : null;
}
