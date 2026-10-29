// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';

/**
 * Display modes of the 3D inspection viewer (Phase 39, 39.C): **non-destructive** override of the model's
 * materials: each mesh keeps its original material in `userData.__origMaterial`, replaced by a shared
 * override material (one instance per mode, reused on all meshes). `shaded` restores the original.
 * Purely local to rendering: never touches the file or the version (compatible with the publication lock).
 */

export type DisplayMode = 'shaded' | 'wireframe' | 'normals' | 'matcap' | 'uv';

export const DISPLAY_MODES: DisplayMode[] = ['shaded', 'wireframe', 'normals', 'matcap', 'uv'];

/** Shared override materials, built lazily then reused (and freed on dispose). */
export interface DisplayResources {
  wireframe: THREE.Material;
  normals: THREE.Material;
  matcap: THREE.Material;
  uv: THREE.Material;
  textures: THREE.Texture[];
  dispose: () => void;
}

/**
 * Procedural UV checker (DataTexture): contrasting squares plus a red (U) / green (V) gradient
 * to reveal the orientation and stretching of the UVs. Testable (no canvas).
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
      // Orientation gradient: U to red (right), V to green (top).
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
 * Procedural "clay" matcap (DataTexture): a soft-lit sphere, to judge the shape independently
 * of the model's materials and textures. Testable (no canvas).
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
        // Top-right light and soft rim.
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

/** Builds (once) the shared override materials and their procedural textures. */
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

/** Returns the override material of a mode (or `null` for `shaded`, i.e. restoration). */
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
 * Applies a display mode to the whole `root` subtree: saves the original material at the first
 * override (in `userData.__origMaterial`) and restores it for `shaded`. Idempotent.
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
