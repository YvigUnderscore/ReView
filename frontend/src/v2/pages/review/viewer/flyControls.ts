// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { isEditable } from '../../../lib/shortcuts';
import { applyRoll, rollFromCamera } from '../three/cameraRoll';
import { inhibitOrbit } from './controlsLock';

/**
 * Navigation « fly » type Unreal (10.G-V1) : clic droit maintenu = regard souris + déplacement
 * clavier ZQSD/WASD (codes physiques, donc azerty/qwerty confondus) + A/E descendre/monter,
 * molette = vitesse de vol, Maj = accélérer. OrbitControls est gelé pendant le vol puis recalé
 * (cible replacée devant la caméra, à distance constante) pour une reprise d'orbite cohérente.
 *
 * Le **tilt** (roulis du panneau Caméra) fait partie de la pose de vol : cf. `flyLookEuler`.
 *
 * Le clic droit maintenu est un **mode de navigation** : tant qu'il dure, le clavier appartient
 * au vol et à rien d'autre (le chrome de review et l'éditeur se taisent, cf. `useChromeState`).
 * Un clic droit **bref**, lui, n'est pas un vol : c'est le menu contextuel, servi par
 * `useSpatialContextMenu` — ce module ne fait que bloquer le menu natif du navigateur.
 *
 * Implémentation locale plutôt que `FpsMovement` de Spark : celui-ci attache ses listeners
 * `document` dans son constructeur sans jamais les retirer (fuite à chaque remontage du viewer).
 * On reprend son mapping par codes physiques, avec des listeners proprement disposés.
 */

/** Mapping code physique → direction locale caméra (X droite, Y haut, -Z avant). */
export const FLY_MOVE_MAPPING: Record<string, readonly [number, number, number]> = {
  KeyW: [0, 0, -1], // Z (azerty) / W : avancer
  KeyS: [0, 0, 1], // S : reculer
  KeyA: [-1, 0, 0], // Q (azerty) / A : gauche
  KeyD: [1, 0, 0], // D : droite
  KeyE: [0, 1, 0], // E : monter
  KeyQ: [0, -1, 0], // A (azerty) / Q : descendre
};

/** Multiplicateur de vitesse avec Maj enfoncée (comme FpsMovement). */
export const FLY_SHIFT_MULTIPLIER = 5;

/**
 * Cette touche appartient-elle au vol ? **Référence unique** des touches de vol : trois
 * gestionnaires clavier concurrents vivent sur `window`/`document` (ce module, le chrome de
 * review, l'auto-pause de l'animation caméra) et doivent tous se prononcer sur le même jeu de
 * codes physiques — recopier la liste, c'est la laisser diverger.
 */
export function isFlyMoveCode(code: string): boolean {
  return code in FLY_MOVE_MAPPING;
}

/** Sensibilité du regard (radians par pixel de mouvement souris). */
const LOOK_SPEED = 0.0035;

/**
 * Au-delà de cette composante verticale de la vue, le repère qui sert à mesurer le roulis est
 * dégénéré (`cameraRoll.baseUp` y bascule d'axe) : le tilt n'y est plus relu.
 */
const VERTICAL_LIMIT = 0.999;

/**
 * Pose du regard en vol (Euler `YXZ`) : lacet et tangage viennent de la souris, **le roulis vient
 * du tilt**. Pur, testable.
 *
 * POURQUOI. Le tilt du panneau Caméra vit dans `camera.up`, que seul `lookAt` consulte — donc
 * OrbitControls, gelé pendant le vol. La pose composée ici forçait `z = 0` : le roulis tombait à
 * plat au premier mouvement de souris et ne revenait qu'à l'atterrissage, quand l'orbite reprenait
 * la main et recadrait la caméra. Il fait désormais partie de la pose de vol.
 *
 * `z = -roll` : dans l'ordre `YXZ`, `Rz` tourne autour de l'axe de vue, et l'angle mesuré par
 * `rollFromUp` (celui de `up` autour de `forward`) est de signe opposé — un tilt de +30° se
 * compose donc en `z = -30°`. C'est exactement l'orientation que produirait `lookAt` avec le `up`
 * de `applyRoll` : rien ne saute à l'atterrissage.
 */
export function flyLookEuler(
  look: { x: number; y: number },
  movement: { x: number; y: number },
  roll: number,
): { x: number; y: number; z: number } {
  const dx = Number.isFinite(movement.x) ? movement.x : 0;
  const dy = Number.isFinite(movement.y) ? movement.y : 0;
  const limit = Math.PI / 2;
  return {
    x: Math.max(-limit, Math.min(limit, look.x - dy * LOOK_SPEED)),
    y: look.y - dx * LOOK_SPEED,
    // `roll !== 0` : sans tilt, on rend un 0 franc plutôt que le -0 de la négation.
    z: Number.isFinite(roll) && roll !== 0 ? -roll : 0,
  };
}

/** Direction de déplacement locale (normalisée) selon les codes enfoncés — pur, testable. */
export function moveDirection(pressed: ReadonlySet<string>): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const code of pressed) {
    const dir = FLY_MOVE_MAPPING[code];
    if (!dir) continue;
    x += dir[0];
    y += dir[1];
    z += dir[2];
  }
  const len = Math.hypot(x, y, z);
  return len > 0 ? [x / len, y / len, z / len] : [0, 0, 0];
}

