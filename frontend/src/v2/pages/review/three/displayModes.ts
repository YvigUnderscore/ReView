// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Modes d'affichage du viewer 3D d'inspection (Phase 39, 39.C) — override **non destructif** des
 * matériaux du modèle : chaque mesh conserve son matériau d'origine dans `userData.__origMaterial`,
 * remplacé par un matériau d'override partagé (une seule instance par mode, réutilisée sur tous les
 * meshes). `shaded` restaure l'original. Purement local au rendu : ne touche jamais au fichier ni à
 * la version (compatible verrou de publication). Helpers testables sans contexte WebGL.
 */

export type DisplayMode = 'shaded' | 'wireframe' | 'normals' | 'matcap' | 'uv';

export const DISPLAY_MODES: DisplayMode[] = ['shaded', 'wireframe', 'normals', 'matcap', 'uv'];

/** Matériaux d'override partagés, construits paresseusement puis réutilisés (et libérés au dispose). */
export interface DisplayResources {
  wireframe: THREE.Material;
  normals: THREE.Material;
  matcap: THREE.Material;
  uv: THREE.Material;
  textures: THREE.Texture[];
  dispose: () => void;
}

/**
 * Damier UV procédural (DataTexture) : cases contrastées + gradient rouge (U) / vert (V) pour
 * révéler l'orientation et l'étirement des UV. Testable (pas de canvas).
 */
export function makeUvCheckerTexture(
  three: typeof import('three'),
  size = 256,
  cells = 8,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const cell = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const checker = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const base = checker ? 210 : 60;
      // Gradient d'orientation : U→rouge (droite), V→vert (haut).
      const u = x / size;
      const v = y / size;
      data[i] = Math.min(255, base + u * 45);
      data[i + 1] = Math.min(255, base + v * 45);
      data[i + 2] = base;
      data[i + 3] = 255;
    }
  }
  const tex = new three.DataTexture(data, size, size, three.RGBAFormat);
  tex.colorSpace = three.SRGBColorSpace;
  tex.wrapS = tex.wrapT = three.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Matcap « argile » procédural (DataTexture) : sphère éclairée douce, pour juger la forme
 * indépendamment des matériaux/textures du modèle. Testable (pas de canvas).
 */
export function makeMatcapTexture(three: typeof import('three'), size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (x - half) / half;
      const ny = (half - y) / half;
      const r2 = nx * nx + ny * ny;
      let shade = 0.12;
      if (r2 <= 1) {
        const nz = Math.sqrt(1 - r2);
        // Lumière haut-droite + rim doux.
        const diffuse = Math.max(0, nx * 0.4 + ny * 0.5 + nz * 0.75);
        const rim = Math.pow(1 - nz, 2) * 0.25;
        shade = Math.min(1, 0.18 + diffuse * 0.8 + rim);
      }
      const c = Math.round(shade * 255);
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  const tex = new three.DataTexture(data, size, size, three.RGBAFormat);
  tex.colorSpace = three.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Construit (une fois) les matériaux d'override partagés + leurs textures procédurales. */
export function createDisplayResources(three: typeof import('three')): DisplayResources {
  const uvTex = makeUvCheckerTexture(three);
  const matcapTex = makeMatcapTexture(three);
  const wireframe = new three.MeshBasicMaterial({ color: 0x8be9fd, wireframe: true });
  const normals = new three.MeshNormalMaterial();
  const matcap = new three.MeshMatcapMaterial({ matcap: matcapTex });
  const uv = new three.MeshBasicMaterial({ map: uvTex });
  return {
    wireframe,
    normals,
    matcap,
    uv,
    textures: [uvTex, matcapTex],
    dispose: () => {
      [wireframe, normals, matcap, uv].forEach((m) => m.dispose());
      [uvTex, matcapTex].forEach((t) => t.dispose());
    },
  };
}

/** Renvoie le matériau d'override d'un mode (ou `null` pour `shaded` = restauration). */
export function overrideMaterialFor(mode: DisplayMode, res: DisplayResources): THREE.Material | null {
  switch (mode) {
    case 'wireframe':
      return res.wireframe;
    case 'normals':
      return res.normals;
    case 'matcap':
      return res.matcap;
    case 'uv':
      return res.uv;
    case 'shaded':
    default:
      return null;
  }
}

type MeshLike = THREE.Object3D & { isMesh?: boolean; material?: THREE.Material | THREE.Material[] };

/**
 * Applique un mode d'affichage à tout le sous-arbre `root` : sauvegarde le matériau d'origine au
 * premier override (dans `userData.__origMaterial`) et le restaure en `shaded`. Idempotent.
 */
export function applyDisplayMode(root: THREE.Object3D, mode: DisplayMode, res: DisplayResources): void {
  const override = overrideMaterialFor(mode, res);
  root.traverse((obj) => {
    const mesh = obj as MeshLike;
    if (!mesh.isMesh || !mesh.material) return;
    if (mesh.userData.__origMaterial === undefined) {
      mesh.userData.__origMaterial = mesh.material;
    }
    mesh.material = override ?? (mesh.userData.__origMaterial as THREE.Material | THREE.Material[]);
  });
}
