import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';

const GROUND_KEY = '__groundShadow';

interface GroundShadowState {
  plane: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.ShadowMaterial;
}

/**
 * Sol invisible récepteur d'ombres portées du modèle (39.F). Non destructif : ajoute un plan
 * `ShadowMaterial` transparent sous le modèle, active la **key light** (la directionnelle la plus
 * intense de la scène) comme source d'ombres et le shadow map du renderer. Idempotent — l'état est
 * mémorisé dans `scene.userData.__groundShadow` (reconstruit si le modèle change). `enabled=false`
 * retire le plan, coupe l'ombre de la key light et désactive le shadow map.
 *
 * L'intensité de la key light (atténuée par l'HDRI, cf. `applyLighting`) n'affecte pas le rendu de
 * l'ombre : `ShadowMaterial` peint uniquement le masque d'ombre, d'opacité `SHADOW_OPACITY`.
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

  // Boîte englobante du modèle → position/taille du sol et cadrage de la caméra d'ombre.
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const extent = Math.max(size.x, size.z) || 1;

  // Le modèle projette des ombres (le sol les reçoit).
  mesh.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });

  if (key) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    const cam = key.shadow.camera as THREE.OrthographicCamera;
    const r = extent * 1.5;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.01;
    cam.far = extent * 20 + 20;
    cam.updateProjectionMatrix();
  }

  // Reconstruit le plan (le modèle a pu changer de taille/position depuis le dernier appel).
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

/** Renvoie la lumière directionnelle la plus intense (key light), en s'appuyant sur `baseIntensity`
 *  quand l'HDRI a atténué l'intensité courante (cf. `applyLighting`). */
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
