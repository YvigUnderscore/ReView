import { describe, it, expect } from 'vitest';
import {
  daysBetween,
  computeShotStats,
  computeSequenceConvergence,
  computeTotals,
  rankSlowestShots,
  type ShotRow,
  type SequenceRow,
  type VersionRow,
  type DecisionRow,
  type NoteRow,
} from './StatsService';

const d = (iso: string) => new Date(iso);

describe('StatsService — daysBetween', () => {
  it('arrondit à l’entier et borne à 0', () => {
    expect(daysBetween(d('2026-07-01T00:00:00Z'), d('2026-07-04T00:00:00Z'))).toBe(3);
    expect(daysBetween(d('2026-07-04T00:00:00Z'), d('2026-07-01T00:00:00Z'))).toBe(0);
  });
});

describe('StatsService — computeShotStats', () => {
  const shots: ShotRow[] = [
    { id: 1, code: 'SH010', name: 'plan A', sequenceId: 10 },
    { id: 2, code: 'SH020', name: 'plan B', sequenceId: 10 },
    { id: 3, code: 'SH030', name: 'plan C', sequenceId: null },
  ];
  const versions: VersionRow[] = [
    { shotId: 1, createdAt: d('2026-07-01'), isApproval: false, isRetake: true },
    { shotId: 1, createdAt: d('2026-07-05'), isApproval: true, isRetake: false }, // dernière = approuvée
    { shotId: 2, createdAt: d('2026-07-02'), isApproval: false, isRetake: false }, // en review
  ];
  const decisions: DecisionRow[] = [
    { shotId: 1, createdAt: d('2026-07-03'), isApproval: false, isRetake: true },
    { shotId: 1, createdAt: d('2026-07-06'), isApproval: true, isRetake: false },
  ];
  const notes: NoteRow[] = [
    { shotId: 1, isResolved: true },
    { shotId: 1, isResolved: false },
    { shotId: 2, isResolved: false },
  ];

  const stats = computeShotStats(shots, versions, decisions, notes);

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
});

describe('StatsService — convergence par séquence', () => {
  it('groupe par séquence, ajoute « Sans séquence » et omet les vides', () => {
    const sequences: SequenceRow[] = [
      { id: 10, code: 'SQ010', name: 'ouverture' },
      { id: 20, code: 'SQ020', name: 'vide' },
    ];
    const shotStats = computeShotStats(
      [
        { id: 1, code: 'SH010', name: 'a', sequenceId: 10 },
        { id: 2, code: 'SH020', name: 'b', sequenceId: 10 },
        { id: 3, code: 'SH030', name: 'c', sequenceId: null },
      ],
      [{ shotId: 1, createdAt: d('2026-07-01'), isApproval: true, isRetake: false }],
      [],
      [],
    );
    const conv = computeSequenceConvergence(sequences, shotStats);
    expect(conv.map((c) => c.code)).toEqual(['SQ010', '—']);
    const sq010 = conv.find((c) => c.sequenceId === 10)!;
    expect(sq010).toMatchObject({ total: 2, approved: 1, notStarted: 1 });
    expect(conv.find((c) => c.sequenceId === null)!.total).toBe(1);
  });
});

describe('StatsService — totaux & classement', () => {
  const shotStats = computeShotStats(
    [
      { id: 1, code: 'SH010', name: 'a', sequenceId: 10 },
      { id: 2, code: 'SH020', name: 'b', sequenceId: 10 },
      { id: 3, code: 'SH030', name: 'c', sequenceId: 10 },
    ],
    [
      { shotId: 1, createdAt: d('2026-07-01'), isApproval: true, isRetake: false },
      { shotId: 2, createdAt: d('2026-07-01'), isApproval: false, isRetake: false },
    ],
    [
      { shotId: 1, createdAt: d('2026-07-03'), isApproval: true, isRetake: false },
      { shotId: 2, createdAt: d('2026-07-02'), isApproval: false, isRetake: true },
    ],
    [{ shotId: 2, isResolved: false }],
  );

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
