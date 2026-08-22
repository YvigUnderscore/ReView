// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Échantillonneur de métriques d'un viewer Three, **générique et sans dépendance WebGL** :
 * la boucle de rendu appelle `frame(now)`, le lecteur passe un `read()` branché sur son
 * renderer, et le FPS est moyenné sur une fenêtre glissante. Aucune mesure ni émission tant
 * que personne n'est abonné — un panneau fermé ne coûte rien.
 *
 * Le viewer splat (`splat/scene/stats.ts`) et le viewer 3D (`three/perfStats.ts`) en dérivent
 * chacun leur jeu de compteurs : la mécanique de fenêtre est la même, seul `read()` change.
 */
export interface Sampler<T> {
  /** À appeler à chaque frame rendue (temps en ms, ex. `performance.now()`). */
  frame(nowMs: number): void;
  /** Abonne un lecteur ; renvoie la fonction de désabonnement. */
  subscribe(cb: (stats: { fps: number } & T) => void): () => void;
}

export function createSampler<T extends object>(read: () => T, intervalMs = 500): Sampler<T> {
  const listeners = new Set<(stats: { fps: number } & T) => void>();
  let windowStart: number | null = null;
  let frames = 0;

  return {
    frame(nowMs: number) {
      if (listeners.size === 0) {
        windowStart = null; // fenêtre invalidée : pas de mesure sans abonné
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
