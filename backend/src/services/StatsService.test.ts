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
  rankMostRetakenShots,
  computeRetakeBuckets,
  getProjectStats,
  type ShotAggregateRow,
  type ShotStat,
  type SequenceRow,
} from './StatsService';
import { prisma } from '../lib/prisma';

const d = (iso: string) => new Date(iso);

/** A shot aggregate row, all zeros except what the test case specifies. */
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

describe('StatsService: daysBetween', () => {
  it('rounds to an integer and floors at 0', () => {
    expect(daysBetween(d('2026-07-01T00:00:00Z'), d('2026-07-04T00:00:00Z'))).toBe(3);
    expect(daysBetween(d('2026-07-04T00:00:00Z'), d('2026-07-01T00:00:00Z'))).toBe(0);
  });
});

describe('StatsService: computeShotStats', () => {
    // Same shots as before the move to SQL aggregates, counted by the database:
    // SH010 -> 2 versions (the last one approved), 1 retake, 1 open note, approved on the 6th.
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

  it('computes status, versions, retakes, open notes and delay', () => {
    const sh1 = stats.find((s) => s.shotId === 1)!;
    expect(sh1.status).toBe('approved');
    expect(sh1.versions).toBe(2);
    expect(sh1.retakes).toBe(1);
    expect(sh1.openNotes).toBe(1);
        // 1st version 2026-07-01 -> 1st approval 2026-07-06 = 5 days.
    expect(sh1.reviewDays).toBe(5);
  });

  it('marks in review without approval and without a version', () => {
    expect(stats.find((s) => s.shotId === 2)!.status).toBe('inReview');
    expect(stats.find((s) => s.shotId === 2)!.reviewDays).toBeNull();
    const sh3 = stats.find((s) => s.shotId === 3)!;
    expect(sh3.status).toBe('notStarted');
    expect(sh3.versions).toBe(0);
  });

  it('marks "retake" when the last version must be redone', () => {
    const [only] = computeShotStats([agg({ shotId: 4, versions: 3, lastIsRetake: true })]);
    expect(only!.status).toBe('retake');
  });
});

describe('StatsService: convergence per sequence', () => {
  it('groups by sequence, adds the out-of-sequence group and omits empty ones', () => {
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
        // The out-of-sequence group comes out WITHOUT a label: the server names nothing, it only
        // uses a null `sequenceId` ("No sequence" was hard-coded French).
    expect(conv.map((c) => c.code)).toEqual(['SQ010', '']);
    expect(conv.find((c) => c.sequenceId === null)!.name).toBe('');
    const sq010 = conv.find((c) => c.sequenceId === 10)!;
    expect(sq010).toMatchObject({ total: 2, approved: 1, notStarted: 1 });
    expect(conv.find((c) => c.sequenceId === null)!.total).toBe(1);
  });
});

describe('StatsService: totals & ranking', () => {
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

  it('approval rate over started shots, averages and open notes', () => {
    const totals = computeTotals(shotStats, 2, 2, 1);
    expect(totals.shots).toBe(3);
        // 2 shots started (1 & 2), 1 approved -> 50%.
    expect(totals.approvalRate).toBe(50);
    expect(totals.openNotes).toBe(1);
    expect(totals.avgNotesPerVersion).toBe(0.5);
    expect(totals.avgReviewDays).toBe(2); // shot 1 : 2 jours
  });

  it('ranks shots by delay, then retakes', () => {
    const ranked = rankSlowestShots(shotStats);
        // shot 1 (2 days) ahead of shot 2 (retake, notes); shot 3 (nothing) excluded.
    expect(ranked.map((s) => s.shotId)).toEqual([1, 2]);
  });
});

// Equivalence: the original version, which counted everything in memory, serves as the oracle.
// The displayed figures must be identical line by line.

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

/** Historical implementation, kept as is: the oracle of the refactoring. */
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
      reviewRounds: ds.length,
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

/** What the aggregation query returns, computed here in TypeScript on the same data. */
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

