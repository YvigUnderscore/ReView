// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  clipIndexAt,
  formatTimecode,
  globalTimeOf,
  localTimeAt,
  nextPlayableIndex,
  sequenceSpans,
  sequenceStarts,
  trackLayout,
} from './timelinePlayback';
import type { TimelineClip } from '../../types/api';

const clip = (over: Partial<TimelineClip> & { order: number; startTime: number }): TimelineClip => ({
  duration: 2,
  shotId: over.order + 1,
  shotCode: `SH0${over.order}0`,
  shotName: 'Plan',
  sequenceId: 1,
  sequenceCode: 'SQ010',
  versionId: 10,
  versionName: 'v0001',
  department: 'ANIMATION',
  departmentName: 'Animation',
  mediaId: 100 + over.order,
  mediaName: 'plan.mp4',
  thumbnailUrl: null,
  placeholder: false,
  durationMismatch: false,
  ...over,
});

// Trois plans de 2 s : [0-2[ , [2-4[ , [4-6[
const items = [
  clip({ order: 0, startTime: 0 }),
  clip({ order: 1, startTime: 2 }),
  clip({ order: 2, startTime: 4 }),
];

describe('clipIndexAt', () => {
  it('trouve le plan qui occupe un instant donné', () => {
    expect(clipIndexAt(items, 0)).toBe(0);
    expect(clipIndexAt(items, 1.9)).toBe(0);
    expect(clipIndexAt(items, 2)).toBe(1);
    expect(clipIndexAt(items, 5.5)).toBe(2);
  });

  it('reste sur le dernier plan au-delà de la fin', () => {
    expect(clipIndexAt(items, 99)).toBe(2);
  });

  it('rend -1 sur un montage vide', () => {
    expect(clipIndexAt([], 3)).toBe(-1);
  });
});

describe('localTimeAt / globalTimeOf', () => {
  it('convertit le temps global en position dans le plan', () => {
    expect(localTimeAt(items[1], 3.5)).toBe(1.5);
  });

  it('borne la position aux limites du plan', () => {
    expect(localTimeAt(items[1], 0)).toBe(0);
    expect(localTimeAt(items[1], 99)).toBe(2);
  });

  it('fait l’aller-retour sans dérive', () => {
    expect(globalTimeOf(items[2], localTimeAt(items[2], 4.75))).toBe(4.75);
  });
});

describe('sequenceSpans', () => {
  it('fusionne les plans consécutifs d’une même séquence', () => {
    const spans = sequenceSpans(items);
    expect(spans).toEqual([{ sequenceId: 1, sequenceCode: 'SQ010', startTime: 0, duration: 6 }]);
  });

  it('ouvre une bande à chaque changement de séquence', () => {
    const spans = sequenceSpans([
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2, sequenceId: 2, sequenceCode: 'SQ020' }),
      clip({ order: 2, startTime: 4, sequenceId: 2, sequenceCode: 'SQ020' }),
    ]);
    expect(spans.map((s) => s.sequenceCode)).toEqual(['SQ010', 'SQ020']);
    expect(spans[1]).toMatchObject({ startTime: 2, duration: 4 });
  });

  it('ne fusionne jamais deux plans hors séquence', () => {
    const spans = sequenceSpans([
      clip({ order: 0, startTime: 0, sequenceId: null, sequenceCode: null }),
      clip({ order: 1, startTime: 2, sequenceId: null, sequenceCode: null }),
    ]);
    expect(spans).toHaveLength(2);
  });

  it('rend une liste vide pour un montage vide', () => {
    expect(sequenceSpans([])).toEqual([]);
  });
});

describe('sequenceStarts', () => {
  it('marque le premier plan de chaque séquence', () => {
    const mixed = [
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2 }),
      clip({ order: 2, startTime: 4, sequenceId: 2, sequenceCode: 'SQ020' }),
    ];
    expect(sequenceStarts(mixed)).toEqual([0, 2]);
  });

  it('donne sa frontière à chaque plan hors séquence', () => {
    const orphans = [
      clip({ order: 0, startTime: 0, sequenceId: null, sequenceCode: null }),
      clip({ order: 1, startTime: 2, sequenceId: null, sequenceCode: null }),
    ];
    expect(sequenceStarts(orphans)).toEqual([0, 1]);
  });

  it('rend une liste vide pour un montage vide', () => {
    expect(sequenceStarts([])).toEqual([]);
  });
});

describe('trackLayout', () => {
  it('donne à chaque plan la largeur de sa durée', () => {
    expect(trackLayout(items, 6)).toEqual([
      { index: 0, leftPct: 0, widthPct: (2 / 6) * 100 },
      { index: 1, leftPct: (2 / 6) * 100, widthPct: (2 / 6) * 100 },
      { index: 2, leftPct: (4 / 6) * 100, widthPct: (2 / 6) * 100 },
    ]);
  });

  it('couvre la bande de bout en bout', () => {
    const slots = trackLayout(items, 6);
    const last = slots[slots.length - 1];
    expect(last.leftPct + last.widthPct).toBeCloseTo(100, 6);
  });

  it('partage la bande à parts égales quand aucune durée n’est connue', () => {
    expect(trackLayout(items, 0).map((s) => s.widthPct)).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });

  it('rend une liste vide pour un montage vide', () => {
    expect(trackLayout([], 6)).toEqual([]);
  });
});

describe('nextPlayableIndex', () => {
  it('saute les cartons', () => {
    const withGap = [
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2, mediaId: null, placeholder: true }),
      clip({ order: 2, startTime: 4 }),
    ];
    expect(nextPlayableIndex(withGap, 0)).toBe(2);
  });

  it('rend -1 en fin de montage', () => {
    expect(nextPlayableIndex(items, 2)).toBe(-1);
  });
});

describe('formatTimecode', () => {
  it('met en forme la position courante', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(75.9)).toBe('1:15');
  });

  it('encaisse les valeurs aberrantes', () => {
    expect(formatTimecode(Number.NaN)).toBe('0:00');
    expect(formatTimecode(-2)).toBe('0:00');
  });
});
