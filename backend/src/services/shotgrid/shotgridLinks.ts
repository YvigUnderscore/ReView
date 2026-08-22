// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, ShotgridLink } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

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

/**
 * Identifiants ShotGrid d'un lot d'entités locales — évite N requêtes en boucle.
 *
 * Volontairement **non bornée**, contrairement à `listForUi` : la synchronisation s'en
 * sert pour savoir ce qui est déjà lié. Un lien absent de la table s'y lit « entité
 * jamais importée » et déclenche une création sur le site distant — tronquer la carte
 * dupliquerait des plans chez le client. Elle est appelée par un job, pas par un écran.
 */
export async function mapLocalToSg(
  connectionId: number,
  localType: LocalType,
): Promise<Map<number, ShotgridLink>> {
  const links = await prisma.shotgridLink.findMany({ where: { connectionId, localType } });
  return new Map(links.map((l) => [l.localId, l]));
}

/** Le sens inverse, non bornée pour la même raison que `mapLocalToSg`. */
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
  /** Version née dans ReView puis poussée : son média vient d'ici, pas du site. */
  createdFromReview?: boolean;
  /** Publishes de pipeline rattachés (chemins de fichiers, lecture seule). */
  publishedFiles?: Array<{
    id: number;
    name: string;
    path: string | null;
    type: string | null;
    version: number | null;
  }>;
}

/** Types de correspondance dont l'interface tire une pastille ou un lien direct. */
export const UI_LINK_TYPES: readonly LocalType[] = ['sequence', 'shot', 'asset', 'task', 'version'];

/**
 * Plafond de la table de correspondance servie à l'interface.
 *
 * La requête n'était pas bornée : à la volumétrie visée (2 000 plans, 10 000 tâches,
 * 20 000 versions) elle renvoyait plusieurs mégaoctets de JSON à chaque ouverture de
 * projet. Le plafond laisse passer l'intégralité des types « carte » — séquences, plans,
 * assets, tâches — et ne rogne que sur les versions : le tri par `localType` les place
 * en dernier (ordre alphabétique), si bien que la dégradation touche d'abord ce qui
 * s'affiche le moins.
 */
export const UI_LINKS_LIMIT = 20000;

/**
 * Correspondances d'un projet, telles que l'interface les consomme.
 *
 * `sgType` et `syncedAt` accompagnent chaque lien : le premier permet de réaligner une
 * entité sans redemander de quel type ShotGrid il s'agit, le second de dire depuis quand
 * elle n'a pas été relue. Une seule requête sert ainsi les liens directs ET l'état
 * d'alignement — une liste de deux cents plans n'en déclenche pas deux cents.
 *
 * `localTypes` permet à un écran de ne demander que ce qu'il affiche (la page d'un plan
 * n'a que faire des vingt mille versions du projet).
 */
export async function listForUi(
  connectionId: number,
  opts: { localTypes?: readonly LocalType[]; limit?: number } = {},
) {
  const limit = Math.min(Math.max(1, opts.limit ?? UI_LINKS_LIMIT), UI_LINKS_LIMIT);
  const links = await prisma.shotgridLink.findMany({
    where: {
      connectionId,
      localType: { in: [...(opts.localTypes ?? UI_LINK_TYPES)] },
    },
    orderBy: [{ localType: 'asc' }, { localId: 'asc' }],
    take: limit,
    select: { localType: true, localId: true, sgId: true, sgType: true, syncedAt: true },
  });
  if (links.length >= limit) {
    // Une pastille manquante se lit « cette entité n'est pas liée » : il faut pouvoir
    // remonter à la troncature plutôt qu'à une désynchronisation imaginaire.
    logger.warn({ connectionId, limit }, 'shotgrid links truncated for UI');
  }
  return links;
}

/**
 * Faut-il rapatrier le média de cette version ?
 *
 * Écrit comme une règle nommée plutôt qu'en condition dissoute, parce que l'oublier a
 * coûté un défaut visible : une version publiée depuis ReView voyait son propre fichier
 * retéléchargé depuis le site à la synchronisation suivante et ajouté à la même version
 * — une copie de plus à chaque passe.
 */
export function shouldImportMedia(params: {
  withMedia: boolean;
  autoImport: boolean;
  link: VersionLinkData;
}): boolean {
  if (!params.withMedia || !params.autoImport) return false;
  if (params.link.mediaImported) return false;
  // Ce qu'on lirait sur le site est le fichier qu'on y a envoyé.
  if (params.link.createdFromReview) return false;
  return true;
}