describe('StatsService: equivalence with the original in-memory computation', () => {
  const shots: RawShot[] = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    code: `SH${String((i + 1) * 10).padStart(3, '0')}`,
    name: `plan ${i + 1}`,
    sequenceId: i % 3 === 2 ? null : 10 + (i % 2),
  }));
    // Deliberately tangled dataset: shots without versions, multiple retakes, approval before
    // retake, resolved and open notes, versions on the same day.
  const versions: RawVersion[] = [];
  const decisions: RawDecision[] = [];
  const notes: RawNote[] = [];
  for (const shot of shots) {
    const n = shot.id % 4; // 0 to 3 versions
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

  it('returns exactly the same rows per shot', () => {
    expect(computeShotStats(rows)).toEqual(legacyShotStats(shots, versions, decisions, notes));
  });

  it('returns exactly the same totals, convergences and ranking', () => {
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

  it('totals are derived from the aggregated rows, without recounting entities', () => {
    const sum = (pick: (r: ShotAggregateRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
    expect(sum((r) => r.versions)).toBe(versions.length);
    expect(sum((r) => r.decisions)).toBe(decisions.length);
    expect(sum((r) => r.notes)).toBe(notes.length);
  });
});

describe('StatsService: getProjectStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues only two queries: the shot aggregate and the sequence list', async () => {
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
      avgReviewRoundsPerShot: 1.5,
      avgNotesPerVersion: 2,
            // The only approved shot cost a retake: none passed on the first try.
      firstTimeRightRate: 0,
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

  it('bounds the aggregate to the requested project (parameter substituted, never concatenated)', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.sequence.findMany).mockResolvedValue([] as never);
    await getProjectStats(42);
    const call = vi.mocked(prisma.$queryRaw).mock.calls[0]!;
        // Tagged template call: [strings, ...values]; the id travels as a parameter.
    expect(call.slice(1)).toContain(42);
    expect(vi.mocked(prisma.sequence.findMany).mock.calls[0]![0]!.where).toEqual({
      projectId: 42,
      deletedAt: null,
            // A hidden sequence does not count in the project's statistics.
      hiddenAt: null,
    });
  });

  it('returns neutral totals for an empty project', async () => {
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
      avgReviewRoundsPerShot: 0,
      avgNotesPerVersion: 0,
      firstTimeRightRate: 0,
    });
    expect(stats.sequences).toEqual([]);
    expect(stats.slowestShots).toEqual([]);
    expect(stats.mostRetakenShots).toEqual([]);
        // The bars remain, all at zero: an empty histogram is indistinguishable from a missing one,
        // and the screen then has nothing to draw.
    expect(stats.retakeBuckets).toEqual([
      { min: 0, max: 0, shots: 0 },
      { min: 1, max: 1, shots: 0 },
      { min: 2, max: 2, shots: 0 },
      { min: 3, max: null, shots: 0 },
    ]);
  });
});

// Panel "retakes & review rounds" (Phase 50, batch 2)

describe('StatsService: retakes & review rounds', () => {
    /** Four delivered shots, from best to worst, and one never delivered. */
  const shotStats = computeShotStats([
    agg({ shotId: 1, versions: 1, lastIsApproval: true, decisions: 1, retakes: 0 }),
    agg({ shotId: 2, versions: 2, lastIsApproval: true, decisions: 2, retakes: 1 }),
    agg({ shotId: 3, versions: 3, lastIsApproval: true, decisions: 3, retakes: 2, openNotes: 1 }),
    agg({ shotId: 4, versions: 6, lastIsRetake: true, decisions: 6, retakes: 5, openNotes: 4 }),
    agg({ shotId: 5 }),
  ]);

  it('counts review rounds per shot: one verdict, one round', () => {
    expect(shotStats.map((s) => s.reviewRounds)).toEqual([1, 2, 3, 6, 0]);
  });

  it('distributes retakes into bars, never-delivered shots excluded', () => {
        // Shot 5 cost nothing because it was never delivered: counting it as "0 retakes" would flatter
        // production by as many shots as it has not started.
    expect(computeRetakeBuckets(shotStats)).toEqual([
      { min: 0, max: 0, shots: 1 },
      { min: 1, max: 1, shots: 1 },
      { min: 2, max: 2, shots: 1 },
      { min: 3, max: null, shots: 1 },
    ]);
  });

  it('ranks the most retaken shots, and ignores those never retaken', () => {
    expect(rankMostRetakenShots(shotStats).map((s) => s.shotId)).toEqual([4, 3, 2]);
  });

  it('respects the ranking cap', () => {
    expect(rankMostRetakenShots(shotStats, 2).map((s) => s.shotId)).toEqual([4, 3]);
  });

  it('first-time rate: relative to APPROVED shots, not all of them', () => {
        // Three approved (1, 2, 3), only one without a retake -> 33%. Shot 4, still in retake, has not
        // finished consuming its rounds: including it would make the rate fall over time.
    expect(computeTotals(shotStats, 12, 12, 5).firstTimeRightRate).toBe(33);
  });

  it('averages rounds over ALL shots, including those at zero', () => {
        // 1 + 2 + 3 + 6 + 0 = 12 over 5 shots.
    expect(computeTotals(shotStats, 12, 12, 5).avgReviewRoundsPerShot).toBe(2.4);
  });
});
