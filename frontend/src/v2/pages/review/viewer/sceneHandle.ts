import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Poignée impérative commune vers la scène Three d'un viewer de review (Phase 17) — satisfaite
 * par le splat (`SplatSceneHandle`) et le viewer 3D (`useModel3DThree`). Les hooks transverses
 * (gizmos, caméra-objet, cadrage) ne consomment que cette interface : un seul code pour les
 * deux viewers.
 */
export interface ViewerSceneHandle {
  THREE: typeof import('three');
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  dom: HTMLElement;
  /** Renderer WebGL — requis pour l'éclairage HDRI (PMREM, exposition), 3D (Phase 29). */
  renderer?: THREE.WebGLRenderer;
  /** Objet principal manipulable (SplatMesh côté splat, groupe `root` côté 3D) — cible par
   *  défaut des gizmos de transformation. */
  mesh?: THREE.Object3D;
  /** Objet du modèle principal chargé (3D uniquement) — cible de la comparaison A/B (39.E). */
  modelObject?: THREE.Object3D;
}

/** Contrat minimal d'un viewer exposant sa scène (paramètre des hooks transverses). */
export interface SceneViewer {
  ready: boolean;
  getSceneHandle: () => ViewerSceneHandle | null;
}
