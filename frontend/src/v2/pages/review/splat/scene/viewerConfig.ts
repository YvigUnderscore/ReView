import type { SparkRenderer } from '@sparkjsdev/spark';

/**
 * Réglages du renderer Spark (10.G-V1) : culling. Par défaut Spark clippe les centres de
 * gaussiennes à 40 % hors cadre (`clipXY` 1.4) et borne le rayon écran d'un splat à 512 px —
 * en zoom fort (overscale), des splats disparaissent en bord de vue. La review neutralise ce
 * culling par défaut ; le panneau de réglages du HUD permet de revenir aux défauts Spark (perf).
 */
export interface CullingConfig {
  clipXY: number;
  maxPixelRadius: number;
}

/** Défauts Spark (culling actif — plus rapide sur les très gros nuages). */
export const CULLING_SPARK: CullingConfig = { clipXY: 1.4, maxPixelRadius: 512 };

/** Culling neutralisé (défaut review) : aucun centre clippé, rayon écran très large. */
export const CULLING_OFF: CullingConfig = { clipXY: 100, maxPixelRadius: 4096 };

type CullingTarget = Pick<SparkRenderer, 'clipXY' | 'maxPixelRadius'>;

/** Applique la configuration de culling au SparkRenderer (live, sans reconstruire la scène). */
export function applyCulling(spark: CullingTarget, off: boolean): void {
  const cfg = off ? CULLING_OFF : CULLING_SPARK;
  spark.clipXY = cfg.clipXY;
  spark.maxPixelRadius = cfg.maxPixelRadius;
}
