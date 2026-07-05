import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

/** Modules Spark/Three importés dynamiquement (hors bundle initial), passés à `createScene`. */
export interface SplatModules {
  THREE: typeof import('three');
  OrbitControls: typeof OrbitControls;
  SparkRenderer: typeof SparkRenderer;
  SplatMesh: typeof SplatMesh;
}

/** Cœur de la scène Three.js d'un splat (sans le mesh, ajouté après chargement). */
export interface SplatSceneCore {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  spark: SparkRenderer;
}

/**
 * Monte le renderer WebGL2, la scène, la caméra perspective, les OrbitControls (damping) et le
 * SparkRenderer, et branche le canvas dans `container`. Extrait de `useSplat` — la couche
 * « scène » ne connaît ni l'édition ni l'état React ; l'orchestrateur gère le cycle de vie.
 */
export function createScene(
  { THREE, OrbitControls, SparkRenderer }: SplatModules,
  container: HTMLElement,
): SplatSceneCore {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(0, 0, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  return { renderer, scene, camera, controls, spark };
}
