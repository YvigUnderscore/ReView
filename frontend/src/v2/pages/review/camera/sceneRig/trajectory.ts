// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../../reviewTypes';
import { sampleAnimV2 } from '../channels/hermite';
import { animKeyTimes, animPlayDuration, CHANNEL_IDS, type CameraAnimV2 } from '../channels/model';

/** Sampled points of the trajectory polyline (world positions). */
const TRAJECTORY_STEPS = 64;

/**
 * Animation signature: the trajectory is only recomputed when it changes.
 *
 * It used to look only at the `px` channel (Phase 27): moving a key on `py`, `pz` or on the target
 * left the polyline stale on screen. It now covers all eight channels, the playback duration and
 * the loop — everything `sampleTrajectory` depends on. Pure/testable.
 */
export function trajSignature(anim: CameraAnimV2): string {
  const parts: string[] = [`${animPlayDuration(anim)}`, anim.loop ? 'loop' : 'once'];
  for (const id of CHANNEL_IDS) {
    const keys = anim.channels[id]?.keys ?? [];
    parts.push(`${id}:${keys.map((k) => `${k.t},${k.v.toFixed(3)},${k.mode}`).join('|')}`);
  }
  return parts.join(';');
}

/**
 * Samples the camera trajectory (positions) over the playback duration, to draw the polyline in
 * the scene. `base` serves as the fallback for keyless channels — the same pose the camera-object
 * starts from, otherwise the line and the mesh would not describe the same plan. Pure/testable.
 */
export function sampleTrajectory(
  anim: CameraAnimV2,
  base: SplatCamera,
): Array<{ x: number; y: number; z: number }> {
  if (animKeyTimes(anim).length < 2) return [];
  const duration = animPlayDuration(anim);
  if (duration <= 0) return [];
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i <= TRAJECTORY_STEPS; i++)
    out.push(sampleAnimV2(anim, (i / TRAJECTORY_STEPS) * duration, base).position);
  return out;
}
