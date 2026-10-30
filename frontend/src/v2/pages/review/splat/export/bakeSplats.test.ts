// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SdfVolumeData, SplatTransform } from '../../reviewTypes';
import { bakeSplats, type ForEachSplat } from './bakeSplats';

/** Raw "source" splat (local space) to build a test iterator. */
interface RawSplat {
  center: [number, number, number];
  scales: [number, number, number];
  quaternion: [number, number, number, number];
  opacity: number;
  color: [number, number, number];
}

const splat = (over: Partial<RawSplat> = {}): RawSplat => ({
  center: [0, 0, 0],
  scales: [1, 1, 1],
  quaternion: [0, 0, 0, 1],
  opacity: 1,
  color: [0.5, 0.5, 0.5],
  ...over,
});

/** Iterator modelled on `PackedSplats.forEachSplat`, built from a raw list. */
const forEachOf =
  (raws: RawSplat[]): ForEachSplat =>
  (cb) =>
    raws.forEach((r, i) =>
      cb(
        i,
        new THREE.Vector3().fromArray(r.center),
        new THREE.Vector3().fromArray(r.scales),
        new THREE.Quaternion().fromArray(r.quaternion),
        r.opacity,
        new THREE.Color(r.color[0], r.color[1], r.color[2]),
      ),
    );

const noEdits = { transform: null as SplatTransform | null, volumes: [] as SdfVolumeData[] };

describe('bakeSplats', () => {
  it('copies unchanged when there is no edit', () => {
    const raws = [splat({ center: [1, 2, 3], color: [0.1, 0.2, 0.3] }), splat({ center: [-1, 0, 0] })];
    const out = bakeSplats(THREE, forEachOf(raws), noEdits);
    expect(out).toHaveLength(2);
    expect(out[0].center).toEqual([1, 2, 3]);
    expect(out[0].color).toEqual([0.1, 0.2, 0.3]);
  });

  it('excludes masked splats (opacity ≤ threshold)', () => {
    const raws = [splat({ opacity: 0 }), splat({ center: [5, 0, 0], opacity: 1 }), splat({ opacity: 0.0 })];
    const out = bakeSplats(THREE, forEachOf(raws), noEdits);
    expect(out).toHaveLength(1);
    expect(out[0].center).toEqual([5, 0, 0]);
  });

  it('respects a custom opacity threshold', () => {
    const raws = [splat({ opacity: 0.05 }), splat({ center: [1, 0, 0], opacity: 0.5 })];
    const out = bakeSplats(THREE, forEachOf(raws), { ...noEdits, opacityEpsilon: 0.1 });
    expect(out).toHaveLength(1);
    expect(out[0].center).toEqual([1, 0, 0]);
  });

  it('removes splats carved by a "carve" volume (delete)', () => {
    // Unit delete box centred at the origin: hides the interior |x,y,z| ≤ 1.
    const volumes: SdfVolumeData[] = [
      { shape: 'box', mode: 'delete', position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    ];
    const raws = [splat({ center: [0, 0, 0] }), splat({ center: [2, 0, 0] })];
    const out = bakeSplats(THREE, forEachOf(raws), { transform: null, volumes });
    expect(out).toHaveLength(1);
    expect(out[0].center).toEqual([2, 0, 0]);
  });

  it('keeps only the inside of an "isolate" volume (isolate)', () => {
    const volumes: SdfVolumeData[] = [
      { shape: 'sphere', mode: 'isolate', position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
    ];
    const raws = [splat({ center: [0.5, 0, 0] }), splat({ center: [3, 0, 0] })];
    const out = bakeSplats(THREE, forEachOf(raws), { transform: null, volumes });
    expect(out).toHaveLength(1);
    expect(out[0].center).toEqual([0.5, 0, 0]);
  });

  it('bakes a translation into the centre', () => {
    const transform: SplatTransform = { position: [10, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
    const out = bakeSplats(THREE, forEachOf([splat({ center: [1, 2, 3] })]), { transform, volumes: [] });
    expect(out[0].center[0]).toBeCloseTo(11, 6);
    expect(out[0].center[1]).toBeCloseTo(2, 6);
    expect(out[0].center[2]).toBeCloseTo(3, 6);
  });

  it('bakes a uniform scale into the centre and the sizes', () => {
    const transform: SplatTransform = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] };
    const out = bakeSplats(THREE, forEachOf([splat({ center: [1, 0, 0], scales: [0.5, 0.5, 0.5] })]), {
      transform,
      volumes: [],
    });
    expect(out[0].center[0]).toBeCloseTo(2, 6);
    expect(out[0].scales).toEqual([1, 1, 1]);
  });

  it('bakes a 90° rotation about Y into the centre and the orientation', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const transform: SplatTransform = {
      position: [0, 0, 0],
      quaternion: [q.x, q.y, q.z, q.w],
      scale: [1, 1, 1],
    };
    const out = bakeSplats(THREE, forEachOf([splat({ center: [1, 0, 0] })]), { transform, volumes: [] });
    // (1,0,0) rotated by +90° about Y → (0,0,-1).
    expect(out[0].center[0]).toBeCloseTo(0, 5);
    expect(out[0].center[2]).toBeCloseTo(-1, 5);
    const baked = new THREE.Quaternion().fromArray(out[0].quaternion);
    expect(Math.abs(baked.angleTo(q))).toBeLessThan(1e-5);
  });
});
