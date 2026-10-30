// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatCamera } from '../reviewTypes';

/**
 * Camera pose to persist in the presentation (Phase 17) — extracted from the captured view,
 * keeping only the recorded/replayed fields: position, target, focal length and tilt.
 * Centralized so that 3D and splat record exactly the same settings. Pure/testable.
 *
 * THE ASPECT IS NOT CAPTURED. The review frame's ratio belongs to the pipeline settings
 * (resolution inherited studio → project → sequence → shot); the camera only carries it.
 * Copying it from the view closed the loop: `camera.aspect` held the frame's ratio, the frame
 * read the presentation, and the first staging recording froze a 16/9 nobody had chosen (see
 * `reviewAspect.ts`).
 *
 * An ALREADY recorded aspect, however, is carried over as is (`storedAspect`): the letterbox
 * guide anchors the normalized 2D annotations, and dropping it at the next recording would
 * move annotations already placed on approved reviews on screen.
 */
export function cameraPoseFromView(view: SplatCamera, storedAspect?: number | null): SplatCamera {
  const pose: SplatCamera = { position: view.position, target: view.target };
  if (view.fov != null) pose.fov = view.fov;
  if (typeof storedAspect === 'number' && Number.isFinite(storedAspect) && storedAspect > 0)
    pose.aspect = storedAspect;
  if (view.roll != null) pose.roll = view.roll;
  return pose;
}
