/**
 * Métriques du viewer splat (10.G-V1), sans dépendance Three/Spark : l'échantillonneur reçoit
 * un `read()` branché sur le renderer (splats actifs, draw calls…) et calcule le FPS sur une
 * fenêtre glissante. Pur et testable ; la boucle de rendu appelle `frame(now)` à chaque frame,
 * les panneaux du HUD s'abonnent (aucune mesure ni émission sans abonné).
 */
export interface SplatStats {
  /** Images par seconde, moyennées sur la fenêtre d'échantillonnage. */
  fps: number;
  /** Splats rendus par Spark après tri/LOD (`SparkRenderer.activeSplats`). */
  activeSplats: number;
  /** Nombre total de splats du fichier (`PackedSplats.numSplats`). */
  totalSplats: number;
  /** Draw calls WebGL de la dernière frame (`renderer.info.render.calls`). */
  calls: number;
}

export interface StatsSampler {
  /** À appeler à chaque frame rendue (temps en ms, ex. `performance.now()`). */
  frame(nowMs: number): void;
  /** Abonne un panneau ; renvoie la fonction de désabonnement. */
  subscribe(cb: (stats: SplatStats) => void): () => void;
}

export function createStatsSampler(read: () => Omit<SplatStats, 'fps'>, intervalMs = 500): StatsSampler {
  const listeners = new Set<(stats: SplatStats) => void>();
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
      const stats: SplatStats = { fps: (frames * 1000) / elapsed, ...read() };
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
