// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configureRenderer } from './sceneConfig';

/** Modules Three importés dynamiquement (hors bundle initial), passés à `createModelScene`. */
export interface ModelSceneModules {
  THREE: typeof import('three');
  OrbitControls: typeof OrbitControls;
}

/** Cœur de la scène Three d'un modèle GLB (le modèle est ajouté à `root` après chargement). */
export interface ModelScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Parent du modèle chargé — porte la transformation utilisateur (gizmo, orientation). */
  root: THREE.Group;
  dispose: () => void;
}

/**
 * Socle Three commun 3D/splat (Phase 15, V0) : renderer WebGL2 (gestion de couleur sRGB + ACES),
 * scène, caméra perspective, OrbitControls (damping, contrôles proches de model-viewer), éclairage
 * neutre par défaut (avant HDRI, V4). Impur (instancie le renderer) — logique testable extraite
 * dans `sceneConfig`. L'orchestrateur (`useModel3DThree`) gère le cycle de vie et la boucle.
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

  // Éclairage neutre par défaut (avant application d'une HDRI, V4) : le modèle reste lisible.
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
    // `renderer.dispose()` ne libère que les caches JS de Three (three 0.183 : renderLists,
    // renderStates, properties, objects, bindingStates, programCache, xr). Ni les géométries,
    // ni les matériaux, ni les textures du modèle chargé — il faut parcourir la scène (F9).
    disposeSceneTree(scene);
    renderer.dispose();
    // Le contexte WebGL lui-même : Chrome plafonne le nombre de contextes simultanés, et un
    // contexte abandonné fait perdre le plus ancien canvas (viewer noir) après quelques
    // allers-retours entre versions d'un même asset.
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, controls, root, dispose };
}

/** Ressources GPU effectivement libérées — grandeur mesurable (tests de `dispose`). */
export interface DisposeCounts {
  geometries: number;
  materials: number;
  textures: number;
}

const isTexture = (value: unknown): value is THREE.Texture =>
  !!value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture === true;

/**
 * Libère géométries, matériaux et textures de tout un sous-arbre de scène (F9). `seen` dédoublonne :
 * un matériau ou une texture partagés par plusieurs maillages — le cas courant d'un GLB, et celui
 * des clones de mise en scène, qui partagent géométrie et matériaux avec leur source — ne sont
 * libérés **qu'une fois**, et le compte rendu reste juste.
 *
 * Deux ressources sont volontairement épargnées :
 * - `scene.environment` / `scene.background` (carte HDRI pré-filtrée) : elles appartiennent à
 *   `useModel3DLighting`, qui les libère de son côté et peut les garder d'une scène à l'autre.
 *   Le parcours ne suit que les matériaux portés par les objets, jamais ces deux champs.
 * - Tout ce qui figure déjà dans `seen` : l'appelant peut y déposer les textures qu'un autre
 *   viewer utilise encore, pour qu'elles survivent au démontage de celui-ci.
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
    // Les textures sont cherchées dans les **propriétés** du matériau plutôt que dans une liste
    // de noms (map, normalMap, roughnessMap…) : un slot ajouté par une extension glTF
    // (KHR_materials_*) serait sinon laissé sur le GPU à chaque chargement.
    for (const value of Object.values(material)) if (isTexture(value)) disposeTexture(value);
    // ShaderMaterial : les textures vivent dans `uniforms[x].value`, hors des propriétés.
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
