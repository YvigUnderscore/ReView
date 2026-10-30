// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { abcDocToAnim } from './importCameraAbc';

describe('importCameraAbc.abcDocToAnim — Alembic (samples) → animation v2 (40.D)', () => {
  it('converts samples with an explicit target into channels (time in ms)', () => {
    const anim = abcDocToAnim(THREE, {
      fps: 25,
      samples: [
        { frame: 0, pos: [0, 0, 5], target: [0, 0, 0], fov: 30 },
        { frame: 25, pos: [5, 0, 0], target: [0, 0, 0], fov: 30 },
      ],
    });
    expect(anim).not.toBeNull();
    // frame 25 at 25 fps = 1 s = 1000 ms.
    expect(anim!.channels.pz!.keys.map((k) => k.t)).toEqual([0, 1000]);
    expect(anim!.channels.pz!.keys[0].v).toBe(5);
    expect(anim!.channels.px!.keys[1].v).toBe(5);
    // The target (0,0,0) feeds tx/ty/tz; constant fov → fov channel.
    expect(anim!.channels.tx!.keys.every((k) => k.v === 0)).toBe(true);
    expect(anim!.channels.fov!.keys[0].v).toBe(30);
    // Dense samples → linear interpolation.
    expect(anim!.channels.px!.keys[0].mode).toBe('linear');
  });

  it('derives the target from the quaternion (looking along -Z) when no target is supplied', () => {
    const anim = abcDocToAnim(THREE, {
      samples: [
        { t: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1] },
        { t: 1, pos: [0, 0, 0], quat: [0, 0, 0, 1] },
      ],
    });
    expect(anim).not.toBeNull();
    // Identity → looking along -Z → target (0,0,-1).
    expect(anim!.channels.tz!.keys[0].v).toBeCloseTo(-1);
  });

  it('returns null below 2 usable samples', () => {
    expect(abcDocToAnim(THREE, { samples: [] })).toBeNull();
    expect(abcDocToAnim(THREE, { samples: [{ t: 0, pos: [0, 0, 0], target: [0, 0, 1] }] })).toBeNull();
  });
});
