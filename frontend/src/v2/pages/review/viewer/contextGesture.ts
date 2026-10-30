// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { CLICK_SLOP_PX, isClickGesture } from '../three/usdPicking';

/**
 * Right-button handling in spatial viewers (Phase 50, lot 8).
 *
 * A right click there carries two conflicting gestures: **held**, it is fly mode (mouse look
 * + ZQSD/WASD); **short**, it is the context menu, which hosts the actions everywhere else in
 * ReView. Telling them apart takes a threshold, and a threshold is worth debating: it is
 * therefore written down once, explicitly, instead of being scattered across the handlers.
 *
 * Two conditions are needed, since either one alone lets a false positive through:
 *  - **still**: same tolerance as the left click (`CLICK_SLOP_PX`), because a fly almost
 *    always starts with a mouse movement;
 *  - **short**: a right click held in place, without moving, is still a fly intent (the user
 *    was about to move with the keyboard) and must not open a menu on release.
 */

/** Maximum pointer displacement for a short right click (px). */
export const CONTEXT_TAP_SLOP_PX = CLICK_SLOP_PX;

/** Maximum press duration for a short right click (ms); beyond this it was a fly. */
export const CONTEXT_TAP_MAX_MS = 250;

export interface ContextTap {
  /** Pointer displacement between press and release (px). */
  dx: number;
  dy: number;
  /** Right-button press duration (ms). */
  heldMs: number;
}

/** Should this right-button gesture open the context menu (rather than fly)? */
export function isContextTap({ dx, dy, heldMs }: ContextTap): boolean {
  return isClickGesture(dx, dy, CONTEXT_TAP_SLOP_PX) && heldMs <= CONTEXT_TAP_MAX_MS;
}
