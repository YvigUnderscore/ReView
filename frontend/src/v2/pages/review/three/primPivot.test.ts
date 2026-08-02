// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { IDENTITY_QUAT, mulQuat, pivotedPose, rotateVec, type Pose, type Quat } from './primPivot';

/** Quaternion d'une rotation de 90° autour de +Y. */
const Y90: Quat = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];

const base: Pose = { position: [10, 0, 0], quaternion: IDENTITY_QUAT, scale: [1, 1, 1] };
const closeTo = (got: readonly number[], want: readonly number[]) =>
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 6));

describe('rotateVec / mulQuat', () => {
  it('tourne +X vers −Z pour 90° autour de +Y', () => {
    closeTo(rotateVec(Y90, [1, 0, 0]), [0, 0, -1]);
  });

  it('compose deux rotations de 90° en une de 180°', () => {
    closeTo(rotateVec(mulQuat(Y90, Y90), [1, 0, 0]), [-1, 0, 0]);
  });
});

describe('pivotedPose (46.Q)', () => {
  it('delta identité → pose inchangée', () => {
    const pose = pivotedPose(base, [10, 0, 5], { t: [0, 0, 0], q: IDENTITY_QUAT, s: [1, 1, 1] });
    closeTo(pose.position, base.position);
    closeTo(pose.quaternion, base.quaternion);
    closeTo(pose.scale, base.scale);
  });

  it('une translation du proxy translate l’objet tel quel', () => {
    const pose = pivotedPose(base, [10, 0, 5], { t: [1, 2, 3], q: IDENTITY_QUAT, s: [1, 1, 1] });
    closeTo(pose.position, [11, 2, 3]);
  });

  it('une rotation tourne l’objet **autour du pivot**, pas autour de son origine', () => {
    // Objet en (10,0,0), pivot en (10,0,5) : l'offset (0,0,−5) tourné de 90° autour de +Y
    // devient (−5,0,0) — l'objet orbite autour du centre de la géométrie, comme dans un DCC.
    const pose = pivotedPose(base, [10, 0, 5], { t: [0, 0, 0], q: Y90, s: [1, 1, 1] });
    closeTo(pose.position, [5, 0, 5]);
    closeTo(pose.quaternion, Y90);
  });

  it('une échelle dilate la distance au pivot en plus de l’objet', () => {
    const pose = pivotedPose(base, [4, 0, 0], { t: [0, 0, 0], q: IDENTITY_QUAT, s: [2, 2, 2] });
    // Offset (6,0,0) doublé → l'objet s'éloigne du pivot en grandissant.
    closeTo(pose.position, [16, 0, 0]);
    closeTo(pose.scale, [2, 2, 2]);
  });

  it('compose l’orientation avec celle d’origine', () => {
    const rotatedBase: Pose = { ...base, quaternion: Y90 };
    const pose = pivotedPose(rotatedBase, [10, 0, 0], { t: [0, 0, 0], q: Y90, s: [1, 1, 1] });
    closeTo(rotateVec(pose.quaternion, [1, 0, 0]), [-1, 0, 0]);
  });
});
