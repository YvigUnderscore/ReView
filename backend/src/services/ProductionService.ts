// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  FAMILY_OF_ENUM,
  TASK_OPEN_FILTER,
  TASK_REVIEW_FILTER,
  familyOf,
  statusRefOf,
  type Family,
  type FamilyOrInactive,
} from '../lib/statusFamily';

/**
 * Pilotage de production (C6) — quatre questions, et rien d'autre.
 *
 *   1. où en est le projet — séquences × départements ;
 *   2. qu'est-ce qui est en retard ou bloqué ;
 *   3. qui fait quoi ;
 *   4. à quel rythme, et pour quelle fin projetée.
 *
 * Deux règles gouvernent l'implémentation.
 *
 * D'abord, **la base compte**. La vue chargeait toutes les tâches du projet (~10 000 à la
 * cible) et tous les médias publiés de la fenêtre pour les compter en JavaScript ; elle ne
 * lit plus que des agrégats — une ligne par croisement séquence × département × statut, et
 * au plus 150 tâches nominatives pour les trois listes d'attention.
 *
 * Ensuite, **le statut lu est celui du studio**. Les familles se déduisent de
 * `PipelineStatus` (`isDone`, `isInactive`, `legacyStatus`) et retombent sur l'enum figé
 * quand aucun statut personnalisable n'est posé — cf. `lib/statusFamily`. Un plan « omis »
 * ne pèse plus sur les jauges, un plan « fin » y compte enfin comme terminé.
 *
 * Les fonctions de calcul restent pures et testées ; seules la lecture en base et
 * l'assemblage vivent dans `getOverview`.
 */

export type { Family };

export const EMPTY_CELL: Record<Family, number> = {
  todo: 0,
  progress: 0,
  review: 0,
  done: 0,
  blocked: 0,
};

/**
 * Ce qu'une jauge lit d'une ligne : son statut, sa famille si la base l'a déjà résolue, et
 * le nombre de tâches qu'elle représente. Une tâche vaut une ligne de compte 1 — c'est ce
 * qui permet aux mêmes fonctions de servir aux agrégats SQL et aux listes nominatives.
 */
interface CountedRow {
  status: TaskStatus;
  family?: FamilyOrInactive;
  count?: number;
}

const familyOfRow = (row: CountedRow): FamilyOrInactive => row.family ?? FAMILY_OF_ENUM[row.status];
const countOf = (row: CountedRow): number => row.count ?? 1;

/** Une tâche, réduite à ce dont le pilotage a besoin. */
export interface ProductionTask extends CountedRow {
  id: number;
  name: string;
  status: TaskStatus;
  dueDate: Date | null;
  assigneeId: number | null;
  assigneeName: string | null;
  department: string | null;
  sequenceId: number | null;
  sequenceCode: string | null;
  parentLabel: string;
}

export interface MatrixCell extends Record<Family, number> {
  sequenceId: number | null;
  department: string | null;
  total: number;
}

/** Une case du tableau croisé, avant repliage : le croisement et son compte. */
export interface MatrixRow extends CountedRow {
  sequenceId: number | null;
  department: string | null;
}

