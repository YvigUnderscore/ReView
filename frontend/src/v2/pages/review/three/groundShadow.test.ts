import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setGroundShadow } from './groundShadow';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';

function makeHandle() {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  scene.add(key, fill);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  scene.add(root);
  const renderer = { shadowMap: { enabled: false, type: 0 } };
  const handle = { THREE, scene, renderer, mesh: root } as unknown as ViewerSceneHandle;
  return { handle, scene, key, fill, mesh, renderer };
}

const planeOf = (scene: THREE.Scene) =>
  scene.children.find(
    (o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.ShadowMaterial,
  );

describe("groundShadow — sol récepteur d'ombres (39.F)", () => {
  it('ajoute un plan ShadowMaterial et arme la key light quand activé', () => {
    const { handle, scene, key, fill, mesh, renderer } = makeHandle();
    setGroundShadow(handle, true);

    const plane = planeOf(scene) as THREE.Mesh | undefined;
    expect(plane).toBeDefined();
    expect(plane!.receiveShadow).toBe(true);
    expect((plane!.material as THREE.ShadowMaterial).isShadowMaterial).toBe(true);
    // Key light = la plus intense ; la fill reste sans ombre.
    expect(key.castShadow).toBe(true);
    expect(fill.castShadow).toBe(false);
    // Le modèle projette des ombres, le shadow map est actif.
    expect(mesh.castShadow).toBe(true);
    expect(renderer.shadowMap.enabled).toBe(true);
  });

  it('positionne le sol au bas de la boîte englobante du modèle', () => {
    const { handle, scene, mesh } = makeHandle();
    mesh.position.set(2, 5, -1); // décale le modèle
    setGroundShadow(handle, true);
    const plane = planeOf(scene) as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(mesh);
    expect(plane.position.y).toBeCloseTo(box.min.y, 5);
    expect(plane.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('retire le plan et désactive tout quand désactivé', () => {
    const { handle, scene, key, renderer } = makeHandle();
    setGroundShadow(handle, true);
    setGroundShadow(handle, false);
    expect(planeOf(scene)).toBeUndefined();
    expect(key.castShadow).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(scene.userData.__groundShadow).toBeUndefined();
  });

  it('est idempotent : un seul plan après plusieurs activations', () => {
    const { handle, scene } = makeHandle();
    setGroundShadow(handle, true);
    setGroundShadow(handle, true);
    const planes = scene.children.filter(
      (o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).material instanceof THREE.ShadowMaterial,
    );
    expect(planes).toHaveLength(1);
  });

  it('sans renderer, ne fait rien', () => {
    const { scene, mesh } = makeHandle();
    const handle = { THREE, scene, mesh } as unknown as ViewerSceneHandle;
    expect(() => setGroundShadow(handle, true)).not.toThrow();
    expect(planeOf(scene)).toBeUndefined();
  });
});
