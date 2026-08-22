// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma', () => ({
  prisma: { $queryRaw: vi.fn(), sequence: { findMany: vi.fn() } },
}));

import {
  daysBetween,
  computeShotStats,
  computeSequenceConvergence,
  computeTotals,
  rankSlowestShots,
  getProjectStats,
  type ShotAggregateRow,
  type ShotStat,
  type SequenceRow,
} from './StatsService';
import { prisma } from '../lib/prisma';

const d = (iso: string) => new Date(iso);

/** Une ligne d'agrégat de plan, tout à zéro sauf ce que le cas de test précise. */
const agg = (over: Partial<ShotAggregateRow> & Pick<ShotAggregateRow, 'shotId'>): ShotAggregateRow => ({
  code: `SH${String(over.shotId).padStart(3, '0')}`,
  name: 'plan',
  sequenceId: null,
  versions: 0,
  firstVersionAt: null,
  lastIsApproval: false,
  lastIsRetake: false,
  decisions: 0,
  retakes: 0,
  firstApprovalAt: null,
  notes: 0,
  openNotes: 0,
  ...over,
});

describe('StatsService — daysBetween', () => {
  it('arrondit à l’entier et borne à 0', () => {
    expect(daysBetween(d('2026-07-01T00:00:00Z'), d('2026-07-04T00:00:00Z'))).toBe(3);
    expect(daysBetween(d('2026-07-04T00:00:00Z'), d('2026-07-01T00:00:00Z'))).toBe(0);
  });
});

describe('StatsService — computeShotStats', () => {
  // Mêmes plans qu'avant le passage aux agrégats SQL, comptés par la base :
  // SH010 → 2 versions (la dernière approuvée), 1 retake, 1 note ouverte, approuvé le 06.
  const stats = computeShotStats([
    agg({
      shotId: 1,
      code: 'SH010',
      name: 'plan A',
      sequenceId: 10,
      versions: 2,
      firstVersionAt: d('2026-07-01'),
      lastIsApproval: true,
      decisions: 2,
      retakes: 1,
      firstApprovalAt: d('2026-07-06'),
      notes: 2,
      openNotes: 1,
    }),
    agg({
      shotId: 2,
      code: 'SH020',
      name: 'plan B',
      sequenceId: 10,
      versions: 1,
      firstVersionAt: d('2026-07-02'),
      notes: 1,
      openNotes: 1,
    }),
    agg({ shotId: 3, code: 'SH030', name: 'plan C' }),
  ]);

  it('calcule statut, versions, retakes, notes ouvertes et délai', () => {
    const sh1 = stats.find((s) => s.shotId === 1)!;
    expect(sh1.status).toBe('approved');
    expect(sh1.versions).toBe(2);
    expect(sh1.retakes).toBe(1);
    expect(sh1.openNotes).toBe(1);
    // 1ʳᵉ version 2026-07-01 → 1ʳᵉ approbation 2026-07-06 = 5 jours.
    expect(sh1.reviewDays).toBe(5);
  });

  it('marque en review sans approbation et sans version', () => {
    expect(stats.find((s) => s.shotId === 2)!.status).toBe('inReview');
    expect(stats.find((s) => s.shotId === 2)!.reviewDays).toBeNull();
    const sh3 = stats.find((s) => s.shotId === 3)!;
    expect(sh3.status).toBe('notStarted');
    expect(sh3.versions).toBe(0);
  });

  it('marque « retake » quand la dernière version est à refaire', () => {
    const [only] = computeShotStats([agg({ shotId: 4, versions: 3, lastIsRetake: true })]);
    expect(only!.status).toBe('retake');
  });
});

describe('StatsService — convergence par séquence', () => {
  it('groupe par séquence, ajoute « Sans séquence » et omet les vides', () => {
    const sequences: SequenceRow[] = [
      { id: 10, code: 'SQ010', name: 'ouverture' },
      { id: 20, code: 'SQ020', name: 'vide' },
    ];
    const shotStats = computeShotStats([
      agg({ shotId: 1, sequenceId: 10, versions: 1, lastIsApproval: true, firstVersionAt: d('2026-07-01') }),
      agg({ shotId: 2, sequenceId: 10 }),
      agg({ shotId: 3, sequenceId: null }),
    ]);
    const conv = computeSequenceConvergence(sequences, shotStats);
    expect(conv.map((c) => c.code)).toEqual(['SQ010', '—']);
    const sq010 = conv.find((c) => c.sequenceId === 10)!;
    expect(sq010).toMatchObject({ total: 2, approved: 1, notStarted: 1 });
    expect(conv.find((c) => c.sequenceId === null)!.total).toBe(1);
  });
});

