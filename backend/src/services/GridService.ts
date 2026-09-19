// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { decodeCursor, cursorWhere, encodeCursor } from '../lib/pagination';
import { familyOf, type FamilyOrInactive } from '../lib/statusFamily';

/**
 * Grille de suivi de production (Phase 50, lot 2) — plans en lignes, départements en
 * colonnes, une tâche par case.
 *
 * C'est la vue que réclamait « je veux y retrouver tout le nécessaire pour faire un
 * parfait suivi de prod » : lire d'un coup d'œil où en est chaque plan, étape par étape,
 * avec qui le tient, depuis quand rien n'a bougé et si l'étape est même au programme.
 *
 * Deux règles gouvernent l'implémentation.
 *
 * **La pagination se fait PAR PLAN, jamais par tâche.** Une ligne de grille est un plan
 * avec toutes ses cases : paginer par tâche couperait une ligne en deux, et la page 2
 * rendrait la fin d'un plan dont on aurait perdu l'en-tête. Le curseur porte donc
 * `(Shot.order, Shot.id)` — l'index `[projectId, deletedAt, order, id]` existe pour ça.
 *
 * **Tout le comptage reste en base.** Quatre lectures indexées par page (plus le total et
 * le référentiel de départements) : les plans, leurs tâches, l'agrégat de versions par
 * tâche — comptes et dernière activité en une seule `groupBy` —, et les départements au
 * programme de chaque plan. Aucun repliage de dix mille tâches en JavaScript.
 */

/** Plafond dur d'une page. Au-delà, ce n'est plus une grille mais un export. */
export const GRID_MAX_LIMIT = 200;

/** Taille servie quand l'appelant n'en demande pas. */
export const GRID_DEFAULT_LIMIT = 50;

/** Un département du référentiel du projet, dans l'ordre du pipe. */
export interface GridDepartment {
  id: number;
  key: string;
  name: string;
  color: string | null;
  order: number;
}

/** Le statut propre d'un plan : toujours un `PipelineStatus`, ou rien. */
export interface GridShotStatus {
  id: number;
  code: string;
  name: string;
  color: string | null;
}

/**
 * Le statut d'une tâche, tel qu'une case l'affiche.
 *
 * Le serveur n'écrit AUCUN texte d'écran : quand la tâche n'a pas de statut
 * personnalisable, `name` est vide et `color` nulle — c'est au lecteur de traduire `code`
 * (la valeur de l'enum figé) ou `family`. Inventer ici « In progress » figerait la langue
 * du serveur dans quatorze catalogues.
 */
export interface GridCellStatus {
  /** Identifiant du `PipelineStatus`, `null` quand la tâche n'a que l'enum figé. */
  id: number | null;
  /** Code du statut du studio, ou la valeur de l'enum (`IN_PROGRESS`) à défaut. */
  code: string;
  /** Libellé du studio, vide quand aucun statut personnalisable n'est posé. */
  name: string;
  /** Teinte du studio (#RRGGBB), `null` quand aucun statut personnalisable n'est posé. */
  color: string | null;
  family: FamilyOrInactive;
}

export interface GridCell {
  departmentKey: string;
  taskId: number | null;
  status: GridCellStatus | null;
  assignee: { id: number; name: string | null } | null;
  versionCount: number;
  /** Date de la dernière version livrée sur cette tâche, `null` si aucune. */
  lastActivityAt: string | null;
  dueDate: string | null;
  /** Ce département est-il au programme de ce plan (`ShotDepartments`) ? */
  scheduled: boolean;
}

export interface GridRow {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  episodeId: number | null;
  episodeCode: string | null;
  status: GridShotStatus | null;
  cells: GridCell[];
}

export interface ProjectGrid {
  departments: GridDepartment[];
  rows: GridRow[];
  nextCursor: string | null;
  total: number;
}

/** Filtres acceptés par la grille. Tous facultatifs, tous cumulatifs. */
export interface GridFilters {
  cursor?: string;
  limit?: number;
  episodeId?: number;
  sequenceId?: number;
  /** Clé de département (`comp`), pas son libellé. */
  department?: string;
  assigneeId?: number;
  /** Code de statut du studio, ou valeur de l'enum figé pour un studio sans référentiel. */
  status?: string;
}

// ── Filtres ──────────────────────────────────────────────────────────────────

const TASK_STATUS_VALUES = new Set<string>(Object.values(TaskStatus));

/**
 * « Cette tâche porte-t-elle ce statut ? »
 *
 * Le code du studio d'abord ; à défaut de référentiel, la valeur de l'enum figé. Les deux
 * branches sont disjointes (`pipelineStatusId: null`) : un studio relié à ShotGrid filtre
 * sur son vocabulaire, un studio sans connexion sur le nôtre, sans qu'aucun n'ait à savoir
 * lequel des deux l'API attend.
 */
function statusFilter(status: string): Prisma.TaskWhereInput {
  const branches: Prisma.TaskWhereInput[] = [{ pipelineStatus: { code: status } }];
  const asEnum = status.toUpperCase();
  if (TASK_STATUS_VALUES.has(asEnum)) branches.push({ pipelineStatusId: null, status: asEnum as TaskStatus });
  return { OR: branches };
}

