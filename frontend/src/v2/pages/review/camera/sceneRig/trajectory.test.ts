// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sampleTrajectory, trajSignature } from './trajectory';
import { emptyAnim, upsertKey, type CameraAnimV2 } from '../channels/model';
import type { SplatCamera } from '../../reviewTypes';

const BASE: SplatCamera = { position: { x: 0, y: 7, z: 0 }, target: { x: 0, y: 0, z: 0 } };

/** Two keys on `px`: the minimum for a playable trajectory. */
function line(): CameraAnimV2 {
  let a = emptyAnim(false);
  a = upsertKey(a, 'px', 0, 0);
  a = upsertKey(a, 'px', 1000, 10);
  return a;
}

describe('trajSignature', () => {
  it('changes when a key moves on a channel other than px (the polyline used to go stale)', () => {
    const a = line();
    const before = trajSignature(a);
    for (const id of ['py', 'pz', 'tx', 'ty', 'tz', 'fov', 'roll'] as const) {
      expect(trajSignature(upsertKey(a, id, 500, 3))).not.toBe(before);
    }
  });

  it('changes when a px key changes value or time', () => {
    const a = line();
    expect(trajSignature(upsertKey(a, 'px', 1000, 11))).not.toBe(trajSignature(a));
    expect(trajSignature(upsertKey(a, 'px', 1200, 10))).not.toBe(trajSignature(a));
  });

  it('changes when the playback duration or the loop changes', () => {
    const a = line();
    expect(trajSignature({ ...a, durationMs: 4000 })).not.toBe(trajSignature(a));
    expect(trajSignature({ ...a, loop: true })).not.toBe(trajSignature(a));
  });

  it('does not change for an identical animation (no needless recomputation)', () => {
    expect(trajSignature(line())).toBe(trajSignature(line()));
  });
});

describe('sampleTrajectory', () => {
  it('draws nothing before two key times', () => {
    expect(sampleTrajectory(emptyAnim(), BASE)).toEqual([]);
    expect(sampleTrajectory(upsertKey(emptyAnim(), 'px', 0, 1), BASE)).toEqual([]);
  });

  it('samples from 0 to the playback duration', () => {
    const pts = sampleTrajectory(line(), BASE);
    expect(pts).toHaveLength(65);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[64].x).toBeCloseTo(10, 6);
  });

  it('follows the fallback pose for channels without keys (the origin used to be forced)', () => {
    const pts = sampleTrajectory(line(), BASE);
    for (const p of pts) expect(p.y).toBeCloseTo(7, 6);
  });

  it('follows the set playback duration, not just the last key time', () => {
    const pts = sampleTrajectory({ ...line(), durationMs: 2000 }, BASE);
    // Beyond the last key, the value is held: the second half stays at 10.
    expect(pts[32].x).toBeCloseTo(10, 6);
  });
});
