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
  mediaKind: 'VIDEO',
  thumbnailUrl: null,
  placeholder: mediaId === null,
  durationMismatch: false,
});

// Typical montage: one delivered shot, a gap, two delivered shots.
const items = [clip(0, 11), clip(1, null), clip(2, 12), clip(3, 13)];

describe('clipIndexOfMedia', () => {
  it('finds the position of a media', () => {
    expect(clipIndexOfMedia(items, 12)).toBe(2);
  });

  it('returns -1 for a media foreign to the montage', () => {
    expect(clipIndexOfMedia(items, 99)).toBe(-1);
  });
});

describe('playableNeighbor', () => {
  it('skips title cards forward as well as backward', () => {
    expect(playableNeighbor(items, 0, 1)?.mediaId).toBe(12);
    expect(playableNeighbor(items, 2, -1)?.mediaId).toBe(11);
  });

  it('returns null at both edges of the montage', () => {
    expect(playableNeighbor(items, 3, 1)).toBeNull();
    expect(playableNeighbor(items, 0, -1)).toBeNull();
  });

  it('returns null when the starting position is unknown', () => {
    expect(playableNeighbor(items, -1, 1)).toBeNull();
  });

  it('returns null in a montage with no media at all', () => {
    expect(playableNeighbor([clip(0, null), clip(1, null)], 0, 1)).toBeNull();
  });
});

describe('playablePosition', () => {
  it('counts only the playable clips', () => {
    expect(playablePosition(items, 2)).toEqual({ position: 2, total: 3 });
    expect(playablePosition(items, 3)).toEqual({ position: 3, total: 3 });
  });

  it('returns a null position outside the montage', () => {
    expect(playablePosition(items, -1)).toEqual({ position: 0, total: 3 });
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9.4)).toBe('0:09');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('copes with outlier values', () => {
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
