// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';

/**
 * Statistiques de review par projet (43.A — №123) : temps par shot, notes/retakes par
 * version, convergence par séquence.
 *
 * Le comptage se fait EN BASE. Le service chargeait auparavant toutes les versions, toutes
 * les décisions et tous les commentaires racines du projet pour les compter en JavaScript :
 * à la volumétrie d'un long-métrage (~20 000 versions, ~20 000 décisions, ~50 000 notes),
 * cela occupait l'event loop du process pendant des secondes pour produire une page de
 * chiffres. Une seule requête d'agrégation rend désormais UNE ligne par plan ; les
 * fonctions pures ci-dessous (testées sans base) ne font plus que dériver statut, moyennes
 * et classements de ces lignes.
 */

// ── Lignes brutes (entrée des fonctions pures) ──
export interface SequenceRow {
  id: number;
  code: string;
  name: string;
}

/**
 * Un plan, déjà compté par la base. Les dates sont celles dont dépend le délai de review ;
 * `lastIsApproval`/`lastIsRetake` décrivent la dernière version publiée, qui porte le
 * statut courant du plan.
 */
export interface ShotAggregateRow {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  versions: number;
  firstVersionAt: Date | null;
  lastIsApproval: boolean;
  lastIsRetake: boolean;
  decisions: number;
  retakes: number;
  firstApprovalAt: Date | null;
  notes: number;
  openNotes: number;
}

// ── Sorties ──
export type ShotStatus = 'approved' | 'inReview' | 'retake' | 'notStarted';

export interface ShotStat {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  versions: number;
  retakes: number;
  openNotes: number;
  /** Délai (jours) entre la 1ʳᵉ version et la 1ʳᵉ décision d'approbation. */
  reviewDays: number | null;
  status: ShotStatus;
}

export interface SequenceConvergence {
  sequenceId: number | null;
  code: string;
  name: string;
  total: number;
  approved: number;
  inReview: number;
  retake: number;
  notStarted: number;
}

export interface ProjectStatsTotals {
  shots: number;
  versions: number;
  decisions: number;
  /** % de shots approuvés parmi ceux ayant au moins une version. */
  approvalRate: number;
  openNotes: number;
  avgReviewDays: number | null;
  avgRetakesPerShot: number;
  avgNotesPerVersion: number;
}

export interface ProjectStats {
  totals: ProjectStatsTotals;
  sequences: SequenceConvergence[];
  slowestShots: ShotStat[];
}

/** Différence en jours entiers (bornée à 0). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Dérive statut et délai de review de chaque plan déjà compté en base. */
export function computeShotStats(rows: ShotAggregateRow[]): ShotStat[] {
  return rows.map((row) => ({
    shotId: row.shotId,
    code: row.code,
    name: row.name,
    sequenceId: row.sequenceId,
    versions: row.versions,
    retakes: row.retakes,
    openNotes: row.openNotes,
    reviewDays:
      row.firstVersionAt && row.firstApprovalAt ? daysBetween(row.firstVersionAt, row.firstApprovalAt) : null,
    // Statut courant = statut de review dénormalisé de la dernière version.
    status:
      row.versions === 0
        ? 'notStarted'
        : row.lastIsApproval
          ? 'approved'
          : row.lastIsRetake
            ? 'retake'
            : 'inReview',
  }));
}

function tally(
  sequenceId: number | null,
  code: string,
  name: string,
  shotStats: ShotStat[],
): SequenceConvergence {
  const scoped = shotStats.filter((s) => s.sequenceId === sequenceId);
  const count = (st: ShotStatus) => scoped.filter((s) => s.status === st).length;
  return {
    sequenceId,
    code,
    name,
    total: scoped.length,
    approved: count('approved'),
    inReview: count('inReview'),
    retake: count('retake'),
    notStarted: count('notStarted'),
  };
}

/** Convergence par séquence (+ groupe « Sans séquence »), séquences vides omises. */
export function computeSequenceConvergence(
  sequences: SequenceRow[],
  shotStats: ShotStat[],
): SequenceConvergence[] {
  const groups = sequences.map((s) => tally(s.id, s.code, s.name, shotStats));
  groups.push(tally(null, '—', 'Sans séquence', shotStats));
  return groups.filter((g) => g.total > 0);
}

/** Totaux projet à partir des stats par shot + comptes bruts. */
export function computeTotals(
  shotStats: ShotStat[],
  totalVersions: number,
  totalDecisions: number,
  totalNotes: number,
): ProjectStatsTotals {
  const withVersions = shotStats.filter((s) => s.status !== 'notStarted');
  const approved = shotStats.filter((s) => s.status === 'approved').length;
  const reviewed = shotStats.filter((s) => s.reviewDays !== null);
  const avgReviewDays = reviewed.length
    ? round1(reviewed.reduce((a, s) => a + (s.reviewDays ?? 0), 0) / reviewed.length)
    : null;
  return {
    shots: shotStats.length,
    versions: totalVersions,
    decisions: totalDecisions,
    approvalRate: withVersions.length ? Math.round((approved / withVersions.length) * 100) : 0,
    openNotes: shotStats.reduce((a, s) => a + s.openNotes, 0),
    avgReviewDays,
    avgRetakesPerShot: shotStats.length
      ? round1(shotStats.reduce((a, s) => a + s.retakes, 0) / shotStats.length)
      : 0,
    avgNotesPerVersion: totalVersions ? round1(totalNotes / totalVersions) : 0,
  };
}

