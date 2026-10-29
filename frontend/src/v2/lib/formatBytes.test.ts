// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { formatBytes } from './formatBytes';

/**
 * A 4K EXR sequence adds up to tens of gigabytes: the figure must be right
 * (base 1024, like the file explorer and the MinIO console) and readable in the
 * reader's language. The formatters already present in the application write "Mo" in
 * hard-coded form, which a Japanese reader cannot read.
 */

describe('formatBytes', () => {
  it('chooses the unit by order of magnitude, in base 1024', () => {
    expect(formatBytes(512)).toMatch(/512/);
    expect(formatBytes(1024)).toMatch(/^1[^0-9]/);
    expect(formatBytes(1024 ** 3 * 12.5)).toMatch(/12[.,]5/);
  });

  it('shows no decimal for bytes', () => {
    expect(formatBytes(999)).not.toMatch(/[.,]/);
  });

  it('handles zero, negative and infinity without producing "NaN"', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatBytes(value)).toMatch(/0/);
    }
  });

  it('stays capped at the terabyte rather than inventing a unit', () => {
    expect(formatBytes(1024 ** 6)).toMatch(/TB|To|TO/i);
  });
});
