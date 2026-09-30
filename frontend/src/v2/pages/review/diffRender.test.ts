// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { DIFF_GAINS, HEATMAP_CSS_FILTER, diffFilter, nextGain } from './diffRender';

describe('diffRender — mode différence A/B (34.E)', () => {
  it('diffFilter : amplification ctx.filter ; la LUT heatmap passe par un filtre CSS', () => {
    expect(diffFilter(4)).toBe('brightness(4)');
    // Chrome ignore url(#…) dans ctx.filter : la LUT est un filtre CSS sur l'élément canvas.
    expect(HEATMAP_CSS_FILTER).toBe('url(#diff-heatmap-lut)');
  });

  it('nextGain cycle sur les gains proposés et retombe sur ×1', () => {
    expect(nextGain(1)).toBe(2);
    expect(nextGain(2)).toBe(4);
    expect(nextGain(16)).toBe(1);
  });

  it('nextGain depuis une valeur inconnue repart au début du cycle', () => {
    expect(DIFF_GAINS).toContain(nextGain(7));
    expect(nextGain(7)).toBe(1);
  });
});
