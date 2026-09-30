// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { eulerTransformFromMesh } from './modelGizmoTransform';

describe('eulerTransformFromMesh', () => {
  it('identité → rotations nulles, échelle 1', () => {
    const t = eulerTransformFromMesh({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] });
    expect(t.yaw).toBeCloseTo(0);
    expect(t.pitch).toBeCloseTo(0);
    expect(t.roll).toBeCloseTo(0);
    expect(t.scale).toBeCloseTo(1);
  });

  it('quaternion de 90° autour de Y → yaw 90', () => {
    const s = Math.SQRT1_2; // sin/cos(45°)
    const t = eulerTransformFromMesh({ position: [0, 0, 0], quaternion: [0, s, 0, s], scale: [2, 2, 2] });
    expect(t.yaw).toBeCloseTo(90);
    expect(t.scale).toBeCloseTo(2);
  });

  it('échelle non-uniforme → moyenne, bornée à > 0', () => {
    const t = eulerTransformFromMesh({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 2, 3] });
    expect(t.scale).toBeCloseTo(2);
    const z = eulerTransformFromMesh({ position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [0, 0, 0] });
    expect(z.scale).toBeGreaterThan(0);
  });
});
