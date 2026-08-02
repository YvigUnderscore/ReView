// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { abcDocToAnim } from './importCameraAbc';

describe('importCameraAbc.abcDocToAnim — Alembic (échantillons) → animation v2 (40.D)', () => {
  it('convertit des échantillons à cible explicite en canaux (temps en ms)', () => {
    const anim = abcDocToAnim(THREE, {
      fps: 25,
      samples: [
        { frame: 0, pos: [0, 0, 5], target: [0, 0, 0], fov: 30 },
        { frame: 25, pos: [5, 0, 0], target: [0, 0, 0], fov: 30 },
      ],
    });
    expect(anim).not.toBeNull();
    // frame 25 @ 25 fps = 1 s = 1000 ms.
    expect(anim!.channels.pz!.keys.map((k) => k.t)).toEqual([0, 1000]);
    expect(anim!.channels.pz!.keys[0].v).toBe(5);
    expect(anim!.channels.px!.keys[1].v).toBe(5);
    // La cible (0,0,0) alimente tx/ty/tz ; fov constant → canal fov.
    expect(anim!.channels.tx!.keys.every((k) => k.v === 0)).toBe(true);
    expect(anim!.channels.fov!.keys[0].v).toBe(30);
    // Échantillons denses → interpolation linéaire.
    expect(anim!.channels.px!.keys[0].mode).toBe('linear');
  });

  it('dérive la cible du quaternion (regard -Z) quand aucune cible n’est fournie', () => {
    const anim = abcDocToAnim(THREE, {
      samples: [
        { t: 0, pos: [0, 0, 0], quat: [0, 0, 0, 1] },
        { t: 1, pos: [0, 0, 0], quat: [0, 0, 0, 1] },
      ],
    });
    expect(anim).not.toBeNull();
    // Identité → regard -Z → cible (0,0,-1).
    expect(anim!.channels.tz!.keys[0].v).toBeCloseTo(-1);
  });

  it('retourne null en dessous de 2 échantillons exploitables', () => {
    expect(abcDocToAnim(THREE, { samples: [] })).toBeNull();
    expect(abcDocToAnim(THREE, { samples: [{ t: 0, pos: [0, 0, 0], target: [0, 0, 1] }] })).toBeNull();
  });
});
