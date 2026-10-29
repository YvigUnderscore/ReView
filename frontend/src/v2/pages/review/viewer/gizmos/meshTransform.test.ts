// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readMeshTransform, type TransformableMesh } from './meshTransform';

/** Checks the mesh → TRS mapping (position/quaternion/scale) driven by the gizmo. */
describe('readMeshTransform', () => {
  it('extracts position, quaternion and scale from the mesh', () => {
    const mesh: TransformableMesh = {
      position: { toArray: () => [1, 2, 3] },
      quaternion: { x: 0, y: 0.7071, z: 0, w: 0.7071 },
      scale: { toArray: () => [2, 2, 2] },
    };
    expect(readMeshTransform(mesh)).toEqual({
      position: [1, 2, 3],
      quaternion: [0, 0.7071, 0, 0.7071],
      scale: [2, 2, 2],
    });
  });

  it('reflects an identity transform', () => {
    const mesh: TransformableMesh = {
      position: { toArray: () => [0, 0, 0] },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { toArray: () => [1, 1, 1] },
    };
    expect(readMeshTransform(mesh)).toEqual({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
  });
});
