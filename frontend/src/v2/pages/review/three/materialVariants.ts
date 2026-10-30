// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * glTF `KHR_materials_variants` material variants (Phase 40, 40.C): switches a mesh's materials
 * according to the selected variant (e.g. several colorways of the same asset). Three.js'
 * `GLTFLoader` exposes the names in `gltf.userData.variants` and, per mesh, the variant→material
 * mapping in `mesh.userData.gltfExtensions.KHR_materials_variants.mappings`.
 * The actual material is lazily loaded via `gltf.parser.getDependency('material', i)`.
 */

/** Mapping of a mesh: which material index to use for which variants. */
export interface VariantMapping {
  material: number;
  variants: number[];
}

interface VariantParser {
  getDependency(type: 'material', index: number): Promise<THREE.Material>;
  assignFinalMaterial?: (mesh: THREE.Mesh) => void;
}

/** Names of the variants declared by the file (`[]` if the extension is absent). */
export function readVariants(gltf: GLTF): string[] {
  const v = (gltf.userData as { variants?: unknown }).variants;
  return Array.isArray(v) ? v.map((n) => String(n)) : [];
}

/**
 * Picks the material index to apply for a variant (pure, testable). `variantIndex < 0`
 * (default) or no matching mapping → `null` (restore the original material).
 */
export function pickVariantMaterialIndex(mappings: VariantMapping[], variantIndex: number): number | null {
  if (variantIndex < 0) return null;
  const mapping = mappings.find((m) => m.variants.includes(variantIndex));
  return mapping ? mapping.material : null;
}

interface VariantMeshUserData {
  gltfExtensions?: { KHR_materials_variants?: { mappings?: VariantMapping[] } };
  originalMaterial?: THREE.Material | THREE.Material[];
}

/**
 * Applies variant `variantIndex` to the whole subtree (`-1` = original materials). Remembers
 * each mesh's original material on the first pass (non-destructive restore). Async: materials
 * are loaded on demand by the glTF parser.
 */
export async function applyVariant(gltf: GLTF, root: THREE.Object3D, variantIndex: number): Promise<void> {
  const parser = gltf.parser as unknown as VariantParser;
  const tasks: Promise<void>[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isMesh?: boolean };
    const ud = mesh.userData as VariantMeshUserData;
    const mappings = ud.gltfExtensions?.KHR_materials_variants?.mappings;
    if (!mesh.isMesh || !mappings) return;
    if (!ud.originalMaterial) ud.originalMaterial = mesh.material;
    const index = pickVariantMaterialIndex(mappings, variantIndex);
    if (index == null) {
      if (ud.originalMaterial) mesh.material = ud.originalMaterial;
      return;
    }
    tasks.push(
      parser.getDependency('material', index).then((mat) => {
        mesh.material = mat;
        parser.assignFinalMaterial?.(mesh); // (Re)configure skinning/vertex colors on the material
      }),
    );
  });
  await Promise.all(tasks);
}