/**
 * Filtres qui portent sur les TÂCHES d'un plan. Un plan reste une ligne entière : le
 * filtre décide s'il est affiché, jamais quelles cases il montre — une grille dont les
 * colonnes se vident au filtrage ne se lit plus.
 */
export function gridTaskFilter(filters: GridFilters): Prisma.TaskWhereInput | null {
  const clauses: Prisma.TaskWhereInput[] = [];
  if (filters.department)
    clauses.push({
      OR: [{ departmentRef: { key: filters.department } }, { department: filters.department }],
    });
  if (filters.assigneeId !== undefined) clauses.push({ assigneeId: filters.assigneeId });
  if (filters.status) clauses.push(statusFilter(filters.status));
  return clauses.length > 0 ? { AND: clauses } : null;
}

/** `where` des plans de la page — corbeille et masquage exclus, filtres compris. */
export function gridShotWhere(projectId: number, filters: GridFilters): Prisma.ShotWhereInput {
  const taskFilter = gridTaskFilter(filters);
  return {
    projectId,
    deletedAt: null,
    hiddenAt: null,
    ...(filters.sequenceId !== undefined ? { sequenceId: filters.sequenceId } : {}),
    // Relation à-un facultative : la clause implique que la séquence existe, ce qui écarte
    // d'office les plans hors épisode — c'est bien ce que « filtre par épisode » demande.
    ...(filters.episodeId !== undefined ? { sequence: { episodeId: filters.episodeId } } : {}),
    ...(taskFilter ? { tasks: { some: taskFilter } } : {}),
  };
}

// ── Lectures ─────────────────────────────────────────────────────────────────

const shotSelect = {
  id: true,
  code: true,
  name: true,
  order: true,
  sequenceId: true,
  sequence: { select: { code: true, episodeId: true, episode: { select: { code: true } } } },
  pipelineStatus: { select: { id: true, code: true, name: true, color: true } },
  // Départements au programme de ce plan : c'est ce qui distingue « rien à faire ici » de
  // « à faire, pas commencé ». Une jointure de plus sur la table de liaison, bornée à la
  // page — pas un balayage du projet.
  departments: { select: { id: true } },
} satisfies Prisma.ShotSelect;

const taskSelect = {
  id: true,
  shotId: true,
  status: true,
  dueDate: true,
  department: true,
  departmentId: true,
  departmentRef: { select: { key: true } },
  assignee: { select: { id: true, name: true } },
  pipelineStatus: {
    select: {
      id: true,
      code: true,
      name: true,
      color: true,
      isDone: true,
      isInactive: true,
      legacyStatus: true,
    },
  },
} satisfies Prisma.TaskSelect;

export type GridShotRow = Prisma.ShotGetPayload<{ select: typeof shotSelect }>;
export type GridTaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/** Agrégat de versions d'une tâche : combien, et la plus récente. */
export interface GridVersionAggregate {
  taskId: number;
  count: number;
  lastAt: Date | null;
}

/**
 * Référentiel de départements du projet, réduit à ce qu'une colonne affiche.
 *
 * Même règle que `DepartmentService.listForProject` — les départements propres du projet
 * remplacent entièrement ceux du studio — mais sans signer les images : une grille de deux
 * cents lignes n'a que faire de vingt URL présignées.
 */
export async function listGridDepartments(projectId: number): Promise<GridDepartment[]> {
  const select = { id: true, key: true, name: true, color: true, order: true };
  const orderBy = [{ order: 'asc' as const }, { key: 'asc' as const }];
  const own = await prisma.department.findMany({
    where: { projectId, deletedAt: null },
    orderBy,
    select,
  });
  if (own.length > 0) return own;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { studioId: true },
  });
  if (!project) return [];
  return prisma.department.findMany({
    where: { studioId: project.studioId, projectId: null, deletedAt: null },
    orderBy,
    select,
  });
}

// ── Assemblage (pur, testé sans base) ────────────────────────────────────────

/** Clé de département d'une tâche : la relation fait foi, la colonne dénormalisée supplée. */
const taskDepartmentKey = (task: GridTaskRow): string | null =>
  task.departmentRef?.key ?? task.department ?? null;

/** Statut d'une case, synthétisé du statut du studio ou, à défaut, de l'enum figé. */
export function cellStatusOf(task: GridTaskRow): GridCellStatus {
  const ps = task.pipelineStatus;
  return {
    id: ps?.id ?? null,
    code: ps?.code ?? task.status,
    name: ps?.name ?? '',
    color: ps?.color ?? null,
    family: familyOf(task.status, ps),
  };
}

/**
 * Plans + tâches + agrégats → lignes de grille.
 *
 * Une case par département du référentiel, dans l'ordre du pipe : la grille garde ses
 * colonnes même quand un plan n'a rien à y faire. Quand plusieurs tâches partagent un
 * département sur le même plan — la contrainte d'unicité le permet, les noms diffèrent —
 * la case montre la PREMIÈRE dans l'ordre du pipe (`order`, puis `id`) ; les tâches dont
 * le département n'appartient pas au référentiel n'ont pas de colonne où s'afficher.
 */
