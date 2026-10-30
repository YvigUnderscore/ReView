// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

/** Spark/Three modules imported dynamically (out of the initial bundle), passed to `createScene`. */
export interface SplatModules {
  THREE: typeof import('three');
  OrbitControls: typeof OrbitControls;
  SparkRenderer: typeof SparkRenderer;
  SplatMesh: typeof SplatMesh;
}

/** Core of a splat's Three.js scene (without the mesh, added after loading). */
export interface SplatSceneCore {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  spark: SparkRenderer;
}

/**
 * Mounts the WebGL2 renderer, the scene, the perspective camera, the OrbitControls (damping) and
 * the SparkRenderer, and attaches the canvas to `container`. Extracted from `useSplat`: the
 * "scene" layer knows neither editing nor React state; the orchestrator manages the lifecycle.
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
