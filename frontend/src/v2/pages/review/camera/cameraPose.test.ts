// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cameraPoseFromView } from './cameraPose';

/**
 * Deliberately rewritten test bench (Phase 50, batch 8). It used to lock in "keep the fields
 * present, including aspect": that was precisely the bug. `camera.aspect` held the frame's
 * ratio, the frame read the presentation — so the first recording froze a 16/9 nobody had
 * chosen, instead of the project's delivery ratio. The aspect is no longer captured; an
 * already-recorded aspect, however, is carried over (normalized annotations already placed).
 */
describe('cameraPoseFromView', () => {
  const base = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } };

  it('keeps position/target, focal length and tilt', () => {
    const pose = cameraPoseFromView({ ...base, fov: 50, roll: 0.2 });
    expect(pose).toEqual({ ...base, fov: 50, roll: 0.2 });
  });

  it('does NOT record the view aspect — the ratio is not a camera setting', () => {
    const pose = cameraPoseFromView({ ...base, fov: 50, aspect: 1.777 });
    expect('aspect' in pose).toBe(false);
  });

  it('carries over the already-recorded aspect, whatever the view\'s own is', () => {
    const pose = cameraPoseFromView({ ...base, aspect: 16 / 9 }, 2.39);
    expect(pose.aspect).toBeCloseTo(2.39);
  });

  it('does not write a faulty recorded aspect', () => {
    expect('aspect' in cameraPoseFromView(base, 0)).toBe(false);
    expect('aspect' in cameraPoseFromView(base, Number.NaN)).toBe(false);
    expect('aspect' in cameraPoseFromView(base, null)).toBe(false);
  });

  it('omits absent fields (no undefined fov/aspect/roll keys)', () => {
    const pose = cameraPoseFromView(base);
    expect(pose).toEqual(base);
    expect('aspect' in pose).toBe(false);
    expect('roll' in pose).toBe(false);
  });
});
