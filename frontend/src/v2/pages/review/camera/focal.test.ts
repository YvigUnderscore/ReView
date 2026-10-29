// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fovToFocal, focalToFov, SENSOR_MM } from './focal';

describe('focal — FOV ↔ mm conversion (36 mm sensor, Phase 26)', () => {
  it('round-trip mm → fov → mm', () => {
    for (const mm of [12, 24, 35, 50, 85, 200]) {
      expect(fovToFocal(focalToFov(mm))).toBeCloseTo(mm, 6);
    }
  });

  it('reference values: 36 mm ↔ 53.13°, 18 mm ↔ 90°', () => {
    expect(focalToFov(18)).toBeCloseTo(90);
    expect(fovToFocal(90)).toBeCloseTo(18);
    expect(focalToFov(SENSOR_MM)).toBeCloseTo(53.13, 1);
  });

  it('clamps degenerate inputs (no division by ~0)', () => {
    expect(fovToFocal(0)).toBeGreaterThan(0);
    expect(Number.isFinite(fovToFocal(180))).toBe(true);
    expect(focalToFov(0)).toBeLessThanOrEqual(focalToFov(1));
  });
});
