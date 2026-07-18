import { describe, expect, it } from 'vitest';
import { spriteIndexAt, spriteSlotCss, type TimelineSpriteMeta } from './timelineSprite';

const meta: TimelineSpriteMeta = { intervalSec: 3, count: 20, cols: 10, rows: 2, tileW: 160, tileH: 90 };

describe('spriteIndexAt', () => {
  it('mappe le temps sur la vignette, borné au sprite', () => {
    expect(spriteIndexAt(0, meta)).toBe(0);
    expect(spriteIndexAt(3.5, meta)).toBe(1);
    expect(spriteIndexAt(59, meta)).toBe(19);
    expect(spriteIndexAt(9999, meta)).toBe(19);
    expect(spriteIndexAt(-2, meta)).toBe(0);
  });
});

describe('spriteSlotCss', () => {
  it('positionne la bonne tuile à l’échelle demandée', () => {
    // displayH 45 → scale 0.5 ; index 12 → col 2, row 1.
    const css = spriteSlotCss(12, meta, 45);
    expect(css.backgroundSize).toBe('800px 90px');
    expect(css.backgroundPosition).toBe('-160px -45px');
  });
});
