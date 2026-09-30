// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus } from '@prisma/client';

/**
 * Famille de statut — le vocabulaire commun de toutes les jauges (pilotage, accueil,
 * progression d'un projet).
 *
 * Les statistiques raisonnaient jusqu'ici sur l'enum figé `TaskStatus`, à six valeurs,
 * alors qu'un studio relié à ShotGrid travaille avec le référentiel `PipelineStatus` :
 * quinze statuts par entité, dont `isDone` dit lesquels sont terminaux et `isInactive`
 * lesquels ne comptent nulle part (« omitted », « n/a », « declined »). Résultat : des
 * jauges fausses des deux côtés — un plan « fin » n'était pas compté comme fait, un plan
 * omis gonflait indéfiniment le reste-à-faire.
 *
 * Ce module est la seule traduction statut → famille du serveur. Il est pur, donc testé
 * sans base, et il sert aussi bien au repli côté SQL (filtres Prisma) qu'au repli côté
 * mémoire (repliage des agrégats).
 */

export type Family = 'todo' | 'progress' | 'review' | 'done' | 'blocked';

/**
 * « Ni à faire, ni fait ». Ces statuts s'affichent mais ne comptent dans aucune jauge :
 * les compter comme du reste-à-faire gonflerait l'avancement d'une production, les
 * compter comme faits la flatterait.
 */
export type FamilyOrInactive = Family | 'inactive';

/** Traduction de l'enum figé — le repli quand aucun statut personnalisable n'est posé. */
export const FAMILY_OF_ENUM: Record<TaskStatus, Family> = {
  TODO: 'todo',
  IN_PROGRESS: 'progress',
  PENDING_REVIEW: 'review',
  APPROVED: 'done',
  RETAKE: 'blocked',
  REJECTED: 'blocked',
};

/** Le statut personnalisable réduit à ce dont une jauge a besoin. */
export interface PipelineStatusRef {
  isDone: boolean;
  isInactive: boolean;
  legacyStatus: TaskStatus | null;
}

/**
 * La famille d'une tâche.
 *
 * Sans statut personnalisable, l'enum fait foi (studio sans ShotGrid : comportement
 * inchangé). Avec, c'est `isInactive` puis `isDone` qui tranchent — ils sont écrits par
 * la synchronisation précisément pour cela — et `legacyStatus` sert de pont pour les
 * familles intermédiaires. Un statut non terminal ne peut jamais compter comme fait,
 * même si son pont le prétend : `isDone` est la seule autorité sur « c'est fini ».
 */
export function familyOf(status: TaskStatus, pipelineStatus?: PipelineStatusRef | null): FamilyOrInactive {
  if (!pipelineStatus) return FAMILY_OF_ENUM[status];
  if (pipelineStatus.isInactive) return 'inactive';
  if (pipelineStatus.isDone) return 'done';
  const family = FAMILY_OF_ENUM[pipelineStatus.legacyStatus ?? status];
  return family === 'done' ? 'review' : family;
}

/**
 * Construit une référence de statut depuis des colonnes lues à plat (agrégat SQL).
 * `isDone` nul signifie « aucun statut personnalisable posé », pas « pas terminé ».
 */
export function statusRefOf(row: {
  isDone: boolean | null;
  isInactive: boolean | null;
  legacyStatus: TaskStatus | null;
}): PipelineStatusRef | null {
  if (row.isDone === null) return null;
  return {
    isDone: row.isDone,
    isInactive: row.isInactive ?? false,
    legacyStatus: row.legacyStatus,
  };
}

/** Ordre d'affichage : ce qui demande une action d'abord, ce qui est clos en dernier. */
export const FAMILY_PRIORITY: Record<FamilyOrInactive, number> = {
  blocked: 0,
  review: 1,
  progress: 2,
  todo: 3,
  done: 4,
  inactive: 5,
};

/**
 * Priorité d'une tâche dans une liste « ce qui m'attend ».
 *
 * La famille décide du bloc, l'enum départage à l'intérieur (RETAKE avant REJECTED). Sans
 * statut personnalisable, l'ordre est exactement celui d'avant — la famille d'un statut
 * historique est monotone dans le même sens que l'enum.
 */
const ENUM_PRIORITY: Record<TaskStatus, number> = {
  RETAKE: 0,
  REJECTED: 1,
  PENDING_REVIEW: 2,
  IN_PROGRESS: 3,
  TODO: 4,
  APPROVED: 5,
};

export function taskPriority(status: TaskStatus, pipelineStatus?: PipelineStatusRef | null): number {
  return FAMILY_PRIORITY[familyOf(status, pipelineStatus)] * 10 + ENUM_PRIORITY[status];
}

// ── Filtres Prisma correspondants ────────────────────────────────────────────
//
// Ils disent en SQL ce que `familyOf` dit en mémoire, pour que la base puisse borner une
// liste sans qu'on ait à charger d'abord le référentiel de statuts. Toute évolution de
// `familyOf` doit se répercuter ici : c'est la seule duplication assumée du module.

/** Ni terminée, ni hors jeu — le périmètre de tout ce qui « reste à faire ». */
export const TASK_OPEN_FILTER: Prisma.TaskWhereInput = {
  OR: [
    { pipelineStatusId: null, status: { not: TaskStatus.APPROVED } },
    { pipelineStatus: { isDone: false, isInactive: false } },
  ],
};

/** Construit le filtre d'une famille intermédiaire (review, blocked…). */
function familyFilter(...legacy: TaskStatus[]): Prisma.TaskWhereInput {
  return {
    OR: [
      { pipelineStatusId: null, status: { in: legacy } },
      { pipelineStatus: { isDone: false, isInactive: false, legacyStatus: { in: legacy } } },
      // Statut personnalisé sans pont : l'enum de la tâche reprend la main.
      {
        pipelineStatus: { isDone: false, isInactive: false, legacyStatus: null },
        status: { in: legacy },
      },
    ],
  };
}

/** En attente d'un verdict. */
export const TASK_REVIEW_FILTER = familyFilter(TaskStatus.PENDING_REVIEW);

/** Ce qui me revient : retake ou rejet. */
export const TASK_BLOCKED_FILTER = familyFilter(TaskStatus.RETAKE, TaskStatus.REJECTED);
