// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { forwardOfPose, lookDistance, targetFromForward } from './poseObject';

const pose = {
  position: { x: 0, y: 0, z: 5 },
  target: { x: 0, y: 0, z: 0 },
};

describe('poseObject', () => {
  it('lookDistance = distance position→cible', () => {
    expect(lookDistance(pose)).toBeCloseTo(5);
  });

  it('forwardOfPose = direction unitaire position→cible', () => {
    expect(forwardOfPose(pose)).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('forwardOfPose dégénérée (position=cible) → -Z par défaut', () => {
    expect(forwardOfPose({ position: { x: 1, y: 1, z: 1 }, target: { x: 1, y: 1, z: 1 } })).toEqual({
      x: 0,
      y: 0,
      z: -1,
    });
  });

  it('targetFromForward reconstruit la cible à la bonne distance', () => {
    const t = targetFromForward({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -2 }, 5);
    expect(t).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('roundtrip forward/target conserve la cible', () => {
    const fwd = forwardOfPose(pose);
    const back = targetFromForward(pose.position, fwd, lookDistance(pose));
    expect(back.x).toBeCloseTo(pose.target.x);
    expect(back.z).toBeCloseTo(pose.target.z);
  });
});
