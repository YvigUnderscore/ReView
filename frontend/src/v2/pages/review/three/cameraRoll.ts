// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

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
  if (!roll) {
    // Roll nul → up monde par défaut (Phase 26, fix tilt) : ne fige plus un up projeté sur la
    // vue courante, qui devenait obsolète dès qu'on orbitait ensuite (tilt résiduel). Vue quasi
    // verticale exceptée (up ∥ vue → lookAt dégénéré) : on garde le up projeté.
    const f0 = forward.clone().normalize();
    if (Math.abs(f0.y) > 0.9999) camera.up.copy(baseUp(three, f0));
    else camera.up.set(0, 1, 0);
    return;
  }
  const f = forward.clone().normalize();
  const up = baseUp(three, f);
  const perp = new three.Vector3().crossVectors(f, up); // dans le plan ⟂ vue
  up.multiplyScalar(Math.cos(roll)).addScaledVector(perp, Math.sin(roll)).normalize();
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

/**
 * Vue caméra **réellement affichée** (position/cible/roll) — lue depuis la pose de la
 * caméra (quaternion), pas depuis `controls.target` : pendant le vol (clic droit),
 * OrbitControls est gelé et sa cible n'est recalée qu'au relâchement — capturer la cible
 * des controls figeait la rotation diffusée en session live (retours 33). La cible est
 * reprojetée devant la caméra à la distance d'orbite courante ; hors vol (caméra orientée
 * par `lookAt`), le résultat est identique à l'ancienne lecture des controls.
 */
export function captureCameraView(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3 },
): {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  aspect: number;
  roll?: number;
} {
  const dist = Math.max(camera.position.distanceTo(controls.target), 1e-3);
  const forward = new three.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const target = camera.position.clone().addScaledVector(forward, dist);
  const up = new three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const view: ReturnType<typeof captureCameraView> = {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: target.y, z: target.z },
    fov: camera.fov,
    aspect: camera.aspect,
  };
  const roll = rollFromUp(three, forward, up);
  if (Math.abs(roll) > 1e-4) view.roll = roll;
  return view;
}
