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
 * Le regroupement se faisait ensuite par un `findMany` SANS `take`, suivi d'une élection
 * du premier par parent EN MÉMOIRE : une page de cent plans rapatriait tous les médias
 * publiés de ces cent plans (2 009 lignes mesurées à dix versions par plan) pour n'en
 * garder que cent — et le facteur d'amplification, c'est le nombre de médias par plan,
 * que rien ne borne dans un projet qui vit.
 *
 * L'élection se fait donc là où elle coûte le moins : `DISTINCT ON` côté PostgreSQL rend
 * UNE ligne par parent, comme le fait déjà `firstMediaThumbKeysForProjects` plus bas. Les
 * identifiants de la page voyagent en paramètres liés (`Prisma.join`), jamais concaténés.
 *
 * `m.id` départage deux médias créés à la même milliseconde : l'élection précédente les
 * départageait par le hasard du plan d'exécution (le premier rendu par le tri), donc sans
 * garantie de rendre deux fois la même image.
 */
async function firstThumbKeysBy(
  // Fragments SQL écrits ici, jamais construits à partir d'une entrée : `parentKey` est
  // l'expression qui identifie le parent, `joins` le chemin qui y mène depuis la version,
  // `filter` la restriction à la page demandée.
  parentKey: Prisma.Sql,
  joins: Prisma.Sql,
  filter: Prisma.Sql,
): Promise<Map<number, string>> {
  const rows = await prisma.$queryRaw<{ parentId: number; thumbnailKey: string }[]>`
    SELECT DISTINCT ON (${parentKey}) ${parentKey} AS "parentId",
           m."thumbnailKey"          AS "thumbnailKey"
    FROM "MediaObject" m
    JOIN "Version" v ON v.id = m."versionId"
    ${joins}
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m."thumbnailKey" IS NOT NULL
      AND ${filter}
    ORDER BY ${parentKey}, m."createdAt" ASC, m.id ASC
  `;
  const out = new Map<number, string>();
  for (const row of rows) out.set(row.parentId, row.thumbnailKey);
  return out;
}

/** Miniature de repli de chaque plan de la liste, en une requête. */
export function firstMediaThumbKeysForShots(shotIds: number[]): Promise<Map<number, string>> {
  if (shotIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`t."shotId"`,
    Prisma.sql`JOIN "Task" t ON t.id = v."taskId"`,
    Prisma.sql`t."shotId" IN (${Prisma.join(shotIds)})`,
  );
}

/**
 * Miniature de repli de chaque asset de la liste, en une requête.
 *
 * Une version peut pendre directement à l'asset ou passer par une tâche : le parent est le
 * premier des deux rattachements, exactement comme l'élection en mémoire le faisait.
 */
export function firstMediaThumbKeysForAssets(assetIds: number[]): Promise<Map<number, string>> {
  if (assetIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`COALESCE(v."assetId", t."assetId")`,
    Prisma.sql`LEFT JOIN "Task" t ON t.id = v."taskId"`,
    Prisma.sql`(v."assetId" IN (${Prisma.join(assetIds)}) OR t."assetId" IN (${Prisma.join(assetIds)}))`,
  );
}

/** Miniature de repli de chaque séquence de la liste, en une requête. */
export function firstMediaThumbKeysForSequences(sequenceIds: number[]): Promise<Map<number, string>> {
  if (sequenceIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`sh."sequenceId"`,
    Prisma.sql`JOIN "Task" t ON t.id = v."taskId" JOIN "Shot" sh ON sh.id = t."shotId"`,
    // Un plan supprimé ou masqué ne prête pas son image à sa séquence (règle d'origine).
    Prisma.sql`sh."sequenceId" IN (${Prisma.join(sequenceIds)}) AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL`,
  );
}

/** Miniature de repli de chaque épisode de la liste : le premier média d'un de ses plans. */
export function firstMediaThumbKeysForEpisodes(episodeIds: number[]): Promise<Map<number, string>> {
  if (episodeIds.length === 0) return Promise.resolve(new Map());
  return firstThumbKeysBy(
    Prisma.sql`sq."episodeId"`,
    Prisma.sql`JOIN "Task" t ON t.id = v."taskId"
               JOIN "Shot" sh ON sh.id = t."shotId"
               JOIN "Sequence" sq ON sq.id = sh."sequenceId"`,
    Prisma.sql`sq."episodeId" IN (${Prisma.join(episodeIds)})
               AND sq."deletedAt" IS NULL
               AND sh."deletedAt" IS NULL
               AND sh."hiddenAt" IS NULL`,
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
    ORDER BY COALESCE(sh."projectId", ta."projectId", va."projectId"), m."createdAt" ASC, m.id ASC
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
