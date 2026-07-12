import type * as THREE from 'three';

/**
 * Tilt (roll) de la caméra autour de l'axe de vue (mode layout) — appliqué via `camera.up`
 * (OrbitControls oriente la caméra selon `up`). Purs/testables, partagés viewer 3D et splat.
 *
 * `roll = 0` → horizon droit (up = projection de +Y perpendiculaire à la vue). `roll` en radians.
 */

/** Up « sans roll » : composante de +Y (ou +Z si vue verticale) perpendiculaire à `forward`. */
function baseUp(three: typeof import('three'), forward: THREE.Vector3): THREE.Vector3 {
  const worldUp = new three.Vector3(0, 1, 0);
  const up = worldUp.clone().addScaledVector(forward, -worldUp.dot(forward));
  if (up.lengthSq() < 1e-8) {
    // Vue quasi verticale : bascule sur +Z pour éviter un up dégénéré.
    const alt = new three.Vector3(0, 0, 1);
    up.copy(alt).addScaledVector(forward, -alt.dot(forward));
  }
  return up.normalize();
}

/** Applique le roll : positionne `camera.up`. `forward` = direction de vue (cible - position). */
export function applyRoll(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  forward: THREE.Vector3,
  roll: number,
): void {
  const f = forward.clone().normalize();
  const up = baseUp(three, f);
  if (roll) {
    const perp = new three.Vector3().crossVectors(f, up); // dans le plan ⟂ vue
    up.multiplyScalar(Math.cos(roll)).addScaledVector(perp, Math.sin(roll)).normalize();
  }
  camera.up.copy(up);
}

/** Lit le roll courant depuis `camera.up` et la direction de vue (angle signé autour de `forward`). */
export function rollFromUp(three: typeof import('three'), forward: THREE.Vector3, up: THREE.Vector3): number {
  const f = forward.clone().normalize();
  const base = baseUp(three, f);
  const u = up.clone().normalize();
  const perp = new three.Vector3().crossVectors(f, base);
  return Math.atan2(perp.dot(u), base.dot(u));
}
