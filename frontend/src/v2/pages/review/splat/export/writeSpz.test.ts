import { describe, expect, it } from 'vitest';
import { SpzReader } from '@sparkjsdev/spark';
import type { BakedSplat } from './bakeSplats';
import { writeSpz } from './writeSpz';

/**
 * Prouve la justesse de l'export SPZ (41.C) **sans WebGL** : on écrit des splats cuits avec le
 * `SpzWriter` de Spark, puis on les relit avec son `SpzReader` et on compare aux tolérances de
 * quantification du format. Si Spark relit ce qu'on a écrit, tout viewer (dont ReView) le fera.
 */

interface DecodedSplat {
  center: [number, number, number];
  alpha: number;
  rgb: [number, number, number];
  scale: [number, number, number];
  quat: [number, number, number, number];
}

async function readSpz(bytes: Uint8Array): Promise<DecodedSplat[]> {
  const reader = new SpzReader({ fileBytes: bytes });
  await reader.parseHeader();
  const out: DecodedSplat[] = Array.from({ length: reader.numSplats }, () => ({
    center: [0, 0, 0],
    alpha: 0,
    rgb: [0, 0, 0],
    scale: [1, 1, 1],
    quat: [0, 0, 0, 1],
  }));
  await reader.parseSplats(
    (i, x, y, z) => (out[i]!.center = [x, y, z]),
    (i, a) => (out[i]!.alpha = a),
    (i, r, g, b) => (out[i]!.rgb = [r, g, b]),
    (i, sx, sy, sz) => (out[i]!.scale = [sx, sy, sz]),
    (i, qx, qy, qz, qw) => (out[i]!.quat = [qx, qy, qz, qw]),
  );
  return out;
}

const baked = (over: Partial<BakedSplat> = {}): BakedSplat => ({
  center: [0, 0, 0],
  scales: [0.1, 0.1, 0.1],
  quaternion: [0, 0, 0, 1],
  opacity: 1,
  color: [0.5, 0.5, 0.5],
  ...over,
});

describe('writeSpz', () => {
  it('produit un conteneur gzip non vide', async () => {
    const bytes = await writeSpz([baked()]);
    expect(bytes.byteLength).toBeGreaterThan(2);
    expect(bytes[0]).toBe(0x1f); // magic gzip
    expect(bytes[1]).toBe(0x8b);
  });

  it('relit le bon nombre de splats et des centres fidèles', async () => {
    const splats = [
      baked({ center: [1, 2, 3] }),
      baked({ center: [-0.5, 0.25, 10] }),
      baked({ center: [0, 0, 0] }),
    ];
    const decoded = await readSpz(await writeSpz(splats));
    expect(decoded).toHaveLength(3);
    splats.forEach((s, i) => {
      expect(decoded[i]!.center[0]).toBeCloseTo(s.center[0], 2);
      expect(decoded[i]!.center[1]).toBeCloseTo(s.center[1], 2);
      expect(decoded[i]!.center[2]).toBeCloseTo(s.center[2], 2);
    });
  });

  it('conserve opacité, couleur et échelle aux tolérances de quantification', async () => {
    const splats = [
      baked({ opacity: 0.8, color: [0.9, 0.1, 0.4], scales: [0.05, 0.2, 0.5] }),
      baked({ opacity: 0.3, color: [0.2, 0.7, 0.6], scales: [0.1, 0.1, 0.1] }),
    ];
    const decoded = await readSpz(await writeSpz(splats));
    splats.forEach((s, i) => {
      expect(decoded[i]!.alpha).toBeCloseTo(s.opacity, 1);
      for (let k = 0; k < 3; k++) {
        expect(decoded[i]!.rgb[k]).toBeCloseTo(s.color[k]!, 1);
        // Échelle log-quantifiée : ~6,5 % par pas → tolérance relative généreuse.
        expect(decoded[i]!.scale[k]! / s.scales[k]!).toBeGreaterThan(0.85);
        expect(decoded[i]!.scale[k]! / s.scales[k]!).toBeLessThan(1.15);
      }
    });
  });

  it('conserve l’orientation (quaternion) après aller-retour', async () => {
    // Rotation quelconque normalisée.
    const raw = [0.2, -0.5, 0.3, 0.78];
    const n = Math.hypot(...raw);
    const q = raw.map((v) => v / n) as [number, number, number, number];
    const decoded = await readSpz(await writeSpz([baked({ quaternion: q })]));
    const d = decoded[0]!.quat;
    // |produit scalaire| ≈ 1 si les quaternions représentent la même rotation.
    const dot = Math.abs(q[0] * d[0] + q[1] * d[1] + q[2] * d[2] + q[3] * d[3]);
    expect(dot).toBeGreaterThan(0.99);
  });
});
