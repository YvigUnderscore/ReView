// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Metrics sampler for a Three viewer, **generic and without WebGL dependency**: the render loop
 * calls `frame(now)`, the reader passes a `read()` hooked to its renderer, and the FPS is averaged
 * over a sliding window. Nothing is measured or emitted while nobody is subscribed — a closed
 * panel costs nothing.
 *
 * The splat viewer (`splat/scene/stats.ts`) and the 3D viewer (`three/perfStats.ts`) each derive
 * their own set of counters from it: the window mechanics are the same, only `read()` changes.
 */
export interface Sampler<T> {
  /** Call on every rendered frame (time in ms, e.g. `performance.now()`). */
  frame(nowMs: number): void;
  /** Subscribes a reader; returns the unsubscribe function. */
  subscribe(cb: (stats: { fps: number } & T) => void): () => void;
}

export function createSampler<T extends object>(read: () => T, intervalMs = 500): Sampler<T> {
  const listeners = new Set<(stats: { fps: number } & T) => void>();
  let windowStart: number | null = null;
  let frames = 0;

  return {
    frame(nowMs: number) {
      if (listeners.size === 0) {
        windowStart = null; // window invalidated: no measurement without a subscriber
        return;
      }
      if (windowStart === null) {
        windowStart = nowMs;
        frames = 0;
        return;
      }
      frames += 1;
      const elapsed = nowMs - windowStart;
      if (elapsed < intervalMs) return;
      const stats = { fps: (frames * 1000) / elapsed, ...read() };
      windowStart = nowMs;
      frames = 0;
      for (const cb of listeners) cb(stats);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
