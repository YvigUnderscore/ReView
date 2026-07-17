import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { createPointCloud, type PointCloud } from './pointCloud';

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

/**
 * Bascule la scène dans un mode de visualisation : règle opacité/falloff du rendu gaussien et
 * (re)construit l'overlay de points à la demande. Renvoie l'overlay courant (null hors mode
 * points) — l'appelant garde la référence pour les reflets live (sélection, masque, crop) et la
 * libération au démontage. L'overlay est reconstruit à chaque entrée dans le mode (l'état masqué
 * courant est capté à la construction ; sélection et suppressions suivantes reflétées en direct).
 */
export function applyRenderModeToScene(
  three: typeof import('three'),
  scene: { mesh: SplatMesh; spark: SparkRenderer },
  mode: RenderMode,
  current: PointCloud | null,
): PointCloud | null {
  current?.dispose();
  if (mode === 'points') {
    // Masque les splats (opacité 0) mais garde le mesh « visible » pour rendre l'overlay enfant.
    scene.mesh.opacity = 0;
    const cloud = createPointCloud(three, scene.mesh);
    scene.mesh.add(cloud.points);
    return cloud;
  }
  if (mode === 'ellipses') {
    // Bordures : ellipses plates (falloff nul) rendues translucides (V2).
    scene.mesh.opacity = ELLIPSES_OPACITY;
    setFalloff(scene.spark, 0);
  } else {
    scene.mesh.opacity = 1;
    setFalloff(scene.spark, 1);
  }
  return null;
}
