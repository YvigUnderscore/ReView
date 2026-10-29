// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  clipIndexAt,
  formatTimecode,
  globalTimeOf,
  localTimeAt,
  holdsOnClock,
  isStillClip,
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
  mediaKind: 'VIDEO',
  thumbnailUrl: null,
  placeholder: false,
  durationMismatch: false,
  ...over,
});

// Three shots of 2 s: [0-2[ , [2-4[ , [4-6[
const items = [
  clip({ order: 0, startTime: 0 }),
  clip({ order: 1, startTime: 2 }),
  clip({ order: 2, startTime: 4 }),
];

describe('clipIndexAt', () => {
  it('finds the shot occupying a given instant', () => {
    expect(clipIndexAt(items, 0)).toBe(0);
    expect(clipIndexAt(items, 1.9)).toBe(0);
    expect(clipIndexAt(items, 2)).toBe(1);
    expect(clipIndexAt(items, 5.5)).toBe(2);
  });

  it('stays on the last shot beyond the end', () => {
    expect(clipIndexAt(items, 99)).toBe(2);
  });

  it('returns -1 on an empty montage', () => {
    expect(clipIndexAt([], 3)).toBe(-1);
  });
});

describe('localTimeAt / globalTimeOf', () => {
  it('converts global time into a position within the shot', () => {
    expect(localTimeAt(items[1], 3.5)).toBe(1.5);
  });

  it('clamps the position to the shot boundaries', () => {
    expect(localTimeAt(items[1], 0)).toBe(0);
    expect(localTimeAt(items[1], 99)).toBe(2);
  });

  it('round-trips without drift', () => {
    expect(globalTimeOf(items[2], localTimeAt(items[2], 4.75))).toBe(4.75);
  });
});

describe('sequenceSpans', () => {
  it('merges consecutive shots of the same sequence', () => {
    const spans = sequenceSpans(items);
    expect(spans).toEqual([{ sequenceId: 1, sequenceCode: 'SQ010', startTime: 0, duration: 6 }]);
  });

  it('opens a band at each sequence change', () => {
    const spans = sequenceSpans([
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2, sequenceId: 2, sequenceCode: 'SQ020' }),
      clip({ order: 2, startTime: 4, sequenceId: 2, sequenceCode: 'SQ020' }),
    ]);
    expect(spans.map((s) => s.sequenceCode)).toEqual(['SQ010', 'SQ020']);
    expect(spans[1]).toMatchObject({ startTime: 2, duration: 4 });
  });

  it('never merges two shots outside a sequence', () => {
    const spans = sequenceSpans([
      clip({ order: 0, startTime: 0, sequenceId: null, sequenceCode: null }),
      clip({ order: 1, startTime: 2, sequenceId: null, sequenceCode: null }),
    ]);
    expect(spans).toHaveLength(2);
  });

  it('returns an empty list for an empty montage', () => {
    expect(sequenceSpans([])).toEqual([]);
  });
});

describe('sequenceStarts', () => {
  it('marks the first shot of each sequence', () => {
    const mixed = [
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2 }),
      clip({ order: 2, startTime: 4, sequenceId: 2, sequenceCode: 'SQ020' }),
    ];
    expect(sequenceStarts(mixed)).toEqual([0, 2]);
  });

  it('gives each shot outside a sequence its own boundary', () => {
    const orphans = [
      clip({ order: 0, startTime: 0, sequenceId: null, sequenceCode: null }),
      clip({ order: 1, startTime: 2, sequenceId: null, sequenceCode: null }),
    ];
    expect(sequenceStarts(orphans)).toEqual([0, 1]);
  });

  it('returns an empty list for an empty montage', () => {
    expect(sequenceStarts([])).toEqual([]);
  });
});

describe('trackLayout', () => {
  it('gives each shot a width matching its duration', () => {
    expect(trackLayout(items, 6)).toEqual([
      { index: 0, leftPct: 0, widthPct: (2 / 6) * 100 },
      { index: 1, leftPct: (2 / 6) * 100, widthPct: (2 / 6) * 100 },
      { index: 2, leftPct: (4 / 6) * 100, widthPct: (2 / 6) * 100 },
    ]);
  });

  it('covers the band from end to end', () => {
    const slots = trackLayout(items, 6);
    const last = slots[slots.length - 1];
    expect(last.leftPct + last.widthPct).toBeCloseTo(100, 6);
  });

  it('shares the band equally when no duration is known', () => {
    expect(trackLayout(items, 0).map((s) => s.widthPct)).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });

  it('returns an empty list for an empty montage', () => {
    expect(trackLayout([], 6)).toEqual([]);
  });
});

describe('nextPlayableIndex', () => {
  it('skips placeholders', () => {
    const withGap = [
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2, mediaId: null, placeholder: true }),
      clip({ order: 2, startTime: 4 }),
    ];
    expect(nextPlayableIndex(withGap, 0)).toBe(2);
  });

  it('also skips still shots: nothing to preload in a video element', () => {
    const withStill = [
      clip({ order: 0, startTime: 0 }),
      clip({ order: 1, startTime: 2, mediaKind: 'IMAGE', mediaName: 'still.jpg' }),
      clip({ order: 2, startTime: 4 }),
    ];
    expect(nextPlayableIndex(withStill, 0)).toBe(2);
  });

  it('returns -1 at the end of the montage', () => {
    expect(nextPlayableIndex(items, 2)).toBe(-1);
  });
});

describe('holdsOnClock', () => {
  // The montage stayed stuck at 00:00 when its first shot carried an image: served to a
  // `<video>` tag, it fails demuxing and playback never starts.
  it('holds a placeholder on the clock like an image', () => {
    expect(holdsOnClock(clip({ order: 0, startTime: 0, mediaId: null, placeholder: true }))).toBe(true);
    expect(holdsOnClock(clip({ order: 0, startTime: 0, mediaKind: 'IMAGE' }))).toBe(true);
  });

  it('lets the video drive its own clock', () => {
    expect(holdsOnClock(clip({ order: 0, startTime: 0 }))).toBe(false);
  });

  it('treats 3D and splat like video shots (the montage encodes them as a proxy)', () => {
    expect(holdsOnClock(clip({ order: 0, startTime: 0, mediaKind: 'MODEL_3D' }))).toBe(false);
    expect(holdsOnClock(clip({ order: 0, startTime: 0, mediaKind: 'SPLAT' }))).toBe(false);
  });

  it('does not rule on a missing shot', () => {
    expect(holdsOnClock(null)).toBe(false);
    expect(holdsOnClock(undefined)).toBe(false);
  });
});

describe('isStillClip', () => {
  it('tells a still image apart from an empty placeholder', () => {
    expect(isStillClip(clip({ order: 0, startTime: 0, mediaKind: 'IMAGE' }))).toBe(true);
    expect(isStillClip(clip({ order: 0, startTime: 0, mediaId: null, placeholder: true }))).toBe(false);
    expect(isStillClip(clip({ order: 0, startTime: 0 }))).toBe(false);
  });
});

describe('formatTimecode', () => {
  it('formats the current position', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(75.9)).toBe('1:15');
  });

  it('handles aberrant values', () => {
    expect(formatTimecode(Number.NaN)).toBe('0:00');
    expect(formatTimecode(-2)).toBe('0:00');
  });
});
