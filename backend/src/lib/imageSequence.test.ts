// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  ffmpegFrameRate,
  frameNameOf,
  framePattern,
  groupFrameNames,
  isSafeFrameName,
  localFrameName,
  localFramePattern,
  looksLikeSequencePattern,
  MIN_SEQUENCE_FRAMES,
  parseFrameName,
  parseFramePattern,
  sequenceFrameKey,
  sequenceFramePrefix,
  sequenceInputOptions,
  sequenceManifestKey,
  sequenceSummary,
} from './imageSequence';

/**
/**
 * Image sequence recognition.
 *
 * The domain trap fits in one name: `SH0100_comp_v003.1001.exr` carries TWO numbers. Taking the first groups the whole
 * shot under "version 3"; taking the last one before the extension is the only correct reading. The remaining cases —
 * gaps, padding, several sequences in one upload — decide what is proposed to the user.
 */

describe('parseFrameName — the frame number is the last one before the extension', () => {
  it('does not confuse the version number with the frame number', () => {
    expect(parseFrameName('SH0100_comp_v003.1001.exr')).toEqual({
      base: 'SH0100_comp_v003.',
      number: 1001,
      digits: 4,
      extension: '.exr',
    });
  });

  it('accepts the three separators seen in production (dot, underscore, none)', () => {
    expect(parseFrameName('plan_1001.dpx')?.base).toBe('plan_');
    expect(parseFrameName('plan-1001.dpx')?.base).toBe('plan-');
    expect(parseFrameName('plan1001.dpx')?.base).toBe('plan');
  });

  it('keeps the field width, leading zeros included', () => {
    expect(parseFrameName('plan.0042.exr')).toMatchObject({ number: 42, digits: 4 });
    expect(parseFrameName('plan.42.exr')).toMatchObject({ number: 42, digits: 2 });
  });

  it('normalises the extension and refuses what is not numbered', () => {
    expect(parseFrameName('plan.1001.EXR')?.extension).toBe('.exr');
    expect(parseFrameName('planche.exr')).toBeNull();
    expect(parseFrameName('sans-extension-1001')).toBeNull();
  });

  it('refuses a number too long to be a frame (timestamp, identifier)', () => {
    expect(parseFrameName('render_1723458123456.exr')).toBeNull();
  });
});

describe('isSafeFrameName — the name becomes a storage key', () => {
  it('accepts real delivery names', () => {
    expect(isSafeFrameName('SH0100_comp_v003.1001.exr')).toBe(true);
  });

  it('refuses anything disguised as a path', () => {
    for (const name of ['../secret.exr', 'a/b.exr', '/etc/passwd', '.hidden.exr', 'plan 1001.exr', '']) {
      expect(isSafeFrameName(name)).toBe(false);
    }
  });

  it('refuses an oversized name', () => {
    expect(isSafeFrameName(`${'a'.repeat(240)}.exr`)).toBe(false);
  });
});

describe('framePattern / parseFramePattern', () => {
  it('round-trips', () => {
    const pattern = framePattern('SH0100_comp_v003.', 4, '.exr');
    expect(pattern).toBe('SH0100_comp_v003.%04d.exr');
    expect(parseFramePattern(pattern)).toEqual({
      base: 'SH0100_comp_v003.',
      digits: 4,
      extension: '.exr',
    });
  });

  it('refuses what is not a pattern', () => {
    expect(parseFramePattern('plan.1001.exr')).toBeNull();
    expect(parseFramePattern('plan.%d.exr')).toBeNull();
  });

  it('rebuilds the name of a given frame', () => {
    expect(frameNameOf('plan.', 4, '.exr', 1001)).toBe('plan.1001.exr');
    expect(frameNameOf('plan.', 4, '.exr', 7)).toBe('plan.0007.exr');
  });

  it('recognises a pattern where a file is expected (API v1)', () => {
    expect(looksLikeSequencePattern('plan.%04d.exr')).toBe(true);
    expect(looksLikeSequencePattern('plan.####.exr')).toBe(true);
    expect(looksLikeSequencePattern('SH0100_comp_v003.1001.exr')).toBe(false);
  });
});