export function buildGridRows(
  shots: GridShotRow[],
  tasks: GridTaskRow[],
  versions: GridVersionAggregate[],
  departments: GridDepartment[],
): GridRow[] {
  // La casse des clés dénormalisées n'est pas garantie sur les lignes anciennes (la
  // colonne était une chaîne libre avant la relation) : l'index est donc insensible.
  const byKey = new Map(departments.map((d) => [d.key.toLowerCase(), d]));
  const versionOf = new Map(versions.map((v) => [v.taskId, v]));

  /** shotId → clé de département → tâche retenue (la première de l'ordre reçu). */
  const cellTasks = new Map<number, Map<string, GridTaskRow>>();
  for (const task of tasks) {
    if (task.shotId === null) continue;
    const key = taskDepartmentKey(task);
    const department = key ? byKey.get(key.toLowerCase()) : undefined;
    if (!department) continue;
    let perShot = cellTasks.get(task.shotId);
    if (!perShot) {
      perShot = new Map();
      cellTasks.set(task.shotId, perShot);
    }
    if (!perShot.has(department.key)) perShot.set(department.key, task);
  }

  return shots.map((shot) => {
    const perShot = cellTasks.get(shot.id);
    const scheduledIds = new Set(shot.departments.map((d) => d.id));
    return {
      shotId: shot.id,
      code: shot.code,
      name: shot.name,
      sequenceId: shot.sequenceId,
      sequenceCode: shot.sequence?.code ?? null,
      episodeId: shot.sequence?.episodeId ?? null,
      episodeCode: shot.sequence?.episode?.code ?? null,
      status: shot.pipelineStatus,
      cells: departments.map((department) => {
        const task = perShot?.get(department.key);
        const aggregate = task ? versionOf.get(task.id) : undefined;
        return {
          departmentKey: department.key,
          taskId: task?.id ?? null,
          status: task ? cellStatusOf(task) : null,
          assignee: task?.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
          versionCount: aggregate?.count ?? 0,
          lastActivityAt: aggregate?.lastAt ? aggregate.lastAt.toISOString() : null,
          dueDate: task?.dueDate ? task.dueDate.toISOString() : null,
          // Une tâche existante vaut programme : elle n'aurait pas été créée autrement.
          scheduled: scheduledIds.has(department.id) || task !== undefined,
        };
      }),
    };
  });
}

/** Une page de grille. Le curseur reprend après le dernier plan servi. */
export async function getProjectGrid(projectId: number, filters: GridFilters = {}): Promise<ProjectGrid> {
  const limit = Math.min(Math.max(1, Math.trunc(filters.limit ?? GRID_DEFAULT_LIMIT)), GRID_MAX_LIMIT);
  const where = gridShotWhere(projectId, filters);
  const cursor = decodeCursor(filters.cursor);
  // Le curseur s'empile dans `AND` : le `where` porte déjà des clauses de relation qu'un
  // étalement à la racine écraserait.
  const paged: Prisma.ShotWhereInput = cursor
    ? { ...where, AND: [cursorWhere('order', 'asc', cursor)] }
    : where;

  const [shots, total, departments] = await Promise.all([
    prisma.shot.findMany({
      where: paged,
      // Exactement le tri de l'index `[projectId, deletedAt, order, id]` : `id` ferme le
      // départage, sans quoi deux plans d'`order` égal changeraient de page.
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      take: limit,
      select: shotSelect,
    }),
    prisma.shot.count({ where }),
    listGridDepartments(projectId),
  ]);

  const shotIds = shots.map((s) => s.id);
  const tasks =
    shotIds.length === 0
      ? []
      : await prisma.task.findMany({
          where: { shotId: { in: shotIds } },
          // L'index `[shotId, order]` sert le filtre ET le tri : c'est cet ordre qui élit
          // la tâche d'une case quand un département en porte plusieurs.
          orderBy: [{ order: 'asc' }, { id: 'asc' }],
          select: taskSelect,
        });

  const taskIds = tasks.map((t) => t.id);
  const grouped =
    taskIds.length === 0
      ? []
      : await prisma.version.groupBy({
          by: ['taskId'],
          where: { taskId: { in: taskIds }, deletedAt: null },
          _count: { _all: true },
          _max: { createdAt: true },
        });
  const versions: GridVersionAggregate[] = grouped.flatMap((g) =>
    g.taskId === null ? [] : [{ taskId: g.taskId, count: g._count._all, lastAt: g._max.createdAt }],
  );

  const last = shots.at(-1);
  return {
    departments,
    rows: buildGridRows(shots, tasks, versions, departments),
    // Une page incomplète ferme la liste : inutile de faire redemander une page vide.
    nextCursor: last && shots.length >= limit ? encodeCursor(last.order, last.id) : null,
    total,
  };
}
