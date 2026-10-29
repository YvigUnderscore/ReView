// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyEulerTransform } from './applyTransform';

describe('applyEulerTransform — user transform of the model (V2)', () => {
  it('converts degrees to radians (yaw=Y, pitch=X, roll=Z) and sets the uniform scale', () => {
    const root = new THREE.Group();
    applyEulerTransform(root, { yaw: 90, pitch: 45, roll: -30, scale: 2 });
    expect(root.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(root.rotation.x).toBeCloseTo(Math.PI / 4);
    expect(root.rotation.z).toBeCloseTo((-30 * Math.PI) / 180);
    expect(root.scale.x).toBe(2);
    expect(root.scale.y).toBe(2);
    expect(root.scale.z).toBe(2);
  });

  it('identity transform: no rotation, scale 1', () => {
    const root = new THREE.Group();
    applyEulerTransform(root, { yaw: 0, pitch: 0, roll: 0, scale: 1 });
    expect(root.rotation.x).toBe(0);
    expect(root.rotation.y).toBe(0);
    expect(root.rotation.z).toBe(0);
    expect(root.scale.x).toBe(1);
  });
});
