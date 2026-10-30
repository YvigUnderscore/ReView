// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  buildItems,
  clipDuration,
  declaredDuration,
  diffItems,
  totalDuration,
  PLACEHOLDER_DURATION,
  type PickRow,
  type ShotRow,
} from './timelineBuild';

const shot = (over: Partial<ShotRow> = {}): ShotRow => ({
  id: 1,
  code: 'SH010',
  name: 'Arrivée',
  sequenceId: 7,
  sequenceCode: 'SQ010',
  startFrame: null,
  endFrame: null,
  ...over,
});

const pick = (over: Partial<PickRow> = {}): PickRow => ({
  versionId: 100,
  versionName: 'v0003',
  department: 'ANIMATION',
  mediaId: 500,
  mediaDuration: 2,
  ...over,
});

describe('declaredDuration', () => {
  it('converts a frame range to seconds, bounds included', () => {
    expect(declaredDuration(shot({ startFrame: 1001, endFrame: 1024 }), 24)).toBe(1);
  });

  it('returns null without a complete range or a usable frame rate', () => {
    expect(declaredDuration(shot({ startFrame: 1001 }), 24)).toBeNull();
    expect(declaredDuration(shot({ startFrame: 1001, endFrame: 1024 }), 0)).toBeNull();
    expect(declaredDuration(shot({ startFrame: 1024, endFrame: 1001 }), 24)).toBeNull();
  });
});

describe('clipDuration', () => {
  it('prioritizes the actual media', () => {
    expect(clipDuration(3.5, 1)).toBe(3.5);
  });

  it('falls back to the declared duration, then to the placeholder duration', () => {
    expect(clipDuration(null, 2)).toBe(2);
    expect(clipDuration(null, null)).toBe(PLACEHOLDER_DURATION);
    expect(clipDuration(0, null)).toBe(PLACEHOLDER_DURATION);
  });
});

describe('buildItems', () => {
  const shots = [
    shot({ id: 1, code: 'SH010' }),
    shot({ id: 2, code: 'SH020' }),
    shot({ id: 3, code: 'SH030' }),
  ];

  it('chains the clips and accumulates the start times', () => {
    const picks = new Map([
      [1, pick({ mediaDuration: 2 })],
      [2, pick({ mediaDuration: 3 })],
      [3, pick({ mediaDuration: 1.5 })],
    ]);
    const items = buildItems(shots, picks, 24);
    expect(items.map((i) => i.startTime)).toEqual([0, 2, 5]);
    expect(totalDuration(items)).toBe(6.5);
  });

  it('replaces a shot without a version with a placeholder, without skipping it', () => {
    const picks = new Map([[1, pick({ mediaDuration: 2 })]]);
    const items = buildItems(shots, picks, 24);
    expect(items).toHaveLength(3);
    expect(items[1]).toMatchObject({ placeholder: true, versionId: null, duration: PLACEHOLDER_DURATION });
    expect(items[2]!.startTime).toBe(2 + PLACEHOLDER_DURATION);
  });

  it('honors the declared duration of the shot for a placeholder', () => {
    const items = buildItems([shot({ startFrame: 1001, endFrame: 1048 })], new Map(), 24);
    expect(items[0]).toMatchObject({ placeholder: true, duration: 2 });
  });

  it('treats a version without media as a gap', () => {
    const picks = new Map([[1, pick({ mediaId: null, mediaDuration: null })]]);
    const items = buildItems([shots[0]!], picks, 24);
    expect(items[0]!.placeholder).toBe(true);
  });

  it('flags a difference between media and declared range without touching it', () => {
    const picks = new Map([[1, pick({ mediaDuration: 5 })]]);
    const items = buildItems([shot({ startFrame: 1001, endFrame: 1024 })], picks, 24);
    expect(items[0]!.duration).toBe(5);
    expect(items[0]!.durationMismatch).toBe(true);
  });

  it('flags nothing for a difference within the tolerance', () => {
    const picks = new Map([[1, pick({ mediaDuration: 1.2 })]]);
    const items = buildItems([shot({ startFrame: 1001, endFrame: 1024 })], picks, 24);
    expect(items[0]!.durationMismatch).toBe(false);
  });

  it('returns an empty timeline for a sequence without shots', () => {
    expect(buildItems([], new Map(), 24)).toEqual([]);
    expect(totalDuration([])).toBe(0);
  });
});

describe('diffItems', () => {
  it('reports added, removed and re-versioned shots', () => {
    const diff = diffItems(
      [
        { shotCode: 'SH010', versionName: 'v0001' },
        { shotCode: 'SH020', versionName: 'v0002' },
        { shotCode: 'SH030', versionName: 'v0001' },
      ],
      [
        { shotCode: 'SH010', versionName: 'v0001' },
        { shotCode: 'SH020', versionName: 'v0005' },
        { shotCode: 'SH040', versionName: 'v0001' },
      ],
    );
    expect(diff.added).toEqual(['SH040']);
    expect(diff.removed).toEqual(['SH030']);
    expect(diff.changed).toEqual([{ shotCode: 'SH020', from: 'v0002', to: 'v0005' }]);
  });

  it('sees a gap being filled as a change', () => {
    const diff = diffItems(
      [{ shotCode: 'SH010', versionName: null }],
      [{ shotCode: 'SH010', versionName: 'v0001' }],
    );
    expect(diff.changed).toEqual([{ shotCode: 'SH010', from: null, to: 'v0001' }]);
  });

  it('reports nothing between two identical states', () => {
    const items = [{ shotCode: 'SH010', versionName: 'v0001' }];
    expect(diffItems(items, items)).toEqual({ added: [], removed: [], changed: [] });
  });
});
