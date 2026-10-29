// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';

/**
 * Review statistics per project (43.A, issue #123): time per shot, notes/retakes per version, convergence per sequence.
 *
 * Counting is done IN THE DATABASE. The service used to load every version, every decision and every root comment
 * of the project to count them in JavaScript: at feature-film volume (about 20,000 versions, 20,000 decisions,
 * 50,000 notes), this occupied the process's event loop for seconds to produce a page of figures. A single
 * aggregation query now returns ONE row per shot; the pure functions below (unit-tested without a database) only
 * derive status, averages and rankings from those rows.
 */

// ── Raw rows (inputs of the pure functions) ──
export interface SequenceRow {
  id: number;
  code: string;
  name: string;
}

/**
 * A shot, already counted by the database. The dates are those the review delay depends on;
 * `lastIsApproval`/`lastIsRetake` describe the last published version, which carries the shot's current status.
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

// ── Outputs ──
export type ShotStatus = 'approved' | 'inReview' | 'retake' | 'notStarted';

export interface ShotStat {
  shotId: number;
  code: string;
  name: string;
  sequenceId: number | null;
  versions: number;
  retakes: number;
    /** Verdicts given on this shot: the number of review ROUNDS it has cost. */
  reviewRounds: number;
  openNotes: number;
    /** Delay (days) between the 1st version and the 1st approval decision. */
  reviewDays: number | null;
  status: ShotStatus;
}

export interface SequenceConvergence {
  sequenceId: number | null;
    /**
     * Sequence code. **Empty when `sequenceId` is null** (the "outside any sequence" group):
     * the server writes no screen text; it is up to the reader to name this group in their language.
     * Until now it carried a dash and a hard-coded French label.
     */
  code: string;
    /** Sequence name, empty for the "outside any sequence" group (see `code`). */
  name: string;
  total: number;
  approved: number;
  inReview: number;
  retake: number;
  notStarted: number;
}

/**
 * A bar of the retake histogram: "how many shots cost N retakes".
 *
 * The bounds are numeric and never named: a label such as "3 and more" would be screen text written by the server.
 * A null `max` designates the last, open bar.
 */
export interface RetakeBucket {
  min: number;
  max: number | null;
  shots: number;
}

export interface ProjectStatsTotals {
  shots: number;
  versions: number;
  decisions: number;
    /** % of approved shots among those with at least one version. */
  approvalRate: number;
  openNotes: number;
  avgReviewDays: number | null;
  avgRetakesPerShot: number;
    /** Average review rounds per shot: a shot that is "right the first time" costs one. */
  avgReviewRoundsPerShot: number;
  avgNotesPerVersion: number;
    /** Share (%) of approved shots WITHOUT any retake, among those that were approved. */
  firstTimeRightRate: number;
}

export interface ProjectStats {
  totals: ProjectStatsTotals;
  sequences: SequenceConvergence[];
  slowestShots: ShotStat[];
    /** The shots that cost the most retakes: the ranking of the retakes panel. */
  mostRetakenShots: ShotStat[];
    /** Distribution of retakes per shot, from best to worst. */
  retakeBuckets: RetakeBucket[];
}

/** Difference in whole days (floored at 0). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Derives the status and review delay of each shot already counted in the database. */
export function computeShotStats(rows: ShotAggregateRow[]): ShotStat[] {
  return rows.map((row) => ({
    shotId: row.shotId,
    code: row.code,
    name: row.name,
    sequenceId: row.sequenceId,
    versions: row.versions,
    retakes: row.retakes,
    reviewRounds: row.decisions,
    openNotes: row.openNotes,
    reviewDays:
      row.firstVersionAt && row.firstApprovalAt ? daysBetween(row.firstVersionAt, row.firstApprovalAt) : null,
        // Current status = the denormalized review status of the last version.
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

/**
 * Convergence per sequence (plus the out-of-sequence group), empty sequences omitted.
 *
 * The out-of-sequence group comes out with `sequenceId: null` and EMPTY labels: it used to carry "—" and
 * "No sequence" hard-coded on the server, hence in French for all fourteen languages. Naming this group is
 * the reader's job.
 */
export function computeSequenceConvergence(
  sequences: SequenceRow[],
  shotStats: ShotStat[],
): SequenceConvergence[] {
  const groups = sequences.map((s) => tally(s.id, s.code, s.name, shotStats));
  groups.push(tally(null, '', '', shotStats));
  return groups.filter((g) => g.total > 0);
}

/**
 * Bounds of the retake histogram. Zero, one, two, then everything else: beyond three rounds it is no longer
 * a nuance but a shot to look at closely.
 */
const RETAKE_BUCKETS: readonly { min: number; max: number | null }[] = [
  { min: 0, max: 0 },
  { min: 1, max: 1 },
  { min: 2, max: 2 },
  { min: 3, max: null },
];

/** Distribution of retakes per shot, never-delivered shots excluded (they cost none). */
export function computeRetakeBuckets(shotStats: ShotStat[]): RetakeBucket[] {
  const started = shotStats.filter((s) => s.status !== 'notStarted');
  return RETAKE_BUCKETS.map((b) => ({
    ...b,
    shots: started.filter((s) => s.retakes >= b.min && (b.max === null || s.retakes <= b.max)).length,
  }));
}

/** Ranks the shots that cost the most retakes, then rounds, then notes. */
export function rankMostRetakenShots(shotStats: ShotStat[], limit = 10): ShotStat[] {
  return [...shotStats]
    .filter((s) => s.retakes > 0)
    .sort((a, b) => b.retakes - a.retakes || b.reviewRounds - a.reviewRounds || b.openNotes - a.openNotes)
    .slice(0, limit);
}

/** Project totals from the per-shot stats plus raw counts. */
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
    avgReviewRoundsPerShot: shotStats.length
      ? round1(shotStats.reduce((a, s) => a + s.reviewRounds, 0) / shotStats.length)
      : 0,
    avgNotesPerVersion: totalVersions ? round1(totalNotes / totalVersions) : 0,
        // Reported over APPROVED shots only: a shot still in review has not finished consuming its retakes,
        // and including it would make the rate fall as production goes on.
    firstTimeRightRate: approved
      ? Math.round(
          (shotStats.filter((s) => s.status === 'approved' && s.retakes === 0).length / approved) * 100,
        )
      : 0,
  };
}

/** Ranks the "most costly" shots (delay, then retakes, then open notes). */
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
 * One row per shot, counted by Postgres.
 *
 * Three independent sub-aggregates (versions, decisions, notes) join the project's shot list. `DISTINCT ON` picks
 * the last version of each shot without bringing back its history, and the `FILTER` clauses replace the original
 * `Array.filter` calls. All parameters go through the driver's substitution: no concatenation.
 */
function queryShotAggregates(projectId: number): Promise<ShotAggregateRow[]> {
  return prisma.$queryRaw<ShotAggregateRow[]>`
    WITH shots AS (
      SELECT s.id, s.code, s.name, s."sequenceId"
      FROM "Shot" s
      WHERE s."projectId" = ${projectId} AND s."deletedAt" IS NULL AND s."hiddenAt" IS NULL
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

/** SQL aggregates bounded to the project, then pure computation. */
export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const [rows, sequences] = await Promise.all([
    queryShotAggregates(projectId),
    prisma.sequence.findMany({
      where: { projectId, deletedAt: null, hiddenAt: null },
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
    mostRetakenShots: rankMostRetakenShots(shotStats),
    retakeBuckets: computeRetakeBuckets(shotStats),
  };
}
