// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from './prisma';

/**
 * Ce qu'une carte de plan, de séquence ou d'asset affiche en plus de son nom.
 *
 * Une carte ne disait que « douze tâches ». Elle ne répondait à aucune des questions qu'on
 * se pose en balayant une grille de deux cents plans : de quoi s'agit-il, qui s'en occupe,
 * y a-t-il quelque chose à regarder, et depuis quand ça n'a pas bougé. Les trois premières
 * viennent des relations ; la quatrième d'un décompte qu'aucun `_count` de Prisma ne sait
 * exprimer — d'où cette requête groupée.
 */

/**
 * Sélection commune des personnes assignées.
 *
 * `avatarKey` plutôt qu'une URL : la signature MinIO se calcule au moment de servir, et
 * une page de deux cents cartes n'a pas à en demander deux cents.
 */
export const CARD_ASSIGNEE_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  avatarKey: true,
} as const;

/**
 * Combien de livraisons attendent une décision de review, par entité.
 *
 * « En attente » se définit strictement : une version **publiée** (donc visible d'un
 * superviseur) qui ne porte **aucune décision** (`reviewStatusId` nul). Une version encore
 * en brouillon n'attend personne, et une version déjà validée ou refusée non plus.
 *
 * Une seule requête pour la page entière : la variante par carte demandait deux cents
 * agrégats pour afficher deux cents pastilles.
 */
export async function awaitingReviewByShot(shotIds: number[]): Promise<Map<number, number>> {
  if (shotIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ shotId: number; count: number }[]>`
    SELECT t."shotId" AS "shotId", COUNT(*)::int AS "count"
    FROM "Version" v
    JOIN "Task" t ON t.id = v."taskId"
    WHERE t."shotId" = ANY(${shotIds})
      AND v."deletedAt" IS NULL
      AND v.published = true
      AND v."reviewStatusId" IS NULL
    GROUP BY t."shotId"
  `;
  return new Map(rows.map((r) => [r.shotId, r.count]));
}

/**
 * Même décompte pour les assets — deux chemins de rattachement.
 *
 * Une version peut pendre d'une tâche de l'asset **ou** de l'asset lui-même (`Version`
 * porte un XOR de parent). N'en compter qu'un laissait la moitié des livraisons hors du
 * décompte selon la façon dont le studio publie.
 */
export async function awaitingReviewByAsset(assetIds: number[]): Promise<Map<number, number>> {
  if (assetIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ assetId: number; count: number }[]>`
    SELECT COALESCE(v."assetId", t."assetId") AS "assetId", COUNT(*)::int AS "count"
    FROM "Version" v
    LEFT JOIN "Task" t ON t.id = v."taskId"
    WHERE COALESCE(v."assetId", t."assetId") = ANY(${assetIds})
      AND v."deletedAt" IS NULL
      AND v.published = true
      AND v."reviewStatusId" IS NULL
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.assetId, r.count]));
}

/**
 * Même décompte agrégé au niveau d'une séquence : ses plans cumulés.
 *
 * Une séquence n'a pas de livraison propre ; ce qui l'attend, c'est ce qui attend ses
 * plans. Un superviseur de séquence lit cette pastille pour savoir s'il a des dailies.
 */
export async function awaitingReviewBySequence(sequenceIds: number[]): Promise<Map<number, number>> {
  if (sequenceIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ sequenceId: number; count: number }[]>`
    SELECT s."sequenceId" AS "sequenceId", COUNT(*)::int AS "count"
    FROM "Version" v
    JOIN "Task" t ON t.id = v."taskId"
    JOIN "Shot" s ON s.id = t."shotId"
    WHERE s."sequenceId" = ANY(${sequenceIds})
      AND s."deletedAt" IS NULL
      AND s."hiddenAt" IS NULL
      AND v."deletedAt" IS NULL
      AND v.published = true
      AND v."reviewStatusId" IS NULL
    GROUP BY s."sequenceId"
  `;
  return new Map(rows.map((r) => [r.sequenceId, r.count]));
}
