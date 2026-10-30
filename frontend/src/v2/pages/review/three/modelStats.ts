// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { t } from '@/v2/i18n';

/**
 * Tech sheet of the 3D model (Phase 39, 39.C): walks the loaded subtree to count geometry
 * (triangles/vertices/meshes), and to list materials, UV sets and textures (per channel).
 * Read-only — no scene mutation. Testable without a WebGL context.
 */

/**
 * Inspected texture channels.
 *
 * The first nine are the slots of the base glTF (`MeshStandardMaterial`). The following ones come
 * from the `KHR_materials_*` extensions, which Three's glTF loader resolves on its own into
 * `MeshPhysicalMaterial`: the viewer already **rendered** them, but the tech sheet did not scan
 * them — a glass or varnish shader therefore showed no texture, and the cause was looked for
 * elsewhere (weight, blur). The order follows that of the extensions
 * (clearcoat, transmission, volume, sheen, specular, iridescence, anisotropy).
 */
export const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'clearcoatMap',
  'clearcoatRoughnessMap',
  'clearcoatNormalMap',
  'transmissionMap',
  'thicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularIntensityMap',
  'specularColorMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
  'lightMap',
] as const;

export type TextureSlot = (typeof TEXTURE_SLOTS)[number];

export interface TextureInfo {
  slot: TextureSlot;
  /** Owning material (to group them in the inspector). */
  material: string;
  name: string;
  width: number;
  height: number;
  /** Three reference (for the per-channel preview — not serializable). */
  texture: THREE.Texture;
}

export interface MaterialInfo {
  name: string;
  type: string;
}

export interface ModelStats {
  meshes: number;
  triangles: number;
  vertices: number;
  materials: MaterialInfo[];
  /** UV sets present (e.g. `['uv', 'uv1']`) — useful for lightmap/AO. */
  uvSets: string[];
  textures: TextureInfo[];
}

type MeshLike = THREE.Object3D & {
  isMesh?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

function materialType(m: THREE.Material): string {
  return m.type || m.constructor?.name || 'Material';
}

/** Collects the full tech sheet of the model (`root` = the loaded normalized object). */
export function collectModelStats(root: THREE.Object3D): ModelStats {
  let meshes = 0;
  let triangles = 0;
  let vertices = 0;
  const materials = new Map<THREE.Material, MaterialInfo>();
  const uvSets = new Set<string>();
  const textures: TextureInfo[] = [];
  const seenTex = new Set<string>();

  root.traverse((obj) => {
    const mesh = obj as MeshLike;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes++;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (pos) vertices += pos.count;
    const triCount = geo.index ? geo.index.count / 3 : pos ? pos.count / 3 : 0;
    triangles += Math.floor(triCount);
    for (const name of Object.keys(geo.attributes)) {
      if (name === 'uv' || name.startsWith('uv')) uvSets.add(name);
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mat of mats) {
      if (!materials.has(mat))
        materials.set(mat, { name: mat.name || t('model3d.unnamed'), type: materialType(mat) });
      const record = mat as unknown as Record<string, THREE.Texture | undefined>;
      for (const slot of TEXTURE_SLOTS) {
        const tex = record[slot];
        if (!tex || !tex.image) continue;
        const key = `${tex.uuid}:${slot}`;
        if (seenTex.has(key)) continue;
        seenTex.add(key);
        const image = tex.image as { width?: number; height?: number };
        textures.push({
          slot,
          material: mat.name || t('model3d.unnamed'),
          name: tex.name || slot,
          width: image.width ?? 0,
          height: image.height ?? 0,
          texture: tex,
        });
      }
    }
  });

  return {
    meshes,
    triangles,
    vertices,
    materials: [...materials.values()],
    uvSets: [...uvSets].sort(),
    textures,
  };
}
