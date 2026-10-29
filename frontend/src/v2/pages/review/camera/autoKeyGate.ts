// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Auto-key gate (Phase 50, batch 7). Auto-key listens to gestures on the **canvas**, where
 * both the free camera and the camera-object gizmo are found. Outside camera (layout mode),
 * none of these gestures moves the plan's camera:
 *  - orbit/wheel moves the **free** camera — setting a key would make no sense;
 *  - dragging the gizmo already writes its own keys, and the final `pointerup` would set an
 *    8-channel key on top, overwriting what the gizmo had just written.
 *
 * `useCameraAnim` mounts auto-key itself (`useCameraAutoKey(autoKey, getDom, insertKeyAtView)`)
 * and does not know the mode: the gate is the channel through which `useLayoutMode`, the only
 * source of truth for "in/out of camera", suspends it. Only one spatial viewer is mounted at a
 * time, hence the module state — deliberately minimal and resettable.
 */

let suspended = false;

/** Suspends (or restores) auto-key. Called by `useLayoutMode` when entering/leaving the mode. */
export function suspendAutoKey(on: boolean): void {
  suspended = on;
}

/** True when a gesture on the canvas must not set a key. */
export function isAutoKeySuspended(): boolean {
  return suspended;
}
