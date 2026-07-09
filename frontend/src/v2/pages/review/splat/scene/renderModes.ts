import type * as THREE from 'three';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

/**
 * Modes de visualisation d'un splat (10.G), à la manière d'un logiciel 3D :
 * - `splats`   : rendu gaussien normal (falloff plein) ;
 * - `ellipses` : chaque gaussienne en **bordure translucide** (falloff nul + opacité réduite,
 *                V2) — les contours des ellipses se lisent sans que la masse ne bouche la vue ;
 * - `points`   : nuage de centres (overlay `THREE.Points`, splats masqués).
 */
export type RenderMode = 'splats' | 'ellipses' | 'points';

/** Opacité du mode « ellipses » : assez faible pour lire les contours superposés (~15 %). */
export const ELLIPSES_OPACITY = 0.15;

/** Garde-fou perf : nombre max de points construits pour le mode « points ». */
const MAX_POINTS = 1_500_000;

/**
 * Règle l'atténuation du noyau gaussien du SparkRenderer (1 = splats mous, 0 = ellipses pleines).
 * Écrit le champ ET l'uniforme pour une prise d'effet immédiate quel que soit le cycle de sync.
 */
export function setFalloff(spark: SparkRenderer, value: number): void {
  spark.falloff = value;
  spark.uniforms.falloff.value = value;
}

/**
 * Construit un nuage de points (centres + couleurs des splats) pour le mode « points ».
 * Ajouté comme enfant du `SplatMesh` → hérite de la transformation (gizmos). Taille en pixels
 * (indépendante de l'échelle de la scène). Borné par `MAX_POINTS`.
 */
export function buildPointCloud(THREE: typeof import('three'), mesh: SplatMesh): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];
  let count = 0;
  mesh.forEachSplat((_i, center, _scales, _quat, opacity, color) => {
    if (count >= MAX_POINTS || opacity <= 0) return; // splats masqués exclus du nuage
    positions.push(center.x, center.y, center.z);
    colors.push(color.r, color.g, color.b);
    count++;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true });
  return new THREE.Points(geo, material);
}
