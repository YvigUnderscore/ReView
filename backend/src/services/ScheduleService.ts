// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus, TaskType } from '@prisma/client';
import { prisma } from '../lib/prisma';

/**
 * Planning projet (43.C — №125/№128) : tâches datées (échéance et/ou début) pour la vue
 * calendrier et le Gantt par séquence. Lecture seule ; l'édition des dates passe par le
 * PATCH /api/tasks/:id existant (superviseurs).
 *
 * **Bornage.** La lecture était sans plafond : sur un long-métrage (deux mille plans, dix
 * mille tâches — la volumétrie que le dépôt se donne pour cible), ouvrir l'onglet
 * rapatriait l'intégralité du projet daté en un seul JSON. Un calendrier n'est pas une
 * liste : le paginer par rang n'aurait aucun sens. La borne juste est la **fenêtre de
 * temps** effectivement affichée (`from`/`to`, facultatifs — absents, on rend tout comme
 * avant), doublée d'un **plafond de sécurité** : au-delà, on sert les premières tâches et
 * on dit au lecteur que la période demandée est trop large (`truncated`).
 */

/**
 * Plafond de sécurité, en tâches. Ce n'est pas une page : c'est le point au-delà duquel
 * la réponse cesse d'être servable (≈ 500 Ko de JSON) et où la bonne réponse est de
 * resserrer la fenêtre, pas d'en demander la suite.
 */
export const SCHEDULE_MAX_TASKS = 2000;

export interface ScheduleTask {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
  location: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  assignee: { id: number; name: string | null } | null;
}

export interface ProjectSchedule {
  tasks: ScheduleTask[];
  /** Le plafond a été atteint : la fenêtre demandée est trop large, des tâches manquent. */
  truncated: boolean;
  /** Plafond appliqué, pour que le lecteur sache de quelle borne on parle. */
  limit: number;
}

/** Fenêtre de temps demandée. Les deux bornes sont indépendantes et facultatives. */
export interface ScheduleWindow {
  from?: Date;
  to?: Date;
}

/** Ligne brute (sortie du select Prisma) → tâche de planning (fonction pure, testée). */
export interface ScheduleRow {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: Date | null;
  dueDate: Date | null;
  assignee: { id: number; name: string | null } | null;
  shot: { code: string; sequence: { id: number; code: string } | null } | null;
  asset: { name: string } | null;
}

export function toScheduleTask(t: ScheduleRow): ScheduleTask {
  const seq = t.shot?.sequence ?? null;
  const location = t.shot ? `${seq ? seq.code + ' · ' : ''}${t.shot.code}` : (t.asset?.name ?? '');
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    location,
    sequenceId: seq?.id ?? null,
    sequenceCode: seq?.code ?? null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
  };
}

/**
 * Clauses de fenêtre, en intervalles et non en dates ponctuelles.
 *
 * Une tâche occupe `[début effectif, fin effective]`, où la borne manquante est tenue par
 * l'autre — c'est exactement la règle que le Gantt applique déjà côté écran (`spanOf`).
 * Elle est dans la fenêtre si les deux intervalles se chevauchent : fin effective ≥ `from`
 * **et** début effectif ≤ `to`. Filtrer sur la seule échéance ferait disparaître une tâche
 * commencée avant la fenêtre et due après, c'est-à-dire précisément celles qui sont en
 * cours au moment qu'on regarde.
 *
 * `{ dueDate: null, startDate: … }` se lit en ET (champs frères d'un même objet Prisma) ;
 * une comparaison SQL sur NULL étant fausse, les deux branches sont bien disjointes.
 */
export function scheduleWindowFilter(window: ScheduleWindow): Prisma.TaskWhereInput[] {
  const clauses: Prisma.TaskWhereInput[] = [];
  if (window.from) {
    clauses.push({
      OR: [{ dueDate: { gte: window.from } }, { dueDate: null, startDate: { gte: window.from } }],
    });
  }
  if (window.to) {
    clauses.push({
      OR: [{ startDate: { lte: window.to } }, { startDate: null, dueDate: { lte: window.to } }],
    });
  }
  return clauses;
}

/** Tâches datées du projet dans la fenêtre demandée, triées par échéance. */
export async function getProjectSchedule(
  projectId: number,
  window: ScheduleWindow = {},
): Promise<ProjectSchedule> {
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        { OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] },
        {
          OR: [{ shot: { projectId, deletedAt: null } }, { asset: { projectId, deletedAt: null } }],
        },
        ...scheduleWindowFilter(window),
      ],
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      startDate: true,
      dueDate: true,
      assignee: { select: { id: true, name: true } },
      shot: { select: { code: true, sequence: { select: { id: true, code: true } } } },
      asset: { select: { name: true } },
    },
    // `id` ferme le tri : sans départage, deux tâches de mêmes dates sortent dans un ordre
    // que PostgreSQL ne garantit pas — et ce qui tombe sous le plafond changerait d'un
    // appel à l'autre. Une troncature doit être reproductible.
    //
    // Ce tri décide aussi de ce qu'une troncature laisse de côté : PostgreSQL range les
    // NULL en fin de tri ascendant, donc les tâches sans échéance — celles que seul le
    // Gantt affiche — partent les premières. C'est le moindre mal : le calendrier, lui,
    // ne lit que `dueDate`.
    orderBy: [{ dueDate: 'asc' }, { startDate: 'asc' }, { id: 'asc' }],
    // Une ligne de plus que le plafond : elle ne sert qu'à savoir qu'il y en avait d'autres,
    // ce qui évite le `count` supplémentaire.
    take: SCHEDULE_MAX_TASKS + 1,
  });

  const truncated = rows.length > SCHEDULE_MAX_TASKS;
  const kept = truncated ? rows.slice(0, SCHEDULE_MAX_TASKS) : rows;
  return { tasks: kept.map(toScheduleTask), truncated, limit: SCHEDULE_MAX_TASKS };
}
