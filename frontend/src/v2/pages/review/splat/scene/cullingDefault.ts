// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spark culling of the splat viewer: the default, and the memory of the choice, written only once.
 *
 * The default used to live twice: when the scene is mounted (`useSplat`, `applyCulling(spark, …)`)
 * and in the HUD state (`useSplatView`). The two literals had to agree without anything enforcing
 * it: a divergence and the panel's toggle would lie from the first render, without the cloud
 * changing. They now both read `readCullingOff()`.
 *
 * `off === true` = culling **disabled** (`CULLING_OFF` from `viewerConfig`): nothing disappears at
 * a strong zoom or at the edge of the frame, at the cost of rendering splats nobody will see.
 *
 * **Culling is active by default** (Phase 50, lot 8). It had been disabled since 10.G-V1 so that no
 * splat would vanish; on the scans studios actually open, this meant permanently paying for the
 * rendering of out-of-frame gaussians. Whoever sees splats vanish on a strong zoom keeps the
 * one-click escape hatch (the *Scene* panel, or the viewer's right-click menu).
 *
 * The choice is **remembered per user**, like the floor grid (`useSceneGrid`): it is a comfort
 * preference, not a studio setting, so no admin inheritance decides it.
 */

/** Key of the local preference (per browser, per user). */
const STORAGE_KEY = 'review-splat-culling-off';

/** Default when no preference is saved: culling active. */
export const DEFAULT_CULLING_OFF = false;

/** Reads the preference from its raw value: pure function, testable without `localStorage`. */
export function parseCullingOff(raw: string | null): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return DEFAULT_CULLING_OFF; // missing or unreadable: the default, never a random value
}

/** The user's preference, or the default. */
export function readCullingOff(): boolean {
  try {
    return parseCullingOff(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage inaccessible (private mode, site policy): the default is enough to display.
    return DEFAULT_CULLING_OFF;
  }
}

/** Remembers the user's choice. */
export function writeCullingOff(off: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, off ? '1' : '0');
  } catch {
    // Nothing to catch up: the current session keeps its setting; it will not survive a reload.
  }
}
