// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, ShotgridLink } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/**
 * Table de correspondance locale ↔ ShotGrid.
 *
 * Toute entité importée y laisse une ligne : c'est elle qui rend les imports
 * idempotents (re-synchroniser ne duplique rien), qui permet de retrouver l'entité
 * distante d'un objet ReView pour l'écriture, et qui porte les champs ShotGrid sans
 * équivalent local (durée en minutes, assignés non-membres, chemins de publish).
 */

export type LocalType =
  | 'sequence'
  | 'shot'
  | 'asset'
  | 'task'
  | 'version'
  | 'media'
  | 'pipelineStatus'
  | 'reviewStatus'
  | 'user'
  | 'playlist'
  | 'comment';

export interface LinkData {
  [key: string]: unknown;
}

export async function findBySg(
  connectionId: number,
  sgType: string,
  sgId: number,
): Promise<ShotgridLink | null> {
  return prisma.shotgridLink.findUnique({
    where: { connectionId_sgType_sgId: { connectionId, sgType, sgId } },
  });
}

export async function findByLocal(
  connectionId: number,
  localType: LocalType,
  localId: number,
): Promise<ShotgridLink | null> {
  return prisma.shotgridLink.findUnique({
    where: { connectionId_localType_localId: { connectionId, localType, localId } },
  });
}

/** Identifiants ShotGrid d'un lot d'entités locales — évite N requêtes en boucle. */
export async function mapLocalToSg(
  connectionId: number,
  localType: LocalType,
): Promise<Map<number, ShotgridLink>> {
  const links = await prisma.shotgridLink.findMany({ where: { connectionId, localType } });
  return new Map(links.map((l) => [l.localId, l]));
}

export async function mapSgToLocal(
  connectionId: number,
  localType: LocalType,
): Promise<Map<number, ShotgridLink>> {
  const links = await prisma.shotgridLink.findMany({ where: { connectionId, localType } });
  return new Map(links.map((l) => [l.sgId, l]));
}

/**
 * Pose ou rafraîchit une correspondance.
 *
 * Le couple (connexion, entité distante) et le couple (connexion, entité locale) sont
 * tous deux uniques : une entité ne peut pas être liée deux fois, dans un sens comme
 * dans l'autre. Un ancien lien devenu incohérent est remplacé plutôt que dupliqué.
 */
export async function upsertLink(params: {
  connectionId: number;
  localType: LocalType;
  localId: number;
  sgType: string;
  sgId: number;
  sgUpdatedAt?: Date | null;
  data?: LinkData;
}): Promise<ShotgridLink> {
  const { connectionId, localType, localId, sgType, sgId, sgUpdatedAt, data } = params;

  const conflicting = await prisma.shotgridLink.findFirst({
    where: {
      connectionId,
      OR: [
        { sgType, sgId, NOT: { localId, localType } },
        { localType, localId, NOT: { sgType, sgId } },
      ],
    },
  });
  if (conflicting) await prisma.shotgridLink.delete({ where: { id: conflicting.id } });

  return prisma.shotgridLink.upsert({
    where: { connectionId_sgType_sgId: { connectionId, sgType, sgId } },
    create: {
      connectionId,
      localType,
      localId,
      sgType,
      sgId,
      sgUpdatedAt: sgUpdatedAt ?? null,
      data: (data ?? {}) as Prisma.InputJsonValue,
      syncedAt: new Date(),
    },
    update: {
      localType,
      localId,
      sgUpdatedAt: sgUpdatedAt ?? null,
      ...(data !== undefined ? { data: data as Prisma.InputJsonValue } : {}),
      syncedAt: new Date(),
    },
  });
}

export async function removeLink(connectionId: number, sgType: string, sgId: number): Promise<void> {
  await prisma.shotgridLink
    .delete({ where: { connectionId_sgType_sgId: { connectionId, sgType, sgId } } })
    .catch(() => undefined);
}

/** Données annexes d'un lien, typées à l'usage. */
export function linkData<T extends LinkData>(link: ShotgridLink | null | undefined): Partial<T> {
  if (!link || typeof link.data !== 'object' || link.data === null) return {};
  return link.data as Partial<T>;
}

/** Champs ShotGrid conservés sur une tâche faute d'équivalent dans le modèle ReView. */
export interface TaskLinkData extends LinkData {
  durationMinutes?: number | null;
  stepName?: string | null;
  /** Assignés ShotGrid sans compte ReView : affichés en grisé, jamais inventés. */
  sgAssignees?: Array<{ id: number; name: string; email: string | null }>;
  sgStatusCode?: string | null;
}

export interface ShotLinkData extends LinkData {
  sgStatusCode?: string | null;
  cutDuration?: number | null;
}

export interface AssetLinkData extends LinkData {
  sgAssetType?: string | null;
  sgStatusCode?: string | null;
}

export interface VersionLinkData extends LinkData {
  sgStatusCode?: string | null;
  sgPathToMovie?: string | null;
  sgFirstFrame?: number | null;
  sgLastFrame?: number | null;
  mediaImported?: boolean;
  /** Publishes de pipeline rattachés (chemins de fichiers, lecture seule). */
  publishedFiles?: Array<{
    id: number;
    name: string;
    path: string | null;
    type: string | null;
    version: number | null;
  }>;
}

/**
 * Correspondances d'un projet, telles que l'interface les consomme.
 *
 * `sgType` et `syncedAt` accompagnent chaque lien : le premier permet de réaligner une
 * entité sans redemander de quel type ShotGrid il s'agit, le second de dire depuis quand
 * elle n'a pas été relue. Une seule requête sert ainsi les liens directs ET l'état
 * d'alignement — une liste de deux cents plans n'en déclenche pas deux cents.
 */
export async function listForUi(connectionId: number) {
  return prisma.shotgridLink.findMany({
    where: {
      connectionId,
      localType: { in: ['sequence', 'shot', 'asset', 'task', 'version'] },
    },
    select: { localType: true, localId: true, sgId: true, sgType: true, syncedAt: true },
  });
}
