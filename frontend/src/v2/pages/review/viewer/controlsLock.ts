// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single owner of `controls.enabled` for spatial viewers (Phase 50, lot 8).
 *
 * Three modules froze the orbit by writing the boolean directly: fly (`flyControls`), the
 * transform gizmos, and the wheel relay of the overlays that relies on it. None knew what the
 * others wanted: each gizmo unmount set `enabled` back to `true` without checking whether
 * someone else still held the orbit. Arming then disarming a gizmo during a fly therefore
 * restored the orbit **in the middle of the fly**, behind the back of `flyControls`: the mouse
 * started orbiting again instead of steering the view.
 *
 * A boolean cannot carry two reasons at once. So the **inhibitors** are counted: each one takes
 * a named token, releases it when done, and the orbit only comes back once the last token is
 * released. Nobody writes `enabled` by hand anymore — this is the only way to prevent the next
 * quick fix from reintroducing the same defect elsewhere.
 */

/** Minimal target: any object carrying the orbit switch (`OrbitControls`). */
export interface OrbitToggle {
  enabled: boolean;
}

/** Is the orbit enabled with this number of inhibitors? Pure function, testable on its own. */
export function orbitEnabled(inhibitors: number): boolean {
  return inhibitors <= 0;
}

/**
 * Active tokens per target. A `WeakMap`: nothing retains an unmounted viewer, and two viewers
 * mounted at the same time (A/B comparison) each count their own.
 */
const held = new WeakMap<OrbitToggle, { reason: string }[]>();

/** Reasons currently holding the orbit, in acquisition order (for diagnostics and tests). */
export function orbitInhibitors(target: OrbitToggle): readonly string[] {
  return (held.get(target) ?? []).map((token) => token.reason);
}

/**
 * Holds the orbit on behalf of `reason` and returns the function that releases it.
 *
 * Release is **idempotent** and only releases its own token: a replayed cleanup (React effect
 * unmount, dispose called twice) never restores the orbit in place of another inhibitor that
 * is still active.
 */
export function inhibitOrbit(target: OrbitToggle, reason: string): () => void {
  const list = held.get(target) ?? [];
  const token = { reason };
  list.push(token);
  held.set(target, list);
  target.enabled = orbitEnabled(list.length);
  return () => {
    const current = held.get(target);
    const at = current ? current.indexOf(token) : -1;
    if (!current || at < 0) return; // already released
    current.splice(at, 1);
    target.enabled = orbitEnabled(current.length);
  };
}
