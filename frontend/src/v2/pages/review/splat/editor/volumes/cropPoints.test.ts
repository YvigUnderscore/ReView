// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SdfVolumeData } from '../../../reviewTypes';
import { buildCropChecks, pointCropped } from './cropPoints';

const vol = (over: Partial<SdfVolumeData>): SdfVolumeData => ({
  shape: 'box',
  mode: 'delete',
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
  ...over,
});

describe('pointCropped — crop volume semantics', () => {
  it('"carve" hides the inside of the box (half-extents = scale)', () => {
    const checks = buildCropChecks(THREE, [vol({ scale: [2, 1, 1] })]);
    expect(pointCropped(1.5, 0, 0, checks)).toBe(true); // inside the box, widened in x
    expect(pointCropped(0, 1.5, 0, checks)).toBe(false); // outside the box in y
  });

  it('"isolate" hides everything outside the volume', () => {
    const checks = buildCropChecks(THREE, [vol({ mode: 'isolate' })]);
    expect(pointCropped(0.5, 0, 0, checks)).toBe(false);
    expect(pointCropped(3, 0, 0, checks)).toBe(true);
  });

  it('ellipsoid: half-axes = scale (offset position)', () => {
    const checks = buildCropChecks(THREE, [vol({ shape: 'sphere', position: [5, 0, 0], scale: [2, 1, 1] })]);
    expect(pointCropped(6.5, 0, 0, checks)).toBe(true); // 1.5 from the centre along half-axis 2
    expect(pointCropped(5, 0.5, 0, checks)).toBe(true);
    expect(pointCropped(5, 1.5, 0, checks)).toBe(false); // outside half-axis 1 in y
  });

  it('rotation: the box turns with its quaternion', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
    const checks = buildCropChecks(THREE, [vol({ scale: [2, 0.1, 0.1], quaternion: q.toArray() })]);
    // The thin box is rotated 45° in the XY plane: the diagonal is inside, the X axis is not.
    expect(pointCropped(1, 1, 0, checks)).toBe(true);
    expect(pointCropped(1.5, 0, 0, checks)).toBe(false);
  });

  it('several isolating volumes: only the intersection stays visible', () => {
    const checks = buildCropChecks(THREE, [
      vol({ mode: 'isolate', position: [0.5, 0, 0] }),
      vol({ mode: 'isolate', position: [-0.5, 0, 0] }),
    ]);
    expect(pointCropped(0, 0, 0, checks)).toBe(false); // inside both
    expect(pointCropped(1.2, 0, 0, checks)).toBe(true); // outside the second
  });

  it('no volume: nothing is hidden', () => {
    expect(pointCropped(0, 0, 0, [])).toBe(false);
  });
});
