// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { shouldLoopBack } from './videoPaneHooks';

describe('shouldLoopBack — I/O loop wrap (feedback 34)', () => {
  it('wraps during playback when the loop is active and O is reached', () => {
    expect(shouldLoopBack(1, 3, true, false, 3)).toBe(true);
    expect(shouldLoopBack(1, 3, true, false, 4.5)).toBe(true);
  });

  it('does not wrap before point O', () => {
    expect(shouldLoopBack(1, 3, true, false, 2.9)).toBe(false);
  });

  it('never wraps while paused: manual navigation freely passes O', () => {
    expect(shouldLoopBack(1, 3, true, true, 3.5)).toBe(false);
  });

  it('does not wrap when the loop is disabled (the I/O points stay set)', () => {
    expect(shouldLoopBack(1, 3, false, false, 3.5)).toBe(false);
  });

  it('ignores incomplete or inverted loops', () => {
    expect(shouldLoopBack(null, 3, true, false, 3.5)).toBe(false);
    expect(shouldLoopBack(1, null, true, false, 3.5)).toBe(false);
    expect(shouldLoopBack(3, 1, true, false, 3.5)).toBe(false);
  });
});
