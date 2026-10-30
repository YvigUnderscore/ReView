// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Shared imperative handle to the Three scene of a review viewer (Phase 17) — satisfied by the
 * splat (`SplatSceneHandle`) and the 3D viewer (`useModel3DThree`). Cross-cutting hooks (gizmos,
 * camera object, framing) only consume this interface: one code path for both viewers.
 */
export interface ViewerSceneHandle {
  THREE: typeof import('three');
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  dom: HTMLElement;
  /** WebGL renderer — required for HDRI lighting (PMREM, exposure), 3D (Phase 29). */
  renderer?: THREE.WebGLRenderer;
  /** Main manipulable object (SplatMesh on the splat side, `root` group on the 3D side) — default
   *  target of the transform gizmos. */
  mesh?: THREE.Object3D;
  /** Object of the loaded main model (3D only) — target of the A/B comparison (39.E). */
  modelObject?: THREE.Object3D;
  /** Loaded glTF (3D only) — material variants & embedded cameras (40.C). */
  gltf?: GLTF;
}

/** Minimal contract of a viewer exposing its scene (parameter of cross-cutting hooks). */
export interface SceneViewer {
  ready: boolean;
  getSceneHandle: () => ViewerSceneHandle | null;
}