describe('groupFrameNames — propose, never impose', () => {
  const seq = (base: string, from: number, to: number, ext = '.exr'): string[] =>
    Array.from({ length: to - from + 1 }, (_, i) => `${base}${String(from + i).padStart(4, '0')}${ext}`);

  it('groups a complete shot into a single proposal', () => {
    const { sequences, singles } = groupFrameNames(seq('SH0100_comp_v003.', 1001, 1100));
    expect(singles).toEqual([]);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]!.pattern).toBe('SH0100_comp_v003.%04d.exr');
    expect(sequences[0]!.frames).toHaveLength(100);
  });

  it('separates two sequences uploaded together, and leaves isolated files aside', () => {
    const { sequences, singles } = groupFrameNames([
      ...seq('SH0100_comp_v003.', 1001, 1010),
      ...seq('SH0200_comp_v001.', 1001, 1010),
      'notes.txt',
      'SH0100_comp_v003.mov',
    ]);
    expect(sequences.map((s) => s.pattern)).toEqual([
      'SH0100_comp_v003.%04d.exr',
      'SH0200_comp_v001.%04d.exr',
    ]);
    expect([...singles].sort()).toEqual(['SH0100_comp_v003.mov', 'notes.txt']);
  });

  it('keeps a numbering with gaps: it is a production fact, not a reading error', () => {
    const names = ['plan.1001.exr', 'plan.1002.exr', 'plan.1005.exr'];
    const { sequences } = groupFrameNames(names);
    expect(sequences[0]!.frames).toEqual([1001, 1002, 1005]);
    expect(sequenceSummary(sequences[0]!.frames)).toEqual({
      startFrame: 1001,
      endFrame: 1005,
      frameCount: 3,
      missingFrames: 2,
    });
  });

  it('sorts by number, whatever the order of the upload', () => {
    const { sequences } = groupFrameNames(['plan.0010.exr', 'plan.0002.exr', 'plan.0100.exr']);
    expect(sequences[0]!.frames).toEqual([2, 10, 100]);
    expect(sequences[0]!.names[0]).toBe('plan.0002.exr');
  });

  it('does not propose a sequence of a single file', () => {
    const { sequences, singles } = groupFrameNames(['plan.1001.exr']);
    expect(MIN_SEQUENCE_FRAMES).toBe(2);
    expect(sequences).toEqual([]);
    expect(singles).toEqual(['plan.1001.exr']);
  });

  it('does not mix two paddings or two extensions under one pattern', () => {
    const { sequences } = groupFrameNames([
      'plan.001.exr',
      'plan.002.exr',
      'plan.0001.exr',
      'plan.0002.exr',
      'plan.0001.dpx',
      'plan.0002.dpx',
    ]);
    expect(sequences.map((s) => s.pattern).sort()).toEqual([
      'plan.%03d.exr',
      'plan.%04d.dpx',
      'plan.%04d.exr',
    ]);
  });
});

describe('MinIO key conventions', () => {
  const storageKey = 'projects/demo/shots/sq010/sh0100/v01/42/sequence.json';

  it('stores the frames under a prefix next to the manifest', () => {
    expect(sequenceFramePrefix(storageKey)).toBe('projects/demo/shots/sq010/sh0100/v01/42/frames/');
    expect(sequenceManifestKey('projects/demo/shots/sq010/sh0100/v01/42/plan.exr')).toBe(storageKey);
  });

  it('composes the key of a frame from the delivered name', () => {
    expect(sequenceFrameKey(sequenceFramePrefix(storageKey), 'plan.1001.exr')).toBe(
      'projects/demo/shots/sq010/sh0100/v01/42/frames/plan.1001.exr',
    );
  });
});

describe('FFmpeg assembly', () => {
  it('renumbers locally so that the demuxer does not stop at the first gap', () => {
    expect(localFrameName(0, '.exr')).toBe('f_000000.exr');
    expect(localFrameName(1234, '.exr')).toBe('f_001234.exr');
    expect(localFramePattern('.exr')).toBe('f_%06d.exr');
  });

  it('writes NTSC rates as an exact fraction, never as 23.98', () => {
    expect(ffmpegFrameRate(23.976)).toBe('24000/1001');
    expect(ffmpegFrameRate(23.98)).toBe('24000/1001');
    expect(ffmpegFrameRate(29.97)).toBe('30000/1001');
    expect(ffmpegFrameRate(24)).toBe('24');
    expect(ffmpegFrameRate(25)).toBe('25');
  });

  it('applies the sRGB curve to the EXR — without it, a correct render comes out almost black', () => {
    expect(sequenceInputOptions(24, '.exr')).toEqual([
      '-framerate',
      '24',
      '-start_number',
      '0',
      '-apply_trc',
      'iec61966_2_1',
    ]);
  });

  it('sets no curve on a format whose option it does not know', () => {
    expect(sequenceInputOptions(25, '.dpx')).toEqual(['-framerate', '25', '-start_number', '0']);
  });
});