/** Classe les shots « les plus coûteux » (délai, puis retakes, puis notes ouvertes). */
export function rankSlowestShots(shotStats: ShotStat[], limit = 10): ShotStat[] {
  return [...shotStats]
    .filter((s) => s.reviewDays !== null || s.retakes > 0 || s.openNotes > 0)
    .sort(
      (a, b) =>
        (b.reviewDays ?? 0) - (a.reviewDays ?? 0) || b.retakes - a.retakes || b.openNotes - a.openNotes,
    )
    .slice(0, limit);
}

/**
 * Une ligne par plan, comptée par Postgres.
 *
 * Trois sous-agrégats indépendants (versions, décisions, notes) rejoignent la liste des
 * plans du projet. `DISTINCT ON` élit la dernière version de chaque plan sans en rapatrier
 * l'historique, et les `FILTER` remplacent les `Array.filter` d'origine. Tous les
 * paramètres passent par la substitution du driver — aucune concaténation.
 */
function queryShotAggregates(projectId: number): Promise<ShotAggregateRow[]> {
  return prisma.$queryRaw<ShotAggregateRow[]>`
    WITH shots AS (
      SELECT s.id, s.code, s.name, s."sequenceId"
      FROM "Shot" s
      WHERE s."projectId" = ${projectId} AND s."deletedAt" IS NULL
    ),
    versions AS (
      SELECT t."shotId" AS shot_id,
             v.id       AS version_id,
             v."createdAt" AS created_at,
             COALESCE(rs."isApproval", false) AS is_approval,
             COALESCE(rs."isRetake", false)   AS is_retake
      FROM "Version" v
      JOIN "Task" t   ON t.id = v."taskId"
      JOIN shots      ON shots.id = t."shotId"
      LEFT JOIN "ReviewStatus" rs ON rs.id = v."reviewStatusId"
      WHERE v."deletedAt" IS NULL
    ),
    version_agg AS (
      SELECT shot_id, COUNT(*)::int AS versions, MIN(created_at) AS first_version_at
      FROM versions GROUP BY shot_id
    ),
    version_last AS (
      SELECT DISTINCT ON (shot_id) shot_id, is_approval, is_retake
      FROM versions ORDER BY shot_id, created_at DESC, version_id DESC
    ),
    decisions AS (
      SELECT t."shotId" AS shot_id,
             d."createdAt" AS created_at,
             rs."isApproval" AS is_approval,
             rs."isRetake"   AS is_retake
      FROM "ReviewDecision" d
      JOIN "Version" v ON v.id = d."versionId"
      JOIN "Task" t    ON t.id = v."taskId"
      JOIN shots       ON shots.id = t."shotId"
      JOIN "ReviewStatus" rs ON rs.id = d."statusId"
    ),
    decision_agg AS (
      SELECT shot_id,
             COUNT(*)::int AS decisions,
             COUNT(*) FILTER (WHERE is_retake)::int AS retakes,
             MIN(created_at) FILTER (WHERE is_approval) AS first_approval_at
      FROM decisions GROUP BY shot_id
    ),
    notes AS (
      SELECT t."shotId" AS shot_id, c."isResolved" AS is_resolved
      FROM "Comment" c
      JOIN "MediaObject" m ON m.id = c."mediaObjectId"
      JOIN "Version" v     ON v.id = m."versionId"
      JOIN "Task" t        ON t.id = v."taskId"
      JOIN shots           ON shots.id = t."shotId"
      WHERE c."parentId" IS NULL AND m."deletedAt" IS NULL
    ),
    note_agg AS (
      SELECT shot_id,
             COUNT(*)::int AS notes,
             COUNT(*) FILTER (WHERE NOT is_resolved)::int AS open_notes
      FROM notes GROUP BY shot_id
    )
    SELECT shots.id                            AS "shotId",
           shots.code                          AS "code",
           shots.name                          AS "name",
           shots."sequenceId"                  AS "sequenceId",
           COALESCE(va.versions, 0)            AS "versions",
           va.first_version_at                 AS "firstVersionAt",
           COALESCE(vl.is_approval, false)     AS "lastIsApproval",
           COALESCE(vl.is_retake, false)       AS "lastIsRetake",
           COALESCE(da.decisions, 0)           AS "decisions",
           COALESCE(da.retakes, 0)             AS "retakes",
           da.first_approval_at                AS "firstApprovalAt",
           COALESCE(na.notes, 0)               AS "notes",
           COALESCE(na.open_notes, 0)          AS "openNotes"
    FROM shots
    LEFT JOIN version_agg  va ON va.shot_id = shots.id
    LEFT JOIN version_last vl ON vl.shot_id = shots.id
    LEFT JOIN decision_agg da ON da.shot_id = shots.id
    LEFT JOIN note_agg     na ON na.shot_id = shots.id
    ORDER BY shots.id
  `;
}

/** Agrégats SQL bornés au projet, puis calcul pur. */
export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const [rows, sequences] = await Promise.all([
    queryShotAggregates(projectId),
    prisma.sequence.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const sum = (pick: (row: ShotAggregateRow) => number) => rows.reduce((n, row) => n + pick(row), 0);
  const shotStats = computeShotStats(rows);
  return {
    totals: computeTotals(
      shotStats,
      sum((r) => r.versions),
      sum((r) => r.decisions),
      sum((r) => r.notes),
    ),
    sequences: computeSequenceConvergence(sequences, shotStats),
    slowestShots: rankSlowestShots(shotStats),
  };
}
