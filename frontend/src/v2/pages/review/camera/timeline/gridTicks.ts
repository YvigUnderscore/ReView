// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Graduations « lisibles » d'un axe (Phase 27, grille du graph editor) : un pas rond (1/2/5 × 10ⁿ)
 * couvrant l'intervalle avec ~`target` divisions. Pur/testable, sans DOM.
 */

/** Pas rond le plus proche de `raw` dans la suite 1/2/5 × 10ⁿ. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const pow = Math.pow(10, exp);
  const f = raw / pow; // 1..10
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/** Valeurs de graduation régulières couvrant [min, max] avec ~`target` divisions (bornes incluses). */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const step = niceStep((max - min) / Math.max(1, target));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  // Arrondi anti-bruit binaire selon les décimales du pas.
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  for (let t = start; t <= max + step * 1e-6 && ticks.length < 1000; t += step) {
    ticks.push(Number(t.toFixed(Math.min(decimals + 1, 12))));
  }
  return ticks;
}
