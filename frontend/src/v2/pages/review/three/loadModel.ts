// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Target size (largest dimension) of the normalized model, for consistent camera framing. */
export const TARGET_SIZE = 2;

export interface Normalized {
  /** Scale factor applied to the model (brings the largest dimension to TARGET_SIZE). */
  scale: number;
  /** Position of the model after scaling: centered on X/Z, bottom of the bbox resting on `y = 0`. */
  position: THREE.Vector3;
  /** Center of the bbox **after** normalization, the camera framing target (never the origin). */
  center: THREE.Vector3;
  /** Radius of the bounding sphere after scaling (camera framing). */
  radius: number;
}

/**
 * Normalizes a model by its bounding box (Phase 15, V1): unit scale, horizontal centering and
 * **ground contact**, for consistent camera framing whatever the export. Pure and testable (takes
 * an already computed `Box3`).
 *
 * The viewer ground is the plane `y = 0` (`useSceneGrid` grid). V1 moved the bbox **center** to the
 * origin, which systematically sank the lower half of the model below the grid. We now move the
 * **bottom** of the bbox to `y = 0`, so a model resting on the ground in the DCC rests on it in the
 * review as well, and `center` carries the model's real center so the camera aims at the object,
 * not the ground.
 */
export function normalizeTransform(three: typeof import('three'), box: THREE.Box3): Normalized {
  return poseForScale(three, box, normalizationScale(three, box));
}

/** Factor that brings the bbox's largest dimension to `TARGET_SIZE` (1 if the bbox is empty). */
export function normalizationScale(three: typeof import('three'), box: THREE.Box3): number {
  const size = box.getSize(new three.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return maxDim > 0 ? TARGET_SIZE / maxDim : 1;
}

/**
 * Pose of the wrapper for a **given** scale factor. This enables the "real size" toggle
 * (`scale = 1`, the model keeps the units of its file) without reloading anything: normalization
 * is just a special case of this function.
 */
export function poseForScale(three: typeof import('three'), box: THREE.Box3, scale: number): Normalized {
  const size = box.getSize(new three.Vector3());
  const center = box.getCenter(new three.Vector3());
  const radius = box.getBoundingSphere(new three.Sphere()).radius * scale;
  const position = new three.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale);
  return { scale, position, center: new three.Vector3(0, (size.y * scale) / 2, 0), radius };
}

/**
 * Disables frustum culling on deformed meshes (Phase 40, 40.A). The bounding box of a
 * `SkinnedMesh` (or a mesh with morph targets) is frozen at the bind pose and **does not follow**
 * the animated deformation, so Three.js can cull the mesh when it leaves that static box.
 * Returns the number of deformable meshes found (skinning present → 40.B).
 */
export function markDeformableMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isSkinnedMesh?: boolean; morphTargetInfluences?: number[] };
    if (mesh.isSkinnedMesh || (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length)) {
      mesh.frustumCulled = false;
      if (mesh.isSkinnedMesh) count += 1;
    }
  });
  return count;
}

export interface LoadedModel {
  /** Wrapper group carrying the normalization (scale + recentering), added to the scene and
   *  the target of user transforms. The mixer never touches its transform. */
  object: THREE.Object3D;
  /** Original glTF root (child of the wrapper, identity transform), **target of the AnimationMixer**
   *  so that tracks targeting the root node (root motion, scale) do not overwrite the normalization. */
  animRoot: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** Bounding radius after normalization (auto-framing). */
  radius: number;
  /** Model center after normalization, the camera target (the model rests on `y = 0`). */
  center: THREE.Vector3;
  /** glTF extensions declared by the file (`extensionsUsed`), for the tech sheet (39.C). */
  extensions: string[];
  /** Number of `SkinnedMesh` (rig present → enables the skeleton debug view, 40.B). */
  skinnedCount: number;
  /** Normalization factor applied, **kept** for the "real size" toggle. */
  scale: number;
  /** Raw bounding box, in the file's units: real dimensions and measurements. */
  box: THREE.Box3;
  /** Loaded glTF object (parser + userData.variants + cameras), embedded variants and cameras (40.C). */
  gltf: GLTF;
}

/**
 * Loads a GLB/glTF via `GLTFLoader` and normalizes it (V1). The backend already converts
 * FBX/OBJ/USD to GLB (9.A1), so DRACO/KTX2 stay optional (not wired by default).
 *
 * Phase 40 (40.A): the normalization is carried by a **`Group` wrapper**; the glTF scene stays at
 * identity and serves as the mixer target, so an animation track on the root node no longer breaks
 * the framing. Deformable meshes are exempted from frustum culling (reliable skinning).
 */
export async function loadModel(
  three: typeof import('three'),
  loader: GLTFLoader,
  url: string,
): Promise<LoadedModel> {
  const gltf: GLTF = await loader.loadAsync(url);
  const animRoot = gltf.scene;
  const box = new three.Box3().setFromObject(animRoot);
  const { scale, position, center, radius } = normalizeTransform(three, box);
  // Normalization wrapper: the glTF scene stays intact (identity transform).
  const object = new three.Group();
  object.name = 'model-normalized';
  object.scale.setScalar(scale);
  object.position.copy(position);
  object.add(animRoot);
  const skinnedCount = markDeformableMeshes(animRoot);
  const json = (gltf.parser?.json ?? {}) as { extensionsUsed?: unknown };
  const extensions = Array.isArray(json.extensionsUsed) ? (json.extensionsUsed as string[]) : [];
  return {
    object,
    animRoot,
    animations: gltf.animations ?? [],
    radius,
    center,
    extensions,
    skinnedCount,
    scale,
    box,
    gltf,
  };
}
