// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { detectSequences, parseFrameName } from './imageSequence';

/**
 * What the upload queue sees of a drop.
 *
 * Without this reading, dropping a shot creates a thousand media. The cases below are those that
 * really come from a file explorer: a complete shot, two shots mixed together,
 * a numbering with gaps, and the odds and ends (notes, reference QuickTime) that
 * always accompany a delivery.
 */

const file = (name: string, size = 1024): File => ({ name, size }) as unknown as File;

const plan = (base: string, from: number, to: number, ext = '.exr', size = 1024): File[] =>
  Array.from({ length: to - from + 1 }, (_, i) =>
    file(`${base}${String(from + i).padStart(4, '0')}${ext}`, size),
  );

describe('parseFrameName', () => {
  it('takes the last number, not the version number', () => {
    expect(parseFrameName('SH0100_comp_v003.1001.exr')).toEqual({
      base: 'SH0100_comp_v003.',
      number: 1001,
      digits: 4,
      extension: '.exr',
    });
  });

  it('returns null for a name without numbering', () => {
    expect(parseFrameName('planche-contact.jpg')).toBeNull();
  });
});

describe('detectSequences', () => {
  it('recognizes a complete shot and returns it ready to send', () => {
    const { sequences, singles } = detectSequences(plan('SH0100_comp_v003.', 1001, 1200, '.exr', 2048));
    expect(singles).toEqual([]);
    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toMatchObject({
      pattern: 'SH0100_comp_v003.%04d.exr',
      startFrame: 1001,
      endFrame: 1200,
      frameCount: 200,
      missingFrames: 0,
      totalSize: 200 * 2048,
    });
  });

  it('separates two shots dropped together and sets aside the rest of the delivery', () => {
    const { sequences, singles } = detectSequences([
      ...plan('SH0100_comp_v003.', 1001, 1010),
      ...plan('SH0200_comp_v001.', 1001, 1010),
      file('notes.txt'),
      file('SH0100_comp_v003.mov'),
    ]);
    expect(sequences.map((s) => s.pattern)).toEqual([
      'SH0100_comp_v003.%04d.exr',
      'SH0200_comp_v001.%04d.exr',
    ]);
    expect(singles.map((s) => s.name).sort()).toEqual(['SH0100_comp_v003.mov', 'notes.txt']);
  });

  it('counts the gaps without refusing the delivery', () => {
    const { sequences } = detectSequences([
      file('plan.1001.exr'),
      file('plan.1002.exr'),
      file('plan.1010.exr'),
    ]);
    expect(sequences[0]).toMatchObject({ startFrame: 1001, endFrame: 1010, frameCount: 3, missingFrames: 7 });
  });

  it('sorts the files by number, whatever the file system order', () => {
    const { sequences } = detectSequences([
      file('plan.0100.exr'),
      file('plan.0002.exr'),
      file('plan.0010.exr'),
    ]);
    expect(sequences[0].files.map((f) => f.name)).toEqual([
      'plan.0002.exr',
      'plan.0010.exr',
      'plan.0100.exr',
    ]);
  });

  it('does not propose a sequence for a single file', () => {
    const { sequences, singles } = detectSequences([file('plan.1001.exr')]);
    expect(sequences).toEqual([]);
    expect(singles).toHaveLength(1);
  });

  it('does not group formats that ingestion would then refuse', () => {
    const { sequences, singles } = detectSequences(plan('take.', 1, 5, '.mov'));
    expect(sequences).toEqual([]);
    expect(singles).toHaveLength(5);
  });

  it('does not mix two paddings under the same pattern', () => {
    const { sequences } = detectSequences([
      file('plan.001.exr'),
      file('plan.002.exr'),
      file('plan.0001.exr'),
      file('plan.0002.exr'),
    ]);
    expect(sequences.map((s) => s.pattern)).toEqual(['plan.%03d.exr', 'plan.%04d.exr']);
  });
});
