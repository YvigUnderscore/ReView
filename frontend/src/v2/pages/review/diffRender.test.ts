// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DIFF_GAINS, HEATMAP_CSS_FILTER, diffFilter, nextGain } from './diffRender';

describe('diffRender — A/B difference mode (34.E)', () => {
  it('diffFilter: ctx.filter amplification; the heatmap LUT goes through a CSS filter', () => {
    expect(diffFilter(4)).toBe('brightness(4)');
    // Chrome ignores url(#…) in ctx.filter: the LUT is a CSS filter on the canvas element.
    expect(HEATMAP_CSS_FILTER).toBe('url(#diff-heatmap-lut)');
  });

  it('nextGain cycles through the proposed gains and falls back to ×1', () => {
    expect(nextGain(1)).toBe(2);
    expect(nextGain(2)).toBe(4);
    expect(nextGain(16)).toBe(1);
  });

  it('nextGain from an unknown value restarts at the beginning of the cycle', () => {
    expect(DIFF_GAINS).toContain(nextGain(7));
    expect(nextGain(7)).toBe(1);
  });
});
