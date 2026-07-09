import { describe, expect, it } from 'vitest';
import { collectBrushHits, depthBand } from './surfaceBrush';

// Matrice clip : x/y passent tels quels, w = z (profondeur vue), cz forcé à 0 (dans le frustum).
const DEPTH_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0];
const VIEWPORT = { width: 100, height: 100 };
const NONE = () => false;

describe('collectBrushHits', () => {
  it('prend les splats de surface (bande de profondeur) et ignore les traversés derrière', () => {
    // 3 splats alignés au centre écran : z=1 (surface), z=1.2 (dans la bande), z=3 (derrière).
    // x/y multipliés par w à la projection → x=0 reste au centre quel que soit z.
    const centers = new Float32Array([0, 0, 1, 0, 0, 1.2, 0, 0, 3]);
    const hits = collectBrushHits(
      DEPTH_MATRIX,
      centers,
      NONE,
      VIEWPORT,
      { x: 50, y: 50, radiusPx: 10 },
      { viewZ: 1, halfDepth: 0.3 },
    );
    expect(hits).toEqual([0, 1]);
  });

  it('respecte le disque écran du pinceau et le filtre des masqués', () => {
    // z=1 partout → écran : (50,50) et (75,50) — pinceau r=10 en (50,50) ne prend que le 1ᵉʳ.
    const centers = new Float32Array([0, 0, 1, 0.5, 0, 1]);
    const brush = { x: 50, y: 50, radiusPx: 10 };
    const band = { viewZ: 1, halfDepth: 0.5 };
    expect(collectBrushHits(DEPTH_MATRIX, centers, NONE, VIEWPORT, brush, band)).toEqual([0]);
    expect(collectBrushHits(DEPTH_MATRIX, centers, (i) => i === 0, VIEWPORT, brush, band)).toEqual([]);
    // Rayon élargi : les deux.
    expect(collectBrushHits(DEPTH_MATRIX, centers, NONE, VIEWPORT, { ...brush, radiusPx: 30 }, band)).toEqual(
      [0, 1],
    );
  });

  it('exclut les centres derrière la caméra (w ≤ 0)', () => {
    const centers = new Float32Array([0, 0, -1]);
    expect(
      collectBrushHits(
        DEPTH_MATRIX,
        centers,
        NONE,
        VIEWPORT,
        { x: 50, y: 50, radiusPx: 50 },
        { viewZ: 1, halfDepth: 5 },
      ),
    ).toEqual([]);
  });
});

describe('depthBand', () => {
  it('croît avec la profondeur et le rayon (empreinte du pinceau sur la surface)', () => {
    const near = depthBand(1, 40, 60, 900);
    const far = depthBand(10, 40, 60, 900);
    const bigBrush = depthBand(1, 120, 60, 900);
    expect(far).toBeCloseTo(near * 10);
    expect(bigBrush).toBeCloseTo(near * 3);
    expect(near).toBeGreaterThan(0);
  });
});
