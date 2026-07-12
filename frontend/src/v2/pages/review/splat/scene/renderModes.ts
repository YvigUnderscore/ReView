import type { SparkRenderer } from '@sparkjsdev/spark';

/**
 * Modes de visualisation d'un splat (10.G), à la manière d'un logiciel 3D :
 * - `splats`   : rendu gaussien normal (falloff plein) ;
 * - `ellipses` : chaque gaussienne en **bordure translucide** (falloff nul + opacité réduite,
 *                V2) — les contours des ellipses se lisent sans que la masse ne bouche la vue ;
 * - `points`   : nuage de centres (overlay `PointCloud`, splats masqués). Voir `pointCloud.ts`.
 */
export type RenderMode = 'splats' | 'ellipses' | 'points';

/** Opacité du mode « ellipses » : assez faible pour lire les contours superposés (~15 %). */
export const ELLIPSES_OPACITY = 0.15;

/**
 * Règle l'atténuation du noyau gaussien du SparkRenderer (1 = splats mous, 0 = ellipses pleines).
 * Écrit le champ ET l'uniforme pour une prise d'effet immédiate quel que soit le cycle de sync.
 */
export function setFalloff(spark: SparkRenderer, value: number): void {
  spark.falloff = value;
  spark.uniforms.falloff.value = value;
}
