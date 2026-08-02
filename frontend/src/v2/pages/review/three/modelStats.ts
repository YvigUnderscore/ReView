// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Fiche technique du modèle 3D (Phase 39, 39.C) : parcourt le sous-arbre chargé pour compter
 * géométrie (triangles/sommets/meshes), lister les matériaux, les jeux d'UV et les textures (par
 * canal). Purement lecture — aucune mutation de la scène. Testable sans contexte WebGL.
 */

/** Canaux de texture inspectés (slots standard glTF/Three). */
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
] as const;

export type TextureSlot = (typeof TEXTURE_SLOTS)[number];

export interface TextureInfo {
  slot: TextureSlot;
  /** Matériau porteur (pour regrouper dans l'inspecteur). */
  material: string;
  name: string;
  width: number;
  height: number;
  /** Référence Three (pour l'aperçu par canal — non sérialisable). */
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
  /** Jeux d'UV présents (ex. `['uv', 'uv1']`) — utile pour le lightmap/AO. */
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

/** Collecte la fiche technique complète du modèle (`root` = objet normalisé chargé). */
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
        materials.set(mat, { name: mat.name || '(sans nom)', type: materialType(mat) });
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
          material: mat.name || '(sans nom)',
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
