// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, mulQuat, pivotedPose, rotateVec, type Pose, type Quat } from './primPivot';

/** Quaternion of a 90° rotation around +Y. */
const Y90: Quat = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];

const base: Pose = { position: [10, 0, 0], quaternion: IDENTITY_QUAT, scale: [1, 1, 1] };
const closeTo = (got: readonly number[], want: readonly number[]) =>
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 6));

describe('rotateVec / mulQuat', () => {
  it('turns +X toward −Z for 90° around +Y', () => {
    closeTo(rotateVec(Y90, [1, 0, 0]), [0, 0, -1]);
  });

  it('composes two 90° rotations into a 180° one', () => {
    closeTo(rotateVec(mulQuat(Y90, Y90), [1, 0, 0]), [-1, 0, 0]);
  });
});

describe('pivotedPose (46.Q)', () => {
  it('identity delta → pose unchanged', () => {
    const pose = pivotedPose(base, [10, 0, 5], { t: [0, 0, 0], q: IDENTITY_QUAT, s: [1, 1, 1] });
    closeTo(pose.position, base.position);
    closeTo(pose.quaternion, base.quaternion);
    closeTo(pose.scale, base.scale);
  });

  it('a translation of the proxy translates the object as is', () => {
    const pose = pivotedPose(base, [10, 0, 5], { t: [1, 2, 3], q: IDENTITY_QUAT, s: [1, 1, 1] });
    closeTo(pose.position, [11, 2, 3]);
  });

  it('a rotation turns the object **around the pivot**, not around its origin', () => {
    // Object at (10,0,0), pivot at (10,0,5): the offset (0,0,−5) rotated 90° around +Y
    // becomes (−5,0,0) — the object orbits around the geometry center, as in a DCC.
    const pose = pivotedPose(base, [10, 0, 5], { t: [0, 0, 0], q: Y90, s: [1, 1, 1] });
    closeTo(pose.position, [5, 0, 5]);
    closeTo(pose.quaternion, Y90);
  });

  it('a scale stretches the distance to the pivot in addition to the object', () => {
    const pose = pivotedPose(base, [4, 0, 0], { t: [0, 0, 0], q: IDENTITY_QUAT, s: [2, 2, 2] });
    // Offset (6,0,0) doubled → the object moves away from the pivot as it grows.
    closeTo(pose.position, [16, 0, 0]);
    closeTo(pose.scale, [2, 2, 2]);
  });

  it('composes the orientation with the original one', () => {
    const rotatedBase: Pose = { ...base, quaternion: Y90 };
    const pose = pivotedPose(rotatedBase, [10, 0, 0], { t: [0, 0, 0], q: Y90, s: [1, 1, 1] });
    closeTo(rotateVec(pose.quaternion, [1, 0, 0]), [-1, 0, 0]);
  });
});
