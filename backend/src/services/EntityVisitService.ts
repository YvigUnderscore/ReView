// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { VisitTargetType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  activityByAsset,
  activityBySequence,
  activityByShot,
  unseenFrom,
  type FreshnessRow,
} from '../lib/entityFreshness';

/**
 * L'état « non consulté » (Phase 50, lot 9).
 *
 * Une carte s'allume quand l'entité a bougé depuis que **cette personne** l'a ouverte pour
 * la dernière fois. Deux dates suffisent à le dire : l'activité de l'entité — la sienne et
 * celle de sa descendance, calculée par `lib/entityFreshness` — et la date de visite,
 * écrite ici. Ouvrir éteint ; toute modification postérieure rallume.
 *
 * Tout se lit **en lot**, pour la page entière. La variante par carte aurait demandé une
 * requête de visite et trois agrégats par ligne, soit huit cents allers-retours pour une
 * page de deux cents plans — le genre de multiplication qui a déjà coûté cher sur ces
 * mêmes listes.
 */

/** Ce que chaque fonction d'activité sait faire : une famille d'entités, en lot. */
type ActivityReader = (rows: FreshnessRow[]) => Promise<Map<number, Date>>;

/** Les visites de cette personne, pour ce type, parmi ces ids. Une requête pour la page. */
export async function visitedAtFor(
  userId: number,
  targetType: VisitTargetType,
  ids: number[],
): Promise<Map<number, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.entityVisit.findMany({
    where: { userId, targetType, targetId: { in: ids } },
    select: { targetId: true, visitedAt: true },
  });
  return new Map(rows.map((r) => [r.targetId, r.visitedAt]));
}

/** Marque une entité consultée : la lueur s'éteint. Idempotent — la date est écrasée. */
export async function markVisited(
  userId: number,
  targetType: VisitTargetType,
  targetId: number,
): Promise<Date> {
  const visitedAt = new Date();
  await prisma.entityVisit.upsert({
    where: { userId_targetType_targetId: { userId, targetType, targetId } },
    update: { visitedAt },
    create: { userId, targetType, targetId, visitedAt },
  });
  return visitedAt;
}

/**
 * « Tout marquer comme lu » : une seule instruction pour toute la liste.
 *
 * Un `upsert` par carte aurait demandé deux mille allers-retours sur un long-métrage.
 * L'`ON CONFLICT` insère et met à jour d'un coup, et rend le geste atomique : deux clics
 * simultanés ne peuvent pas se croiser sur une violation d'unicité — ce qu'un `deleteMany`
 * suivi d'un `createMany`, même en transaction, n'aurait pas garanti.
 *
 * Renvoie le nombre de lignes écrites.
 */
export async function markManyVisited(
  userId: number,
  targetType: VisitTargetType,
  ids: number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const visitedAt = new Date();
  return prisma.$executeRaw`
    INSERT INTO "EntityVisit" ("userId", "targetType", "targetId", "visitedAt")
    SELECT ${userId}, ${targetType}::"VisitTargetType", src.id, ${visitedAt}
    FROM unnest(${ids}::int[]) AS src(id)
    ON CONFLICT ("userId", "targetType", "targetId")
      DO UPDATE SET "visitedAt" = EXCLUDED."visitedAt"
  `;
}

/**
 * Ce que « tout marquer comme lu » embrasse : les entités vivantes d'un projet, par type.
 *
 * Les ids sont établis **par le serveur** à partir du seul projet, jamais reçus du client.
 * Une liste d'ids postée aurait demandé d'en vérifier l'appartenance une par une — donc
 * autant de requêtes que d'entités, et une occasion de se tromper. Ici l'autorisation
 * tient en une seule assertion d'accès au projet, faite dans la route.
 *
 * Les éléments en corbeille ou masqués sont exclus : ils ne sont dans aucune liste, et les
 * marquer lus écrirait des lignes que personne ne relira jamais.
 */
export async function visitableIdsOfProject(
  projectId: number,
  targetType: VisitTargetType,
): Promise<number[]> {
  const alive = { projectId, deletedAt: null, hiddenAt: null };
  if (targetType === VisitTargetType.SHOT)
    return (await prisma.shot.findMany({ where: alive, select: { id: true } })).map((r) => r.id);
  if (targetType === VisitTargetType.SEQUENCE)
    return (await prisma.sequence.findMany({ where: alive, select: { id: true } })).map((r) => r.id);
  if (targetType === VisitTargetType.ASSET)
    return (await prisma.asset.findMany({ where: alive, select: { id: true } })).map((r) => r.id);
  // Les autres types n'ont pas encore de liste qui les allume : rien à marquer.
  return [];
}

/** Fabrique commune : active la lecture d'activité, la confronte aux visites. */
async function unseenBy(
  userId: number,
  targetType: VisitTargetType,
  rows: FreshnessRow[],
  activity: ActivityReader,
): Promise<Map<number, boolean>> {
  if (rows.length === 0) return new Map();
  const [dates, visits] = await Promise.all([
    activity(rows),
    visitedAtFor(
      userId,
      targetType,
      rows.map((r) => r.id),
    ),
  ]);
  return unseenFrom(dates, visits);
}

/** « Ce plan a bougé depuis que je l'ai ouvert » — pour la page entière. */
export function unseenByShot(userId: number, rows: FreshnessRow[]): Promise<Map<number, boolean>> {
  return unseenBy(userId, VisitTargetType.SHOT, rows, activityByShot);
}

/** Idem pour une séquence : ses plans et leurs livraisons comptent comme son activité. */
export function unseenBySequence(userId: number, rows: FreshnessRow[]): Promise<Map<number, boolean>> {
  return unseenBy(userId, VisitTargetType.SEQUENCE, rows, activityBySequence);
}

/** Idem pour un asset, ses deux chemins de rattachement de version compris. */
export function unseenByAsset(userId: number, rows: FreshnessRow[]): Promise<Map<number, boolean>> {
  return unseenBy(userId, VisitTargetType.ASSET, rows, activityByAsset);
}
