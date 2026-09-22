// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { SplatCamera } from '../../reviewTypes';
import { registerSceneHelpers } from '../../viewer/sceneHelpers';

/**
 * Caméra-objet visible dans la scène (Phase 17) : un mesh « caméra » (corps + frustum filaire)
 * orienté vers la cible, un marqueur de cible, et la **trajectoire** échantillonnée de l'animation
 * (polyligne + points de clés). Rendu dans la scène Three du viewer (splat ou 3D). Impur (crée des
 * objets Three) — la logique de pose est dans `poseObject` (pur/testé). `size` cale l'échelle sur
 * la scène.
 *
 * Deux règles de **retour visuel**, toutes deux nécessaires pour que l'artiste voie ce qu'il règle :
 * - **dessinée par-dessus la scène** — ce que `renderOrder = 999` déclarait sans l'obtenir : la
 *   caméra du plan se tient le plus souvent *dans* le nuage de splats ou derrière le modèle, où la
 *   profondeur la faisait purement disparaître. On ne la voyait donc jamais bouger, et le gizmo
 *   n'avait aucune prise visible. Il y fallait les trois : pas de test de profondeur, la passe
 *   transparente (celle des splats), et l'ordre de rendu posé sur **chaque** objet dessiné ;
 * - **objets d'aide déclarés** (`viewer/sceneHelpers`) : ils sont retirés de la passe PiP, où ils
 *   dessinaient une image rigide par rapport à la caméra du plan.
 */
export interface CameraObjectRuntime {
  /** Corps de la caméra (cible du gizmo de position). */
  body: THREE.Group;
  /** Marqueur de cible (look-at) — déplaçable pour réorienter la caméra. */
  targetMarker: THREE.Mesh;
  update(pose: SplatCamera): void;
  setTrajectory(positions: Array<{ x: number; y: number; z: number }>): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const PRIMARY = 0x00f0ff;
/** Dernier de la passe transparente : la caméra du plan se voit par-dessus la scène. */
const RENDER_ORDER = 999;

export function createCameraObject(
  THREE: typeof import('three'),
  scene: THREE.Scene,
  size: number,
): CameraObjectRuntime {
  const body = new THREE.Group();
  const s = size;
  /**
   * Dessiné par-dessus la scène : sans quoi le modèle ou le nuage cache la caméra du plan.
   * `transparent` (à opacité pleine) pour la seule **passe** : Three dessine les transparents après
   * les opaques, et les splats de Spark en sont. Un matériau opaque, même sans test de profondeur,
   * se faisait donc recouvrir par le nuage — et la caméra du plan disparaissait dedans, là où elle
   * se tient précisément le plus souvent. `renderOrder` 999 la place en dernier de cette passe.
   */
  const onTop = { depthTest: false, depthWrite: false, transparent: true } as const;

  // Corps : petite boîte (opaque) + frustum vers **+Z** (Object3D.lookAt oriente +Z vers la cible,
  // donc l'objectif s'ouvre vers la cible — Phase 27, corrige l'orientation « à l'envers »).
  const boxGeo = new THREE.BoxGeometry(s * 0.7, s * 0.5, s * 0.9);
  const boxMat = new THREE.MeshBasicMaterial({ color: PRIMARY, ...onTop });
  const boxWireMat = new THREE.MeshBasicMaterial({ color: 0x001018, wireframe: true, ...onTop });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.add(new THREE.Mesh(boxGeo, boxWireMat));
  body.add(box);

  const d = s * 1.2; // profondeur du frustum
  const w = s * 0.7;
  const h = s * 0.5;
  const apex = new THREE.Vector3(0, 0, s * 0.45);
  const corners = [
    new THREE.Vector3(-w, -h, d),
    new THREE.Vector3(w, -h, d),
    new THREE.Vector3(w, h, d),
    new THREE.Vector3(-w, h, d),
  ];
  const pts: THREE.Vector3[] = [];
  corners.forEach((c) => {
    pts.push(apex.clone(), c.clone());
  });
  for (let i = 0; i < 4; i++) pts.push(corners[i].clone(), corners[(i + 1) % 4].clone());
  const frustumGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const frustumMat = new THREE.LineBasicMaterial({ color: PRIMARY, ...onTop });
  body.add(new THREE.LineSegments(frustumGeo, frustumMat));
  // `renderOrder` se lit **sur l'objet rendu**, pas sur son parent : posé sur le seul Group, il ne
  // valait rien pour le corps ni pour le frustum, qui passaient à l'ordre 0.
  body.traverse((o) => {
    o.renderOrder = RENDER_ORDER;
  });
  scene.add(body);

  // Marqueur de cible (sphère).
  const targetMarker = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.28, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2095, ...onTop }),
  );
  targetMarker.renderOrder = RENDER_ORDER;
  scene.add(targetMarker);

  // Trajectoire (polyligne) + points de clés.
  const trajGeo = new THREE.BufferGeometry();
  const trajMat = new THREE.LineBasicMaterial({ color: PRIMARY, opacity: 0.6, ...onTop });
  const traj = new THREE.Line(trajGeo, trajMat);
  traj.renderOrder = RENDER_ORDER;
  scene.add(traj);

  // Objets d'aide : hors de la passe PiP (cf. `viewer/sceneHelpers`).
  const unregister = registerSceneHelpers(body, targetMarker, traj);

  const _target = new THREE.Vector3();
  const update = (pose: SplatCamera) => {
    body.position.set(pose.position.x, pose.position.y, pose.position.z);
    _target.set(pose.target.x, pose.target.y, pose.target.z);
    body.lookAt(_target); // Group : oriente +Z vers la cible (frustum ouvert vers la cible)
    targetMarker.position.copy(_target);
  };

  const setTrajectory = (positions: Array<{ x: number; y: number; z: number }>) => {
    trajGeo.setFromPoints(positions.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    traj.visible = positions.length > 1;
  };

  const setVisible = (visible: boolean) => {
    body.visible = visible;
    targetMarker.visible = visible;
    traj.visible = visible && trajGeo.getAttribute('position')?.count > 1;
  };

  const dispose = () => {
    unregister();
    scene.remove(body, targetMarker, traj);
    boxGeo.dispose();
    boxMat.dispose();
    boxWireMat.dispose();
    frustumGeo.dispose();
    frustumMat.dispose();
    trajGeo.dispose();
    trajMat.dispose();
    (targetMarker.geometry as THREE.BufferGeometry).dispose();
    (targetMarker.material as THREE.Material).dispose();
  };

  return { body, targetMarker, update, setTrajectory, setVisible, dispose };
}
