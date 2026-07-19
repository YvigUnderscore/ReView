import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type TurntableAxis = 'x' | 'y' | 'z';

/** Bornes de vitesse du turntable (degrés/seconde). */
export const TURNTABLE_SPEED_MIN = 1;
export const TURNTABLE_SPEED_MAX = 180;

/**
 * Un pas de turntable (39.D) : fait orbiter la **caméra** autour de `controls.target` autour de
 * l'axe monde choisi, d'un angle `deltaRad`. Ne touche ni au modèle ni à `camera.up` (conservé
 * vertical → compatible OrbitControls, horizon stable) : c'est une prévisualisation non
 * destructive, rien à rétablir à l'arrêt. Pur/testable (le rayon à la cible est préservé).
 */
export function turntableStep(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  axis: TurntableAxis,
  deltaRad: number,
): void {
  const a = new three.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  const offset = new three.Vector3().subVectors(camera.position, controls.target);
  offset.applyAxisAngle(a, deltaRad);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
}
