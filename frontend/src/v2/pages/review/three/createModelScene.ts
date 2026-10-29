// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureRenderer } from './sceneConfig';

/** Three modules dynamically imported (out of the initial bundle), passed to `createModelScene`. */
export interface ModelSceneModules {
  THREE: typeof import('three');
  OrbitControls: typeof OrbitControls;
}

/** Core of the Three scene of a GLB model (the model is added to `root` after loading). */
export interface ModelScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Parent of the loaded model: carries the user transform (gizmo, orientation). */
  root: THREE.Group;
  dispose: () => void;
}

/**
/**
 * Common 3D/splat Three base (Phase 15, V0): WebGL2 renderer (sRGB and ACES colour management),
 * scene, perspective camera, OrbitControls (damping, controls close to model-viewer), and a neutral
 * default lighting (before the HDRI, V4). Impure (it instantiates the renderer): the testable logic
 * is extracted into `sceneConfig`. The orchestrator (`useModel3DThree`) manages the lifecycle and the loop.
 */
export function createModelScene(
  { THREE, OrbitControls }: ModelSceneModules,
  container: HTMLElement,
): ModelScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  configureRenderer(THREE, renderer);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(0, 0, 3);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Neutral default lighting (before an HDRI is applied, V4): the model stays readable.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a35, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  const root = new THREE.Group();
  scene.add(root);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controls.dispose();
    // `renderer.dispose()` only frees Three's JS caches (three 0.183: renderLists,
    // renderStates, properties, objects, bindingStates, programCache, xr). Neither the geometries,
    // nor the materials, nor the textures of the loaded model: the scene must be traversed (F9).
    disposeSceneTree(scene);
    renderer.dispose();
    // The WebGL context itself: Chrome caps the number of simultaneous contexts, and an
    // abandoned context makes the oldest canvas lose (black viewer) after a few round trips
    // between versions of the same asset.
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, controls, root, dispose };
}

/** GPU resources actually freed: a measurable quantity (`dispose` tests). */
export interface DisposeCounts {
  geometries: number;
  materials: number;
  textures: number;
}

const isTexture = (value: unknown): value is THREE.Texture =>
  !!value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture === true;

/**
 * Frees geometries, materials and textures of a whole scene subtree (F9). `seen` de-duplicates:
 * a material or texture shared by several meshes (the common case of a GLB, and that of scene-staging
 * clones, which share geometry and materials with their source) is freed **only once**, and the
 * report stays correct.
 *
 * Two resources are deliberately spared:
 * - `scene.environment` / `scene.background` (pre-filtered HDRI map): they belong to
 *   `useModel3DLighting`, which frees them on its side and may keep them from one scene to the next.
 *   The traversal only follows the materials carried by objects, never these two fields.
 * - Everything already in `seen`: the caller may put in it the textures that another viewer still
 *   uses, so that they survive the teardown of this one.
 */
export function disposeSceneTree(root: THREE.Object3D, seen = new Set<object>()): DisposeCounts {
  const counts: DisposeCounts = { geometries: 0, materials: 0, textures: 0 };

  const disposeTexture = (texture: THREE.Texture) => {
    if (seen.has(texture)) return;
    seen.add(texture);
    texture.dispose();
    counts.textures += 1;
  };

  const disposeMaterial = (material: THREE.Material) => {
    if (seen.has(material)) return;
    seen.add(material);
    // Textures are looked up in the material's **properties** rather than in a list of names
    // (map, normalMap, roughnessMap…): a slot added by a glTF extension (KHR_materials_*) would
    // otherwise be left on the GPU at every load.
    for (const value of Object.values(material)) if (isTexture(value)) disposeTexture(value);
    // ShaderMaterial: textures live in `uniforms[x].value`, outside the properties.
    const uniforms = (material as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
    if (uniforms) for (const u of Object.values(uniforms)) if (isTexture(u?.value)) disposeTexture(u.value);
    material.dispose();
    counts.materials += 1;
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geometry?.dispose && !seen.has(geometry)) {
      seen.add(geometry);
      geometry.dispose();
      counts.geometries += 1;
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material?.dispose) disposeMaterial(material);
  });

  return counts;
}