/** Tableau croisé séquences × départements, en comptes par famille de statut. */
export function buildMatrix(rows: MatrixRow[]): MatrixCell[] {
  const cells = new Map<string, MatrixCell>();
  for (const row of rows) {
    const family = familyOfRow(row);
    // Ni à faire, ni fait : un statut inactif ne pèse sur aucune jauge d'avancement.
    if (family === 'inactive') continue;
    const key = `${row.sequenceId ?? 'none'}::${row.department ?? 'none'}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { ...EMPTY_CELL, sequenceId: row.sequenceId, department: row.department, total: 0 };
      cells.set(key, cell);
    }
    const n = countOf(row);
    cell[family] += n;
    cell.total += n;
  }
  return [...cells.values()];
}

export interface Attention {
  overdue: ProductionTask[];
  unassigned: ProductionTask[];
  waitingReview: ProductionTask[];
}

/**
 * Ce qui demande une décision. Une tâche terminée n'est jamais « en retard » : sa date est
 * passée, mais le travail est fait — la signaler noierait ce qui compte vraiment. Une
 * tâche inactive (omise, sans objet) n'attend rien de personne et disparaît de même.
 */
export function findAttention(tasks: ProductionTask[], now: Date, limit = 50): Attention {
  const open = tasks.filter((t) => {
    const family = familyOfRow(t);
    return family !== 'done' && family !== 'inactive';
  });
  const byDue = (a: ProductionTask, b: ProductionTask) =>
    (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
  return {
    overdue: open
      .filter((t) => t.dueDate !== null && t.dueDate.getTime() < now.getTime())
      .sort(byDue)
      .slice(0, limit),
    unassigned: open
      .filter((t) => t.assigneeId === null)
      .sort(byDue)
      .slice(0, limit),
    waitingReview: open
      .filter((t) => familyOfRow(t) === 'review')
      .sort(byDue)
      .slice(0, limit),
  };
}

export interface WorkloadRow {
  assigneeId: number | null;
  name: string | null;
  todo: number;
  progress: number;
  review: number;
  blocked: number;
  overdue: number;
  total: number;
}

/** Une ligne de charge avant repliage : la personne, son statut, son compte. */
export interface WorkloadInput extends CountedRow {
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate?: Date | null;
  /** Retards déjà comptés en base ; à défaut, déduits de `dueDate`. */
  overdue?: number;
}

/**
 * Charge par personne. L'assigné est transporté par l'API depuis toujours et n'était
 * affiché nulle part : impossible de voir qui portait quoi.
 */
export function buildWorkload(rows: WorkloadInput[], now: Date): WorkloadRow[] {
  const out = new Map<number | null, WorkloadRow>();
  for (const input of rows) {
    const family = familyOfRow(input);
    // La charge, c'est ce qui reste à faire — ni le travail fait, ni ce qui est hors jeu.
    if (family === 'done' || family === 'inactive') continue;
    let row = out.get(input.assigneeId);
    if (!row) {
      row = {
        assigneeId: input.assigneeId,
        name: input.assigneeName,
        todo: 0,
        progress: 0,
        review: 0,
        blocked: 0,
        overdue: 0,
        total: 0,
      };
      out.set(input.assigneeId, row);
    }
    const n = countOf(input);
    row[family] += n;
    row.total += n;
    row.overdue +=
      input.overdue ?? (input.dueDate != null && input.dueDate.getTime() < now.getTime() ? n : 0);
  }
  // Les plus chargés d'abord ; les tâches sans assigné ferment la marche, quel qu'en soit
  // le nombre — c'est un manque à combler, pas une personne à comparer aux autres.
  return [...out.values()].sort((a, b) => {
    if ((a.assigneeId === null) !== (b.assigneeId === null)) return a.assigneeId === null ? 1 : -1;
    return b.total - a.total;
  });
}

export interface WeekPoint {
  /** Lundi de la semaine, en ISO court (AAAA-MM-JJ). */
  weekStart: string;
  delivered: number;
}

/** Lundi de la semaine contenant `date`, à minuit UTC. */
export function weekStartOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay : 0 = dimanche. On ramène au lundi précédent.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Livraisons par semaine sur la fenêtre demandée, semaines vides comprises. */
export function buildPace(counts: WeekPoint[], now: Date, weeks: number): WeekPoint[] {
  const start = weekStartOf(now);
  const points: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(start);
    week.setUTCDate(week.getUTCDate() - i * 7);
    points.push({ weekStart: isoDay(week), delivered: 0 });
  }
  const index = new Map(points.map((p, i) => [p.weekStart, i]));
  for (const count of counts) {
    const slot = index.get(count.weekStart);
    if (slot !== undefined) points[slot]!.delivered += count.delivered;
  }
  return points;
}

export interface Projection {
  done: number;
  total: number;
  /** Moyenne de tâches terminées par semaine sur la fenêtre observée. */
  perWeek: number;
  /** Date projetée d'achèvement, `null` si le rythme est nul ou tout est fait. */
  projectedEnd: string | null;
}

/**
 * Projection de fin, au rythme observé. Elle vaut ce que vaut l'hypothèse — un rythme
 * constant — et c'est pourquoi elle est rendue avec le rythme lui-même : sans lui, une
 * date seule se lit comme un engagement.
 */
export function projectEnd(done: number, total: number, points: WeekPoint[], now: Date): Projection {
  const delivered = points.reduce((n, p) => n + p.delivered, 0);
  const perWeek = points.length > 0 ? delivered / points.length : 0;
  const remaining = Math.max(0, total - done);
  if (remaining === 0 || perWeek <= 0) return { done, total, perWeek, projectedEnd: null };
  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() + Math.ceil((remaining / perWeek) * 7));
  return { done, total, perWeek, projectedEnd: isoDay(end) };
}

export interface ProductionOverview {
  matrix: MatrixCell[];
  sequences: { id: number; code: string }[];
  departments: string[];
  attention: Attention;
  workload: WorkloadRow[];
  pace: WeekPoint[];
  projection: Projection;
}

// ── Lecture en base ───────────────────────────────────────────────────────────

/** Colonnes du statut personnalisable, telles qu'un agrégat les rend (nulles = absent). */
interface StatusColumns {
  isDone: boolean | null;
  isInactive: boolean | null;
  legacyStatus: TaskStatus | null;
}

type MatrixAggregate = StatusColumns & {
  sequenceId: number | null;
  department: string | null;
  status: TaskStatus;
  count: number;
};

type WorkloadAggregate = StatusColumns & {
  assigneeId: number | null;
  assigneeName: string | null;
  status: TaskStatus;
  count: number;
  overdue: number;
};

/** Résout la famille d'une ligne d'agrégat depuis ses colonnes de statut. */
const familyOfAggregate = (row: StatusColumns & { status: TaskStatus }): FamilyOrInactive =>
  familyOf(row.status, statusRefOf(row));

/** Une tâche appartient au projet par son plan OU par son asset — jamais les deux. */
const taskInProject = (projectId: number): Prisma.TaskWhereInput => ({
  // Le travail d'un élément masqué ne compte plus dans les statistiques de production :
  // il fausserait l'avancement d'un projet avec des plans que personne ne voit.
  OR: [
    { shot: { projectId, deletedAt: null, hiddenAt: null } },
    { asset: { projectId, deletedAt: null, hiddenAt: null } },
  ],
});

const attentionSelect = {
  id: true,
  name: true,
  status: true,
  dueDate: true,
  department: true,
  assignee: { select: { id: true, name: true } },
  shot: { select: { code: true, sequenceId: true, sequence: { select: { code: true } } } },
  asset: { select: { name: true } },
  pipelineStatus: { select: { isDone: true, isInactive: true, legacyStatus: true } },
} satisfies Prisma.TaskSelect;

type AttentionRow = Prisma.TaskGetPayload<{ select: typeof attentionSelect }>;

const toProductionTask = (r: AttentionRow): ProductionTask => ({
  id: r.id,
  name: r.name,
  status: r.status,
  family: familyOf(r.status, r.pipelineStatus),
  dueDate: r.dueDate,
  assigneeId: r.assignee?.id ?? null,
  assigneeName: r.assignee?.name ?? null,
  department: r.department,
  sequenceId: r.shot?.sequenceId ?? null,
  sequenceCode: r.shot?.sequence?.code ?? null,
  parentLabel: r.shot?.code ?? r.asset?.name ?? '',
});

/**
 * Les trois listes d'attention, bornées EN BASE.
 *
 * Chaque requête applique déjà le filtre, l'ordre et la limite de sa liste ; leur union
 * repasse ensuite par `findAttention`, qui la repartage à l'identique — une tâche absente
 * du haut de sa propre liste ne peut pas apparaître dans celle d'une autre.
 */
async function fetchAttentionCandidates(projectId: number, now: Date, limit: number) {
  const base = { AND: [taskInProject(projectId), TASK_OPEN_FILTER] };
  const orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ dueDate: 'asc' }, { id: 'asc' }];
  const [overdue, unassigned, waitingReview] = await Promise.all([
    prisma.task.findMany({
      where: { ...base, dueDate: { lt: now } },
      orderBy,
      take: limit,
      select: attentionSelect,
    }),
    prisma.task.findMany({
      where: { ...base, assigneeId: null },
      orderBy,
      take: limit,
      select: attentionSelect,
    }),
    prisma.task.findMany({
      where: { AND: [...base.AND, TASK_REVIEW_FILTER] },
      orderBy,
      take: limit,
      select: attentionSelect,
    }),
  ]);
  const byId = new Map<number, ProductionTask>();
  for (const row of [...overdue, ...unassigned, ...waitingReview]) byId.set(row.id, toProductionTask(row));
  // Ordre stable (échéance, puis identifiant) : le partage suivant trie par échéance et
  // conserve l'ordre d'entrée à égalité.
  return [...byId.values()].sort(
    (a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || a.id - b.id,
  );
}

/** Tableau croisé compté par Postgres : une ligne par séquence × département × statut. */
function queryMatrix(projectId: number): Promise<MatrixAggregate[]> {
  return prisma.$queryRaw<MatrixAggregate[]>`
    SELECT sh."sequenceId"        AS "sequenceId",
           t.department           AS "department",
           t.status::text         AS "status",
           ps."isDone"            AS "isDone",
           ps."isInactive"        AS "isInactive",
           ps."legacyStatus"::text AS "legacyStatus",
           COUNT(*)::int          AS "count"
    FROM "Task" t
    LEFT JOIN "Shot" sh  ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" a  ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
    LEFT JOIN "PipelineStatus" ps ON ps.id = t."pipelineStatusId"
    WHERE sh."projectId" = ${projectId} OR a."projectId" = ${projectId}
    GROUP BY 1, 2, 3, 4, 5, 6
  `;
}

/**
 * Charge comptée par Postgres : une ligne par personne × statut, retards compris.
 *
 * Les dates voyagent en ISO puis sont castées en `timestamp` : les colonnes du schéma sont
 * des `TIMESTAMP(3)` sans fuseau, et comparer directement un paramètre `timestamptz` ferait
 * dépendre le résultat du fuseau de la session (les conteneurs tournent en Europe/Paris).
 */
function queryWorkload(projectId: number, now: Date): Promise<WorkloadAggregate[]> {
  return prisma.$queryRaw<WorkloadAggregate[]>`
    SELECT t."assigneeId"         AS "assigneeId",
           u.name                 AS "assigneeName",
           t.status::text         AS "status",
           ps."isDone"            AS "isDone",
           ps."isInactive"        AS "isInactive",
           ps."legacyStatus"::text AS "legacyStatus",
           COUNT(*)::int          AS "count",
           COUNT(*) FILTER (
             WHERE t."dueDate" IS NOT NULL AND t."dueDate" < ${now.toISOString()}::timestamp
           )::int AS "overdue"
    FROM "Task" t
    LEFT JOIN "Shot" sh  ON sh.id = t."shotId"  AND sh."deletedAt" IS NULL AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" a  ON a.id  = t."assetId" AND a."deletedAt" IS NULL AND a."hiddenAt" IS NULL
    LEFT JOIN "User" u   ON u.id  = t."assigneeId"
    LEFT JOIN "PipelineStatus" ps ON ps.id = t."pipelineStatusId"
    WHERE sh."projectId" = ${projectId} OR a."projectId" = ${projectId}
    GROUP BY 1, 2, 3, 4, 5, 6
  `;
}

/**
 * Livraisons regroupées par semaine ISO (lundi, UTC) — même découpage que `weekStartOf`.
 * La fenêtre est bornée en base ; les semaines vides sont ajoutées par `buildPace`.
 */
function queryPace(projectId: number, since: Date): Promise<WeekPoint[]> {
  return prisma.$queryRaw<WeekPoint[]>`
    SELECT to_char(date_trunc('week', m."createdAt"), 'YYYY-MM-DD') AS "weekStart",
           COUNT(*)::int AS "delivered"
    FROM "MediaObject" m
    JOIN "Version" v      ON v.id = m."versionId"
    LEFT JOIN "Task" t    ON t.id = v."taskId"
    LEFT JOIN "Shot" sh   ON sh.id = t."shotId"  AND sh."hiddenAt" IS NULL
    LEFT JOIN "Asset" ta  ON ta.id = t."assetId" AND ta."hiddenAt" IS NULL
    LEFT JOIN "Asset" va  ON va.id = v."assetId" AND va."hiddenAt" IS NULL
    WHERE m.published = true
      AND m."deletedAt" IS NULL
      AND m."createdAt" >= ${since.toISOString()}::timestamp
      AND (sh."projectId" = ${projectId} OR ta."projectId" = ${projectId} OR va."projectId" = ${projectId})
    GROUP BY 1
  `;
}

/** Vue de pilotage complète d'un projet. `weeks` borne la fenêtre de rythme. */
export async function getOverview(
  projectId: number,
  weeks = 8,
  now = new Date(),
): Promise<ProductionOverview> {
  const since = new Date(now.getTime() - weeks * 7 * 86_400_000);
  const [matrixRows, workloadRows, sequences, paceRows, candidates] = await Promise.all([
    queryMatrix(projectId),
    queryWorkload(projectId, now),
    prisma.sequence.findMany({
      where: { projectId, deletedAt: null, hiddenAt: null },
      orderBy: { order: 'asc' },
      select: { id: true, code: true },
    }),
    queryPace(projectId, since),
    fetchAttentionCandidates(projectId, now, 50),
  ]);

  const matrix = buildMatrix(
    matrixRows.map((r) => ({
      sequenceId: r.sequenceId,
      department: r.department,
      status: r.status,
      family: familyOfAggregate(r),
      count: r.count,
    })),
  );
  const workload = buildWorkload(
    workloadRows.map((r) => ({
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      status: r.status,
      family: familyOfAggregate(r),
      count: r.count,
      overdue: r.overdue,
    })),
    now,
  );
  const pace = buildPace(paceRows, now, weeks);
  // Avancement : la matrice porte déjà les comptes, statuts inactifs exclus.
  const done = matrix.reduce((n, cell) => n + cell.done, 0);
  const total = matrix.reduce((n, cell) => n + cell.total, 0);

  return {
    matrix,
    sequences,
    // Les départements dans l'ordre alphabétique, sans doublon ni valeur vide. Ils sont
    // lus sur TOUTES les lignes, statuts inactifs compris : une colonne du tableau ne doit
    // pas disparaître au motif que son seul travail restant a été mis de côté.
    departments: [
      ...new Set(matrixRows.map((r) => r.department).filter((d): d is string => d !== null)),
    ].sort(),
    attention: findAttention(candidates, now),
    workload,
    pace,
    projection: projectEnd(done, total, pace, now),
  };
}
