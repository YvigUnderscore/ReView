// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';

const GROUND_KEY = '__groundShadow';

interface GroundShadowState {
  plane: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.ShadowMaterial;
}

/**
 * Invisible ground receiving the model's cast shadows (39.F). Non-destructive: adds a transparent
 * `ShadowMaterial` plane under the model, activates the **key light** (the most intense directional
 * light of the scene) as a shadow source, and the renderer's shadow map. Idempotent: the state is kept
 * in `scene.userData.__groundShadow` (rebuilt if the model changes). `enabled=false` removes the plane,
 * cuts the key light's shadow and disables the shadow map.
 *
 * The plane follows the model's `box.min.y` **as it is in the scene**: the normalisation puts the model
 * on `y = 0`, so it coincides with the grid while the user transform is neutral, and it keeps following
 * it otherwise.
 *
 * The key light's intensity (attenuated by the HDRI, cf. `applyLighting`) does not affect the shadow's
 * rendering: `ShadowMaterial` only paints the shadow mask, with opacity `SHADOW_OPACITY`.
 */
const SHADOW_OPACITY = 0.35;

export function setGroundShadow(handle: ViewerSceneHandle, enabled: boolean): void {
  const { THREE, scene, renderer, mesh } = handle;
  if (!renderer) return;
  const existing = scene.userData[GROUND_KEY] as GroundShadowState | undefined;
  const key = brightestDirectional(scene);

  if (!enabled) {
    if (existing) disposeGround(scene, existing);
    if (key) key.castShadow = false;
    renderer.shadowMap.enabled = false;
    return;
  }
  if (!mesh) return;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Model bounding box: position and size of the ground, and framing of the shadow camera.
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const extent = Math.max(size.x, size.z) || 1;

  // The model casts shadows (the ground receives them).
  mesh.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });

  if (key) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    const cam = key.shadow.camera;
    const r = extent * 1.5;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.01;
    cam.far = extent * 20 + 20;
    cam.updateProjectionMatrix();
  }

  // Rebuilds the plane (the model may have changed size or position since the last call).
  if (existing) disposeGround(scene, existing);
  const planeSize = extent * 6;
  const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
  const material = new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY });
  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(center.x, box.min.y, center.z);
  plane.receiveShadow = true;
  scene.add(plane);
  scene.userData[GROUND_KEY] = { plane, geometry, material } satisfies GroundShadowState;
}

function disposeGround(scene: THREE.Scene, state: GroundShadowState): void {
  scene.remove(state.plane);
  state.geometry.dispose();
  state.material.dispose();
  delete scene.userData[GROUND_KEY];
}

/** Returns the most intense directional light (key light), relying on `baseIntensity`
 *  when the HDRI attenuated the current intensity (cf. `applyLighting`). */
function brightestDirectional(scene: THREE.Scene): THREE.DirectionalLight | null {
  let best: THREE.DirectionalLight | null = null;
  let bestBase = -1;
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (!l.isDirectionalLight) return;
    const base = (l.userData.baseIntensity as number | undefined) ?? l.intensity;
    if (base > bestBase) {
      best = l;
      bestBase = base;
    }
  });
  return best;
}
