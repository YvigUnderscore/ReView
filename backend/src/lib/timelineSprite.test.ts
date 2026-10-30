// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { planTimelineSprite } from './timelineSprite';

describe('planTimelineSprite', () => {
  it('short video: one thumbnail every 3 s', () => {
    const p = planTimelineSprite(30, 1920, 1080);
    expect(p).toMatchObject({ intervalSec: 3, count: 10, cols: 10, rows: 1, tileW: 160, tileH: 90 });
  });

  it('multi-row grid and 16:9 thumbnail by default', () => {
    const p = planTimelineSprite(100, undefined, undefined)!;
    expect(p.count).toBe(34);
    expect(p.cols).toBe(10);
    expect(p.rows).toBe(4);
    expect(p.tileH).toBe(90); // 16:9 ratio by default
  });

  it('very long video: interval stretched, sprite capped at 240 thumbnails', () => {
    const p = planTimelineSprite(3600, 1920, 1080)!;
    expect(p.count).toBeLessThanOrEqual(240);
    expect(p.intervalSec).toBeGreaterThan(3);
  });

  it('portrait ratio: even, proportional thumbnail height', () => {
    const p = planTimelineSprite(10, 1080, 1920)!;
    expect(p.tileH % 2).toBe(0);
    expect(p.tileH).toBeCloseTo(160 * (1920 / 1080), -1);
  });

  it('unknown duration → null', () => {
    expect(planTimelineSprite(undefined, 1920, 1080)).toBeNull();
    expect(planTimelineSprite(0, 1920, 1080)).toBeNull();
  });
});