export interface FlyControls {
  /** Vol en cours (clic droit maintenu sur le canvas). */
  readonly flying: boolean;
  /** À appeler à chaque frame avec le delta en secondes ; ne fait rien hors vol. */
  update(dt: number): void;
  dispose(): void;
}

export function createFlyControls(
  THREE: typeof import('three'),
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  dom: HTMLElement,
): FlyControls {
  // Le clic droit passe au vol : l'orbite garde gauche = tourner, molette = zoom, et le pan
  // bascule sur le bouton du milieu (convention DCC).
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = null;

  const pressed = new Set<string>();
  let flying = false;
  let shift = false;
  let speed = 1; // unités/s, recalée sur l'échelle de la scène à chaque départ de vol
  let roll = 0; // tilt du plan, relu depuis `camera.up` au fil du vol (cf. `onPointerMove`)
  let orbitDistance = 1; // distance caméra→cible au départ, restituée à l'atterrissage
  let pointerId = -1;
  // Jeton d'inhibition de l'orbite pendant le vol (cf. `controlsLock`) : plus personne n'écrit
  // `controls.enabled`, sinon le démontage d'un gizmo rendait l'orbite en plein vol.
  let releaseOrbit: (() => void) | null = null;
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const move = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const endFlight = () => {
    if (!flying) return;
    flying = false;
    if (pointerId >= 0 && dom.hasPointerCapture?.(pointerId)) dom.releasePointerCapture(pointerId);
    pointerId = -1;
    // Recale la cible d'orbite devant la caméra, à la distance du départ de vol.
    move.set(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(move, orbitDistance);
    releaseOrbit?.();
    releaseOrbit = null;
    controls.update();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 2 || flying) return;
    flying = true;
    pointerId = e.pointerId;
    // Le vol part **à l'arrêt**, avec l'état réel de Maj : les touches de direction ne sont
    // accumulées qu'en vol, et une touche déjà enfoncée à l'appui n'appartient pas au vol.
    pressed.clear();
    shift = e.shiftKey;
    orbitDistance = Math.max(camera.position.distanceTo(controls.target), 0.01);
    speed = Math.max(orbitDistance, 0.1);
    releaseOrbit = inhibitOrbit(controls, 'fly'); // gèle l'orbite pendant le vol
    try {
      dom.setPointerCapture(e.pointerId);
    } catch {
      // Pointeurs synthétiques sans capture (tests, automation) : le vol reste fonctionnel.
    }
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!flying) return;
    // Le tilt est relu depuis l'**orientation** de la caméra à chaque mouvement, puis remis en
    // phase avec la nouvelle direction de vue : la lecture est idempotente (`rollFromUp` inverse
    // exactement `applyRoll`), et un réglage du panneau en plein vol est pris tel quel. Le lire
    // dans `camera.up` ne marche plus : hors vol, le tilt n'y est plus figé mais recomposé dans
    // l'orientation à chaque tour (cf. `cameraRoll.updateOrbitKeepingRoll`), et `up` est à plat —
    // le premier mouvement de souris remettait donc le roulis à zéro. Vue quasi verticale
    // exceptée : le repère de mesure y est dégénéré, on garde le dernier tilt lu plutôt que de
    // laisser la caméra tournoyer au zénith.
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    if (Math.abs(forward.y) < VERTICAL_LIMIT) roll = rollFromCamera(THREE, camera);
    euler.setFromQuaternion(camera.quaternion);
    const look = flyLookEuler(euler, { x: e.movementX, y: e.movementY }, roll);
    euler.x = look.x;
    euler.y = look.y;
    euler.z = look.z;
    camera.quaternion.setFromEuler(euler);
    // `camera.up` reste tenu en phase pendant le vol : c'est lui que lit le `lookAt` du
    // `controls.update()` de l'atterrissage (`endFlight`), avant que la boucle ne reprenne la
    // main — sans quoi le tilt tomberait à plat le temps d'une frame en reposant l'orbite.
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    applyRoll(THREE, camera, forward, roll);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.button === 2) endFlight();
  };

  const onWheel = (e: WheelEvent) => {
    if (!flying) return;
    e.preventDefault(); // pas de zoom d'orbite pendant le vol : la molette règle la vitesse
    speed *= e.deltaY < 0 ? 1.25 : 0.8;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // HORS VOL, le clavier n'appartient pas au vol. Les touches étaient accumulées en
    // permanence, saisie de texte comprise : maintenir une direction sans cliquer ne faisait
    // rien de visible, puis le clic droit démarrait un vol **déjà en mouvement**. Le clic droit
    // maintenu est le mode de navigation — il commence là, et le clavier avec lui.
    if (!flying || isEditable(e.target)) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shift = true;
    if (!isFlyMoveCode(e.code)) return;
    pressed.add(e.code);
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    // Le relâchement, lui, n'est jamais filtré : une touche relâchée après l'atterrissage (ou
    // hors de la fenêtre) doit quitter l'ensemble, sinon la direction reste collée.
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shift = false;
    pressed.delete(e.code);
  };
  const onBlur = () => {
    pressed.clear();
    shift = false;
    endFlight();
  };
  const onContextMenu = (e: Event) => e.preventDefault();

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    get flying() {
      return flying;
    },
    update(dt: number) {
      if (!flying || dt <= 0) return;
      const [x, y, z] = moveDirection(pressed);
      if (x === 0 && y === 0 && z === 0) return;
      move.set(x, y, z).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(move, speed * (shift ? FLY_SHIFT_MULTIPLIER : 1) * dt);
    },
    dispose() {
      endFlight();
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
