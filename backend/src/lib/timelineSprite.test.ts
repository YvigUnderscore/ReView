import { describe, expect, it } from 'vitest';
import { planTimelineSprite } from './timelineSprite';

describe('planTimelineSprite', () => {
  it('vidéo courte : une vignette toutes les 3 s', () => {
    const p = planTimelineSprite(30, 1920, 1080);
    expect(p).toMatchObject({ intervalSec: 3, count: 10, cols: 10, rows: 1, tileW: 160, tileH: 90 });
  });

  it('grille multi-lignes et vignette 16/9 par défaut', () => {
    const p = planTimelineSprite(100, undefined, undefined)!;
    expect(p.count).toBe(34);
    expect(p.cols).toBe(10);
    expect(p.rows).toBe(4);
    expect(p.tileH).toBe(90); // ratio 16/9 par défaut
  });

  it('vidéo très longue : intervalle étiré, sprite bornée à 240 vignettes', () => {
    const p = planTimelineSprite(3600, 1920, 1080)!;
    expect(p.count).toBeLessThanOrEqual(240);
    expect(p.intervalSec).toBeGreaterThan(3);
  });

  it('ratio vertical : hauteur de vignette paire et proportionnelle', () => {
    const p = planTimelineSprite(10, 1080, 1920)!;
    expect(p.tileH % 2).toBe(0);
    expect(p.tileH).toBeCloseTo(160 * (1920 / 1080), -1);
  });

  it('durée inconnue → null', () => {
    expect(planTimelineSprite(undefined, 1920, 1080)).toBeNull();
    expect(planTimelineSprite(0, 1920, 1080)).toBeNull();
  });
});
