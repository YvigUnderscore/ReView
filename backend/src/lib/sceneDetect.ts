// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scene detection (34.H): parsing of FFmpeg's `showinfo` output — the worker runs
 * `select='gt(scene,S)',showinfo` and places a timeline marker "Shot n" at each detected cut.
 * Pure helpers, tested; the FFmpeg pass lives in the worker.
 */

/** FFmpeg scene threshold (0..1) — 0.4: clean cuts without over-detection. */
export const SCENE_THRESHOLD = 0.4;

/** Safeguard: maximum number of automatic markers placed per video. */
export const MAX_SCENE_MARKERS = 120;

/** Extracts the instants (s) of the retained frames from showinfo's stderr output. */
export function parseSceneTimes(stderr: string): number[] {
  const times: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

/**
 * Start-of-shot frames (unique, increasing, excluding frame 0 — shot 1 starts at the beginning), bounded by the safeguard. `fps` from the probe, fallback 24.
 */
export function sceneFrames(times: number[], fps: number, max = MAX_SCENE_MARKERS): number[] {
  const f = fps > 0 && Number.isFinite(fps) ? fps : 24;
  const frames = [...new Set(times.map((t) => Math.round(t * f)))].filter((x) => x > 0).sort((a, b) => a - b);
  return frames.slice(0, max);
}
