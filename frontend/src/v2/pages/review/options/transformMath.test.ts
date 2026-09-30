// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { eulerDegToQuat, quatToEulerDeg, type EulerDeg } from './transformMath';

const roundtrip = (e: EulerDeg) => quatToEulerDeg(eulerDegToQuat(e));

describe('euler° ↔ quaternion (XYZ, conventions three.js)', () => {
  it('identité et axes simples', () => {
    expect(eulerDegToQuat([0, 0, 0])).toEqual([0, 0, 0, 1]);
    const [x, , , w] = eulerDegToQuat([90, 0, 0]);
    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(w).toBeCloseTo(Math.SQRT1_2);
  });

  it('aller-retour stable sur des angles composés', () => {
    for (const e of [
      [30, 45, 60],
      [-120, 10, 5],
      [0, -80, 170],
    ] as EulerDeg[]) {
      const back = roundtrip(e);
      expect(back[0]).toBeCloseTo(e[0], 5);
      expect(back[1]).toBeCloseTo(e[1], 5);
      expect(back[2]).toBeCloseTo(e[2], 5);
    }
  });

  it('gimbal lock (pitch ±90°) : conversion sans NaN', () => {
    const back = roundtrip([25, 90, 0]);
    expect(back.every(Number.isFinite)).toBe(true);
    expect(back[1]).toBeCloseTo(90, 3);
    // La décomposition n'est pas unique en gimbal : on vérifie l'équivalence par re-conversion.
    const q1 = eulerDegToQuat([25, 90, 0]);
    const q2 = eulerDegToQuat(back);
    const dot = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
    expect(Math.abs(dot)).toBeCloseTo(1, 5);
  });
});
