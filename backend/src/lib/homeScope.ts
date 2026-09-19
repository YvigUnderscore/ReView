// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { MediaStatus, Prisma, Role } from '@prisma/client';
import { TASK_BLOCKED_FILTER, TASK_OPEN_FILTER } from './statusFamily';

/**
 * Périmètres de « ce qui m'attend » — la seule définition de chacun des quatre compteurs
 * de l'Accueil.
 *
 * Les quatre cartes mentaient, chacune à sa façon : « mes retakes » n'était borné à aucun
 * périmètre (un projet à la corbeille, un plan masqué, un projet dont je ne suis pas membre
 * comptaient encore), « awaiting review » était posé et libellé comme personnel mais
 * calculé pour tout le studio, et « media in review » comptait TOUS les médias publiés,
 * décision rendue comprise — un projet livré depuis deux ans y figurait.
 *
 * Le remède n'est pas de corriger quatre requêtes : c'est de n'écrire chaque périmètre
 * qu'une fois. Le compteur de la carte et la page qu'elle ouvre lisent ici le même `where`,
 * si bien qu'un chiffre ne peut plus annoncer autre chose que ce que la page montre.
 * Un périmètre décrit à deux endroits finit par diverger, et une divergence de périmètre
 * est soit un mensonge, soit une fuite.
 */

export type SessionUser = { id: number; role: Role };

/** ADMIN et SUPERVISOR voient tout le studio ; les autres, leurs projets. */
export const isGlobalRole = (role: Role): boolean => role === Role.ADMIN || role === Role.SUPERVISOR;

/** Projet accessible : vivant (corbeille exclue) et, sauf rôle global, dont je suis membre. */
export const accessibleProjects = (user: SessionUser): Prisma.ProjectWhereInput =>
  isGlobalRole(user.role)
    ? { deletedAt: null }
    : { deletedAt: null, memberships: { some: { userId: user.id } } };

/**
 * Version rattachée à un projet accessible, par les trois chemins de rattachement.
 * Le parent masqué (`hiddenAt`) ou à la corbeille est exclu : ce qui ne s'affiche nulle
 * part ne doit pas peser sur un compteur.
 */
export const versionInProjects = (access: Prisma.ProjectWhereInput): Prisma.VersionWhereInput => ({
  OR: [
    { task: { shot: { deletedAt: null, hiddenAt: null, project: access } } },
    { task: { asset: { deletedAt: null, hiddenAt: null, project: access } } },
    { asset: { deletedAt: null, hiddenAt: null, project: access } },
  ],
});

/** Tâche rattachée à un projet accessible (les deux chemins de rattachement). */
export const taskInProjects = (access: Prisma.ProjectWhereInput): Prisma.TaskWhereInput => ({
  OR: [
    { shot: { deletedAt: null, hiddenAt: null, project: access } },
    { asset: { deletedAt: null, hiddenAt: null, project: access } },
  ],
});

/**
 * Média publié et prêt de mon périmètre. `version` reçoit la contrainte supplémentaire de
 * l'appelant (sans décision, review confiée…) : elle se fond dans la même clause, car
 * deux clés `version` dans un objet Prisma se remplaceraient l'une l'autre.
 */
export function publishedMediaInScope(
  user: SessionUser,
  version: Prisma.VersionWhereInput = {},
): Prisma.MediaObjectWhereInput {
  return {
    deletedAt: null,
    published: true,
    status: MediaStatus.READY,
    version: { deletedAt: null, ...version, ...versionInProjects(accessibleProjects(user)) },
  };
}

/**
 * « Media in review » : média publié dont la version **n'a pas encore reçu de décision**.
 *
 * C'est la correction de fond de cette carte. Elle comptait tout le publié : le libellé
 * disait « en review », le chiffre disait « dans la base ». Une version approuvée ou
 * rejetée n'est plus en review — sa place est dans l'historique, pas dans un compteur
 * d'attente.
 */
export const mediaInReviewWhere = (user: SessionUser): Prisma.MediaObjectWhereInput =>
  publishedMediaInScope(user, { reviewStatusId: null });

/**
 * « Awaiting my review » : ce qu'on attend de MOI, via `ReviewAssignment`.
 *
 * La carte est posée parmi mes chiffres et libellée à la première personne ; elle comptait
 * pourtant les tâches en attente de verdict de tout le studio (`TASK_REVIEW_FILTER`). Le
 * volume collectif existe toujours, mais il a sa propre carte et son propre libellé :
 * jamais le même chiffre pour deux sens.
 *
 * Le filtre porte sur la version — c'est la livraison qu'on confie — et la décision déjà
 * rendue sort du compte : on n'attend plus rien de moi sur une version tranchée. Même
 * périmètre que `/reviews?assigned=me&decision=none`, la vue qu'ouvre la carte.
 */
export const awaitingMyReviewWhere = (user: SessionUser): Prisma.MediaObjectWhereInput =>
  publishedMediaInScope(user, { reviewStatusId: null, reviewers: { some: { reviewerId: user.id } } });

/**
 * « My retakes » : mes tâches en retake ou rejet, dans mon périmètre.
 *
 * Le compteur d'origine ne portait que `assigneeId` : une tâche d'un projet mis à la
 * corbeille, d'un plan masqué ou d'un projet dont je ne suis plus membre continuait de
 * réclamer une action qu'aucun écran ne pouvait plus montrer.
 */
export const myRetakesWhere = (user: SessionUser): Prisma.TaskWhereInput => ({
  assigneeId: user.id,
  AND: [taskInProjects(accessibleProjects(user)), TASK_BLOCKED_FILTER],
});

/** Mes tâches vivantes (ni terminées, ni hors jeu) dans mon périmètre. */
export const myOpenTasksWhere = (user: SessionUser): Prisma.TaskWhereInput => ({
  assigneeId: user.id,
  AND: [taskInProjects(accessibleProjects(user)), TASK_OPEN_FILTER],
});

/**
 * Commentaires lisibles depuis mon Accueil : ceux des médias publiés de mon périmètre.
 * Un CLIENT n'y voit que les notes qui lui sont destinées — même règle que le fil de
 * review, le partage public, la recherche et l'export.
 */
export const commentFeedWhere = (user: SessionUser): Prisma.CommentWhereInput => ({
  media: publishedMediaInScope(user),
  ...(user.role === Role.CLIENT ? { isVisibleToClient: true } : {}),
});
