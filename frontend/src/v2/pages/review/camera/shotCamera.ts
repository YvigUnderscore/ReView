// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure rules of the "in / out of camera" model (Phase 50, batch 7). The full model is described
 * at the top of `viewer/useLayoutMode.ts`, its source of truth; only the two decisions made
 * elsewhere that deserve standalone tests are found here.
 */

/**
 * Should a key be set when adjusting the focal length or the tilt?
 *
 * Outside the camera, the plan's camera only exists through the animation: its focal length is
 * the sampled value of the `fov` channel, and the base pose that empty channels fall back to is
 * not persisted. Writing to the free camera therefore changes **nothing** — the panel displayed
 * the plan's value and wrote next to it. Inside the camera, the old rule still holds: the free
 * camera *is* the plan's camera, and only armed auto-key turns an adjustment into a key.
 */
export function shouldKeyLens(layoutMode: boolean, autoKey: boolean): boolean {
  return layoutMode || autoKey;
}

/**
 * Time (ms) at which a drag of the camera-object gizmo writes its keys: that of the selected key
 * if the gesture takes one over, otherwise the playhead.
 *
 * An empty animation used to force `t = 0`, whatever the playhead: it was impossible to start an
 * animation anywhere other than the first instant.
 */
export function gizmoKeyTime(selectedKeyTime: number | undefined, playheadMs: number): number {
  return Math.max(0, Math.round(selectedKeyTime ?? playheadMs));
}
