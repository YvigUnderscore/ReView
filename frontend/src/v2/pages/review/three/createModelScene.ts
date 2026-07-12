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

  const dispose = () => {
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, controls, root, dispose };
}
