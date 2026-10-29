// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Readable" ticks for an axis (Phase 27, graph editor grid): a round step (1/2/5 × 10ⁿ) covering
 * the interval with about `target` divisions. Pure/testable, no DOM.
 */

/** Round step closest to `raw` in the 1/2/5 × 10ⁿ series. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const pow = Math.pow(10, exp);
  const f = raw / pow; // 1..10
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/** Regular tick values covering [min, max] with about `target` divisions (bounds included). */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const step = niceStep((max - min) / Math.max(1, target));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Rounding against binary noise, according to the step's decimals.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  for (let t = start; t <= max + step * 1e-6 && ticks.length < 1000; t += step) {
    ticks.push(Number(t.toFixed(Math.min(decimals + 1, 12))));
  }
  return ticks;
}
