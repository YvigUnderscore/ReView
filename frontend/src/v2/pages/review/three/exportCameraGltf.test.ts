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

describe('buildCameraGltf — camera animation → glTF export', () => {
  const g = buildCameraGltf(THREE, kf) as {
    accessors: Array<{ count: number; type: string; min?: number[]; max?: number[] }>;
    animations: Array<{ channels: unknown[]; samplers: unknown[] }>;
    cameras: Array<{ perspective: { yfov: number } }>;
    buffers: Array<{ uri: string; byteLength: number }>;
    nodes: Array<{ camera: number }>;
  };

  it('glTF 2.0 structure: camera animated in translation and rotation', () => {
    expect(g.nodes[0].camera).toBe(0);
    expect(g.animations[0].channels).toHaveLength(2); // translation + rotation
    expect(g.accessors[0].count).toBe(2); // 2 keyframes
    expect(g.accessors[0].type).toBe('SCALAR'); // time
    expect(g.accessors[1].type).toBe('VEC3'); // translations
    expect(g.accessors[2].type).toBe('VEC4'); // rotations (quaternions)
  });

  it('time in seconds with min/max', () => {
    expect(g.accessors[0].min).toEqual([0]);
    expect(g.accessors[0].max).toEqual([2]); // 2000 ms → 2 s
  });

  it('yfov derived from the fov of the 1st keyframe (radians)', () => {
    expect(g.cameras[0].perspective.yfov).toBeCloseTo((50 * Math.PI) / 180);
  });

  it('embedded binary buffer as a base64 data URI, consistent size', () => {
    expect(g.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    // 2 kf: time 2*4 + trans 2*12 + rot 2*16 = 8+24+32 = 64 bytes
    expect(g.buffers[0].byteLength).toBe(64);
  });
});