describe('StatsService — totaux & classement', () => {
  const shotStats = computeShotStats([
    agg({
      shotId: 1,
      sequenceId: 10,
      versions: 1,
      firstVersionAt: d('2026-07-01'),
      lastIsApproval: true,
      decisions: 1,
      firstApprovalAt: d('2026-07-03'),
    }),
    agg({
      shotId: 2,
      sequenceId: 10,
      versions: 1,
      firstVersionAt: d('2026-07-01'),
      decisions: 1,
      retakes: 1,
      notes: 1,
      openNotes: 1,
    }),
    agg({ shotId: 3, sequenceId: 10 }),
  ]);

  it('taux d’approbation sur les shots démarrés, moyennes et notes ouvertes', () => {
    const totals = computeTotals(shotStats, 2, 2, 1);
    expect(totals.shots).toBe(3);
    // 2 shots démarrés (1 & 2), 1 approuvé → 50 %.
    expect(totals.approvalRate).toBe(50);
    expect(totals.openNotes).toBe(1);
    expect(totals.avgNotesPerVersion).toBe(0.5);
    expect(totals.avgReviewDays).toBe(2); // shot 1 : 2 jours
  });

  it('classe les shots par délai puis retakes', () => {
    const ranked = rankSlowestShots(shotStats);
    // shot 1 (2 j) devant shot 2 (retake, notes) ; shot 3 (rien) exclu.
    expect(ranked.map((s) => s.shotId)).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Équivalence : la version d'origine, qui comptait tout en mémoire, sert d'oracle.
// Les chiffres affichés doivent être identiques ligne à ligne.
// ─────────────────────────────────────────────────────────────────────────────

interface RawShot {
  id: number;
  code: string;
  name: string;
  sequenceId: number | null;
}
interface RawVersion {
  shotId: number;
  createdAt: Date;
  isApproval: boolean;
  isRetake: boolean;
}
type RawDecision = RawVersion;
interface RawNote {
  shotId: number;
  isResolved: boolean;
}

/** Implémentation historique, reprise telle quelle : l'oracle du refactoring. */
function legacyShotStats(
  shots: RawShot[],
  versions: RawVersion[],
  decisions: RawDecision[],
  notes: RawNote[],
): ShotStat[] {
  return shots.map((shot) => {
    const vs = versions
      .filter((v) => v.shotId === shot.id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const ds = decisions.filter((x) => x.shotId === shot.id);
    const ns = notes.filter((n) => n.shotId === shot.id);
    const firstVersionAt = vs[0]?.createdAt ?? null;
    const firstApprovalAt = ds
      .filter((x) => x.isApproval)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt;
    const last = vs.length ? vs[vs.length - 1]! : null;
    return {
      shotId: shot.id,
      code: shot.code,
      name: shot.name,
      sequenceId: shot.sequenceId,
      versions: vs.length,
      retakes: ds.filter((x) => x.isRetake).length,
      openNotes: ns.filter((n) => !n.isResolved).length,
      reviewDays: firstVersionAt && firstApprovalAt ? daysBetween(firstVersionAt, firstApprovalAt) : null,
      status: !last
        ? ('notStarted' as const)
        : last.isApproval
          ? ('approved' as const)
          : last.isRetake
            ? ('retake' as const)
            : ('inReview' as const),
    };
  });
}

/** Ce que la requête d'agrégation rend, calculé ici en TypeScript sur les mêmes données. */
function aggregatesFromRaw(
  shots: RawShot[],
  versions: RawVersion[],
  decisions: RawDecision[],
  notes: RawNote[],
): ShotAggregateRow[] {
  return shots.map((shot) => {
    const vs = [...versions.filter((v) => v.shotId === shot.id)].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const ds = decisions.filter((x) => x.shotId === shot.id);
    const ns = notes.filter((n) => n.shotId === shot.id);
    const approvals = ds
      .filter((x) => x.isApproval)
      .map((x) => x.createdAt.getTime())
      .sort((a, b) => a - b);
    const last = vs.length ? vs[vs.length - 1]! : null;
    return {
      shotId: shot.id,
      code: shot.code,
      name: shot.name,
      sequenceId: shot.sequenceId,
      versions: vs.length,
      firstVersionAt: vs[0]?.createdAt ?? null,
      lastIsApproval: last?.isApproval ?? false,
      lastIsRetake: last?.isRetake ?? false,
      decisions: ds.length,
      retakes: ds.filter((x) => x.isRetake).length,
      firstApprovalAt: approvals.length ? new Date(approvals[0]!) : null,
      notes: ns.length,
      openNotes: ns.filter((n) => !n.isResolved).length,
    };
  });
}

describe('StatsService — équivalence avec le calcul en mémoire d’origine', () => {
  const shots: RawShot[] = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    code: `SH${String((i + 1) * 10).padStart(3, '0')}`,
    name: `plan ${i + 1}`,
    sequenceId: i % 3 === 2 ? null : 10 + (i % 2),
  }));
  // Jeu volontairement biscornu : plans sans version, retakes multiples, approbation
  // avant retake, notes résolues et ouvertes, versions du même jour.
  const versions: RawVersion[] = [];
  const decisions: RawDecision[] = [];
  const notes: RawNote[] = [];
  for (const shot of shots) {
    const n = shot.id % 4; // 0 à 3 versions
    for (let k = 0; k < n; k++) {
      versions.push({
        shotId: shot.id,
        createdAt: new Date(Date.UTC(2026, 6, 1 + k * (shot.id % 3))),
        isApproval: k === n - 1 && shot.id % 5 === 0,
        isRetake: k === n - 1 && shot.id % 5 === 1,
      });
    }
    for (let k = 0; k < shot.id % 3; k++) {
      decisions.push({
        shotId: shot.id,
        createdAt: new Date(Date.UTC(2026, 6, 4 + k)),
        isApproval: k % 2 === 0,
        isRetake: k % 2 === 1,
      });
    }
    for (let k = 0; k < shot.id % 5; k++) notes.push({ shotId: shot.id, isResolved: k % 2 === 0 });
  }

  const rows = aggregatesFromRaw(shots, versions, decisions, notes);

  it('rend exactement les mêmes lignes par plan', () => {
    expect(computeShotStats(rows)).toEqual(legacyShotStats(shots, versions, decisions, notes));
  });

  it('rend exactement les mêmes totaux, convergences et classement', () => {
    const sequences: SequenceRow[] = [
      { id: 10, code: 'SQ010', name: 'a' },
      { id: 11, code: 'SQ020', name: 'b' },
    ];
    const oracle = legacyShotStats(shots, versions, decisions, notes);
    const actual = computeShotStats(rows);
    expect(computeTotals(actual, versions.length, decisions.length, notes.length)).toEqual(
      computeTotals(oracle, versions.length, decisions.length, notes.length),
    );
    expect(computeSequenceConvergence(sequences, actual)).toEqual(
      computeSequenceConvergence(sequences, oracle),
    );
    expect(rankSlowestShots(actual)).toEqual(rankSlowestShots(oracle));
  });

  it('les totaux se déduisent des lignes agrégées, sans recompter les entités', () => {
    const sum = (pick: (r: ShotAggregateRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
    expect(sum((r) => r.versions)).toBe(versions.length);
    expect(sum((r) => r.decisions)).toBe(decisions.length);
    expect(sum((r) => r.notes)).toBe(notes.length);
  });
});

describe('StatsService — getProjectStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ne pose que deux requêtes : l’agrégat des plans et la liste des séquences', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      agg({
        shotId: 1,
        code: 'SH010',
        name: 'a',
        sequenceId: 10,
        versions: 2,
        firstVersionAt: d('2026-07-01'),
        lastIsApproval: true,
        decisions: 3,
        retakes: 1,
        firstApprovalAt: d('2026-07-03'),
        notes: 4,
        openNotes: 2,
      }),
      agg({ shotId: 2, code: 'SH020', name: 'b', sequenceId: 10 }),
    ] as never);
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([
      { id: 10, code: 'SQ010', name: 'ouverture' },
    ] as never);

    const stats = await getProjectStats(7);

    expect(vi.mocked(prisma.$queryRaw)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.sequence.findMany)).toHaveBeenCalledTimes(1);
    expect(stats.totals).toEqual({
      shots: 2,
      versions: 2,
      decisions: 3,
      approvalRate: 100,
      openNotes: 2,
      avgReviewDays: 2,
      avgRetakesPerShot: 0.5,
      avgNotesPerVersion: 2,
    });
    expect(stats.sequences).toEqual([
      {
        sequenceId: 10,
        code: 'SQ010',
        name: 'ouverture',
        total: 2,
        approved: 1,
        inReview: 0,
        retake: 0,
        notStarted: 1,
      },
    ]);
    expect(stats.slowestShots.map((s) => s.shotId)).toEqual([1]);
  });

  it('borne l’agrégat au projet demandé (paramètre substitué, jamais concaténé)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    await getProjectStats(42);
    const call = vi.mocked(prisma.$queryRaw).mock.calls[0]!;
    // Appel en template balisé : [strings, ...valeurs] — l'id voyage en paramètre.
    expect(call.slice(1)).toContain(42);
    expect(vi.mocked(prisma.sequence.findMany).mock.calls[0]![0]!.where).toEqual({
      projectId: 42,
      deletedAt: null,
    });
  });

  it('rend des totaux neutres sur un projet vide', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    const stats = await getProjectStats(1);
    expect(stats.totals).toEqual({
      shots: 0,
      versions: 0,
      decisions: 0,
      approvalRate: 0,
      openNotes: 0,
      avgReviewDays: null,
      avgRetakesPerShot: 0,
      avgNotesPerVersion: 0,
    });
    expect(stats.sequences).toEqual([]);
    expect(stats.slowestShots).toEqual([]);
  });
});
