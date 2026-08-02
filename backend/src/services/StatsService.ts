// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';

/**
 * Statistiques de review par projet (43.A — №123) : temps par shot, notes/retakes par
 * version, convergence par séquence. Le calcul est isolé dans des fonctions pures
 * (testées sans DB) ; `getProjectStats` fait les requêtes Prisma puis délègue.
 */

// ── Lignes brutes (entrée des fonctions pures) ──
export interface ShotRow {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
}
export interface SequenceRow {
  id: number;
  code: string;
  name: string;
}
export interface VersionRow {
  shotId: number;
  createdAt: Date;
  isApproval: boolean;
  isRetake: boolean;
}
export interface DecisionRow {
  shotId: number;
  createdAt: Date;
  isApproval: boolean;
  isRetake: boolean;
}
export interface NoteRow {
  shotId: number;
  isResolved: boolean;
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

/** Agrège par shot : versions, retakes, notes ouvertes, délai de review, statut courant. */
export function computeShotStats(
  shots: ShotRow[],
  versions: VersionRow[],
  decisions: DecisionRow[],
  notes: NoteRow[],
): ShotStat[] {
  return shots.map((shot) => {
    const vs = versions
      .filter((v) => v.shotId === shot.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const ds = decisions.filter((d) => d.shotId === shot.id);
    const ns = notes.filter((n) => n.shotId === shot.id);

    const firstVersionAt = vs[0]?.createdAt ?? null;
    const firstApprovalAt = ds
      .filter((d) => d.isApproval)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt;
    const reviewDays =
      firstVersionAt && firstApprovalAt ? daysBetween(firstVersionAt, firstApprovalAt) : null;

    // Statut courant = statut de review dénormalisé de la dernière version.
    const last = vs.length ? vs[vs.length - 1] : null;
    const status: ShotStatus = !last
      ? 'notStarted'
      : last.isApproval
        ? 'approved'
        : last.isRetake
          ? 'retake'
          : 'inReview';

    return {
      shotId: shot.id,
      code: shot.code,
      name: shot.name,
      sequenceId: shot.sequenceId,
      versions: vs.length,
      retakes: ds.filter((d) => d.isRetake).length,
      openNotes: ns.filter((n) => !n.isResolved).length,
      reviewDays,
      status,
    };
  });
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

/** Requêtes Prisma bornées aux shots du projet, puis calcul pur. */
export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const shotWhere = { projectId, deletedAt: null };
  const [shots, sequences, versionRows, decisionRows, noteRows] = await Promise.all([
    prisma.shot.findMany({
      where: shotWhere,
      select: { id: true, code: true, name: true, sequenceId: true },
    }),
    prisma.sequence.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true, code: true, name: true },
    }),
    prisma.version.findMany({
      where: { deletedAt: null, task: { shot: shotWhere } },
      select: {
        createdAt: true,
        task: { select: { shotId: true } },
        reviewStatus: { select: { isApproval: true, isRetake: true } },
      },
    }),
    prisma.reviewDecision.findMany({
      where: { version: { task: { shot: shotWhere } } },
      select: {
        createdAt: true,
        status: { select: { isApproval: true, isRetake: true } },
        version: { select: { task: { select: { shotId: true } } } },
      },
    }),
    prisma.comment.findMany({
      where: { parentId: null, media: { deletedAt: null, version: { task: { shot: shotWhere } } } },
      select: {
        isResolved: true,
        media: { select: { version: { select: { task: { select: { shotId: true } } } } } },
      },
    }),
  ]);

  const versions: VersionRow[] = versionRows.flatMap((v) =>
    v.task?.shotId
      ? [
          {
            shotId: v.task.shotId,
            createdAt: v.createdAt,
            isApproval: v.reviewStatus?.isApproval ?? false,
            isRetake: v.reviewStatus?.isRetake ?? false,
          },
        ]
      : [],
  );
  const decisions: DecisionRow[] = decisionRows.flatMap((d) => {
    const shotId = d.version?.task?.shotId;
    return shotId
      ? [{ shotId, createdAt: d.createdAt, isApproval: d.status.isApproval, isRetake: d.status.isRetake }]
      : [];
  });
  const notes: NoteRow[] = noteRows.flatMap((c) => {
    const shotId = c.media?.version?.task?.shotId;
    return shotId ? [{ shotId, isResolved: c.isResolved }] : [];
  });

  const shotStats = computeShotStats(shots, versions, decisions, notes);
  return {
    totals: computeTotals(shotStats, versions.length, decisions.length, notes.length),
    sequences: computeSequenceConvergence(sequences, shotStats),
    slowestShots: rankSlowestShots(shotStats),
  };
}
