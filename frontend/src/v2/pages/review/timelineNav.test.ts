// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { clipIndexOfMedia, formatDuration, playableNeighbor, playablePosition } from './timelineNav';
import type { TimelineClip } from '../../types/api';

const clip = (order: number, mediaId: number | null): TimelineClip => ({
  order,
  startTime: order * 2,
  duration: 2,
  shotId: order + 1,
  shotCode: `SH0${order}0`,
  shotName: 'Plan',
  sequenceId: 1,
  sequenceCode: 'SQ010',
  versionId: mediaId ? mediaId * 10 : null,
  versionName: mediaId ? 'v0001' : null,
  department: 'ANIMATION',
  departmentName: 'Animation',
  mediaId,
  mediaName: mediaId ? 'plan.mp4' : null,
  thumbnailUrl: null,
  placeholder: mediaId === null,
  durationMismatch: false,
});

// Montage type : un plan livré, un trou, deux plans livrés.
const items = [clip(0, 11), clip(1, null), clip(2, 12), clip(3, 13)];

describe('clipIndexOfMedia', () => {
  it('retrouve la position d’un média', () => {
    expect(clipIndexOfMedia(items, 12)).toBe(2);
  });

  it('rend -1 pour un média étranger au montage', () => {
    expect(clipIndexOfMedia(items, 99)).toBe(-1);
  });
});

describe('playableNeighbor', () => {
  it('saute les cartons en avant comme en arrière', () => {
    expect(playableNeighbor(items, 0, 1)?.mediaId).toBe(12);
    expect(playableNeighbor(items, 2, -1)?.mediaId).toBe(11);
  });

  it('rend null aux deux bords du montage', () => {
    expect(playableNeighbor(items, 3, 1)).toBeNull();
    expect(playableNeighbor(items, 0, -1)).toBeNull();
  });

  it('rend null quand la position de départ est inconnue', () => {
    expect(playableNeighbor(items, -1, 1)).toBeNull();
  });

  it('rend null dans un montage entièrement vide de médias', () => {
    expect(playableNeighbor([clip(0, null), clip(1, null)], 0, 1)).toBeNull();
  });
});

describe('playablePosition', () => {
  it('compte les seuls clips lisibles', () => {
    expect(playablePosition(items, 2)).toEqual({ position: 2, total: 3 });
    expect(playablePosition(items, 3)).toEqual({ position: 3, total: 3 });
  });

  it('rend une position nulle hors montage', () => {
    expect(playablePosition(items, -1)).toEqual({ position: 0, total: 3 });
  });
});

describe('formatDuration', () => {
  it('met en forme minutes et secondes', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9.4)).toBe('0:09');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('encaisse les valeurs aberrantes', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
