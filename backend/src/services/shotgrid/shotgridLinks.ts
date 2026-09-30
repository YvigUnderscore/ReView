// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Prisma, ShotgridLink } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { conflict } from '../../lib/errors';

/**
 * Table de correspondance locale ↔ ShotGrid.
 *
 * Toute entité importée y laisse une ligne : c'est elle qui rend les imports
 * idempotents (re-synchroniser ne duplique rien), qui permet de retrouver l'entité
 * distante d'un objet ReView pour l'écriture, et qui porte les champs ShotGrid sans
 * équivalent local (durée en minutes, assignés non-membres, chemins de publish).
 *
 * **Durée de vie d'un lien.** La table est polymorphe (`localType` + `localId`) : aucune
 * clé étrangère ne peut la rattacher aux douze modèles qu'elle désigne, donc aucun
 * `ON DELETE CASCADE`. La purge est confiée à des **déclencheurs PostgreSQL**
 * (`AFTER DELETE`, migration `20260908090000_shotgrid_liens_fiables`), pour deux raisons
 * qu'aucun code applicatif ne pouvait couvrir :
 *
 * 1. la plupart des suppressions n'existent pas en TypeScript — supprimer un plan
 *    efface ses tâches, versions, médias et commentaires **par cascade SQL**, sans
 *    qu'aucun service ne les voie passer ;
 * 2. un déclencheur s'exécute dans la transaction de la suppression : le lien ne peut
 *    pas survivre une milliseconde à ce qu'il désigne, ni à un rollback.
 *
 * Rien à appeler depuis un service, donc : supprimer l'entité suffit. Ce qui suit ne
 * s'occupe que de poser et de lire les correspondances.
 */

/**
 * Types locaux qu'une correspondance sait porter, **énumérés à l'exécution**.
 *
 * La liste n'est pas qu'un type : c'est elle que confronte
 * `shotgridLinkPurge.test.ts` aux déclencheurs SQL qui purgent les liens
 * d'une entité supprimée. Ajouter un type ici sans ajouter son déclencheur fait échouer
 * la suite — c'est le seul garde-fou contre le retour des liens orphelins, la table
 * étant polymorphe (`localType` + `localId`) et donc hors de portée d'une clé étrangère.
 */
export const LOCAL_TYPES = [
  'episode',
  'sequence',
  'shot',
  'asset',
  'task',
  'version',
  'media',
  'pipelineStatus',
  'reviewStatus',
  'user',
  'playlist',
  'comment',
] as const;

export type LocalType = (typeof LOCAL_TYPES)[number];

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
 * dans l'autre. Un ancien lien devenu incohérent est **remplacé** — mais plus en
 * silence, et plus à n'importe quel prix :
 *
 * - **Rebranchement légitime** (même `localType`) : un plan ReView change d'entité
 *   distante — le plan a été recréé sur le site avec un nouvel identifiant — ou une
 *   entité distante change de contrepartie locale. Le lien précédent part, mais un
 *   `warn` le dit : le plan délaissé redevient « jamais importé », et la passe suivante
 *   le recréera chez le client. Une trace est le minimum pour comprendre le doublon.
 * - **Collision entre types** (`localType` différent) : un identifiant ShotGrid ne
 *   peut pas désigner à la fois un média et une note. Le remplacement était ici une
 *   corruption pure — c'est ainsi qu'un lien juste se faisait écraser par le lien
 *   menteur `('Attachment', <id de Version>)`. On refuse au lieu d'obéir : une écriture
 *   ShotGrid fausse ne se rattrape pas, mieux vaut un job rouge qu'un lien inventé.
 *
 * Tous les conflits sont retirés, pas seulement le premier : un lien peut entrer en
 * collision des DEUX côtés à la fois (deux lignes distinctes), et n'en retirer qu'une
 * laissait l'`upsert` buter sur l'autre contrainte d'unicité.
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

  const conflicting = await prisma.shotgridLink.findMany({
    where: {
      connectionId,
      OR: [
        { sgType, sgId, NOT: { localId, localType } },
        { localType, localId, NOT: { sgType, sgId } },
      ],
    },
  });

  const crossType = conflicting.find((c) => c.localType !== localType);
  if (crossType) {
    // Sans code d'erreur : rien de tout ceci n'atteint un écran — la synchronisation
    // s'exécute en job, et c'est le journal de passe qui portera le message.
    throw conflict(
      `ShotGrid ${sgType}#${sgId} is already linked to ${crossType.localType}#${crossType.localId}, not to ${localType}#${localId}`,
    );
  }
  for (const stale of conflicting) {
    logger.warn(
      {
        connectionId,
        localType,
        from: { localId: stale.localId, sgType: stale.sgType, sgId: stale.sgId },
        to: { localId, sgType, sgId },
      },
      'shotgrid link rebound',
    );
    await prisma.shotgridLink.delete({ where: { id: stale.id } });
  }

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

/**
 * Témoin de la vignette rapatriée du site (voir `ShotgridThumbnails`).
 *
 * C'est l'adresse de l'image, signature retirée : adressée par contenu, donc stable tant
 * que la vignette ne change pas. Sa présence dit aussi que la vignette locale vient du
 * site — sans quoi une image déposée à la main dans ReView se ferait effacer par le
 * premier plan que ShotGrid n'illustre pas.
 */
export interface ThumbnailLinkData extends LinkData {
  sgThumbSrc?: string | null;
}

/** Une séquence n'a rien d'autre à conserver hors modèle : sa vignette, et c'est tout. */
export type SequenceLinkData = ThumbnailLinkData;

export interface ShotLinkData extends ThumbnailLinkData {
  sgStatusCode?: string | null;
  cutDuration?: number | null;
}

export interface AssetLinkData extends ThumbnailLinkData {
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
