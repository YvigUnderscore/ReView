// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Tilt (roll) de la caméra autour de l'axe de vue. Purs/testables, partagés viewer 3D et splat.
 * `roll = 0` → horizon droit (up = projection de +Y perpendiculaire à la vue). `roll` en radians.
 *
 * DEUX PORTEURS DU TILT, ET C'EST VOULU.
 * - **`camera.up`** (`applyRoll`) pour une caméra orientée par un `lookAt` **ponctuel** : la caméra
 *   du PiP (`three/applyPose`), une pose restaurée, un réglage du panneau. `up` y est la consigne
 *   donnée au `lookAt` qui suit immédiatement — le résultat est exact.
 * - **l'orientation** (`rollOrientation`) pour une caméra que l'on fait **tourner** : l'orbite et le
 *   vol. Un `up` figé en repère monde cesse de décrire le tilt réglé dès que la direction de vue
 *   change ; le tilt y est donc traité pour ce qu'il est, un angle (`updateOrbitKeepingRoll`).
 *
 * Les deux formes sont interchangeables et le test le verrouille : `lookAt` avec le `up`
 * d'`applyRoll` donne exactement l'orientation que compose `rollOrientation` après un `lookAt`
 * à plat. `rollFromCamera` relit le tilt affiché sans avoir à savoir lequel des deux l'a posé.
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

/** En deçà de cet angle (radians), l'horizon est droit : il n'y a pas de tilt à conserver. */
const ROLL_EPSILON = 1e-6;

/**
 * Tilt **réellement affiché**, lu de l'orientation de la caméra (son axe +Y local) et non de
 * `camera.up`. C'est la seule lecture fiable : `camera.up` est la *consigne* donnée à `lookAt`,
 * l'orientation est le *résultat*, et les deux divergent dès qu'on tourne la vue.
 */
export function rollFromCamera(three: typeof import('three'), camera: THREE.PerspectiveCamera): number {
  const forward = new three.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const up = new three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  return rollFromUp(three, forward, up);
}

/**
 * Compose le tilt dans l'**orientation**, autour de l'axe de vue, après un `lookAt` sans roulis.
 * `-roll` : l'angle mesuré par `rollFromUp` (celui de `up` autour de `forward`) est de signe
 * opposé à une rotation autour du +Z local — même convention que `flyControls.flyLookEuler`, et
 * le résultat est exactement l'orientation que produirait `lookAt` avec le `up` d'`applyRoll`.
 */
export function rollOrientation(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  roll: number,
): void {
  if (!Number.isFinite(roll) || Math.abs(roll) < ROLL_EPSILON) return;
  camera.quaternion.multiply(new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 0, 1), -roll));
}

/**
 * `controls.update()` qui **conserve le tilt** — à appeler à la place de `controls.update()` dans
 * la boucle de rendu (les deux viewers).
 *
 * POURQUOI. `OrbitControls.update()` termine par `object.lookAt(target)`, qui reconstruit
 * l'orientation à partir de `camera.up`. Or le tilt du panneau Caméra vit justement dans
 * `camera.up` (`applyRoll`), sous forme d'un vecteur figé **en repère monde**, projeté sur la
 * direction de vue qu'on avait au moment du réglage. Orbiter change cette direction sans toucher au
 * vecteur : l'angle entre `up` et l'horizon de la nouvelle vue n'est plus celui qu'on avait réglé,
 * et la caméra paraît prendre une rotation à mesure qu'on tourne au clic gauche. Le pôle d'orbite,
 * lui, n'est pas en cause — OrbitControls le fige à la construction (`_quat`, lu une seule fois).
 *
 * Le tilt est donc traité pour ce qu'il est : un **angle**, relu avant l'orbite et recomposé après.
 * `camera.up` repart à plat avant `lookAt` (l'état exact du tilt nul, seul chemin où l'orbite était
 * déjà stable), et l'angle est remis dans l'orientation. À tilt nul, rien ne se passe du tout.
 */
export function updateOrbitKeepingRoll(
  three: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
): void {
  const roll = rollFromCamera(three, camera);
  const forward = new three.Vector3().subVectors(controls.target, camera.position);
  // Horizon droit, ou caméra confondue avec sa cible (`lookAt` y est dégénéré) : orbite nue.
  if (Math.abs(roll) < ROLL_EPSILON || forward.lengthSq() < 1e-12) {
    controls.update();
    return;
  }
  applyRoll(three, camera, forward, 0);
  controls.update();
  rollOrientation(three, camera, roll);
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
