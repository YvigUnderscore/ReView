// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SplatCameraKeyframe } from '../reviewTypes';
import { buildCameraGltf } from './exportCameraGltf';

const kf: SplatCameraKeyframe[] = [
  { t: 0, pose: { position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 }, fov: 50 }, easing: 'linear' },
  { t: 2000, pose: { position: { x: 5, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, easing: 'linear' },
];

describe('buildCameraGltf — export animation caméra → glTF', () => {
  const g = buildCameraGltf(THREE, kf) as {
    accessors: Array<{ count: number; type: string; min?: number[]; max?: number[] }>;
    animations: Array<{ channels: unknown[]; samplers: unknown[] }>;
    cameras: Array<{ perspective: { yfov: number } }>;
    buffers: Array<{ uri: string; byteLength: number }>;
    nodes: Array<{ camera: number }>;
  };

  it('structure glTF 2.0 : caméra animée en translation + rotation', () => {
    expect(g.nodes[0].camera).toBe(0);
    expect(g.animations[0].channels).toHaveLength(2); // translation + rotation
    expect(g.accessors[0].count).toBe(2); // 2 keyframes
    expect(g.accessors[0].type).toBe('SCALAR'); // temps
    expect(g.accessors[1].type).toBe('VEC3'); // translations
    expect(g.accessors[2].type).toBe('VEC4'); // rotations (quaternions)
  });

  it('temps en secondes avec min/max', () => {
    expect(g.accessors[0].min).toEqual([0]);
    expect(g.accessors[0].max).toEqual([2]); // 2000 ms → 2 s
  });

  it('yfov dérivé du fov de la 1re keyframe (radians)', () => {
    expect(g.cameras[0].perspective.yfov).toBeCloseTo((50 * Math.PI) / 180);
  });

  it('buffer binaire embarqué en data-URI base64, taille cohérente', () => {
    expect(g.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    // 2 kf : temps 2*4 + trans 2*12 + rot 2*16 = 8+24+32 = 64 octets
    expect(g.buffers[0].byteLength).toBe(64);
  });
});
