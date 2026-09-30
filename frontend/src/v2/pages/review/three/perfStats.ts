// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TextureInfo } from './modelStats';

/**
 * Compteurs de performance du viewer 3D : ce que le renderer déclare à chaque frame (draw
 * calls, triangles réellement dessinés, objets en mémoire) plus une estimation de la mémoire
 * texture, que Three ne chiffre pas (`renderer.info.memory.textures` n'est qu'un **nombre**
 * de textures). Le superviseur qui demande « pourquoi ça rame ? » lit ces quatre chiffres.
 *
 * Purement arithmétique et testable : la lecture du renderer vit dans `useModel3DThree`.
 */

/** Métriques lues sur le renderer à la fin d'une frame. */
export interface ModelPerfSample {
  /** Appels de rendu WebGL (`renderer.info.render.calls`). */
  calls: number;
  /** Triangles réellement dessinés (`renderer.info.render.triangles`). */
  triangles: number;
  /** Géométries résidentes en mémoire GPU (`renderer.info.memory.geometries`). */
  geometries: number;
  /** Textures résidentes en mémoire GPU (`renderer.info.memory.textures`). */
  textures: number;
}

export type ModelPerf = { fps: number } & ModelPerfSample;

/** Budget de triangles au-delà duquel le viewer prévient (ordre de grandeur d'un plan lourd). */
export const TRIANGLE_BUDGET = 1_500_000;

/** Surcoût de la chaîne de mipmaps : 1 + 1/4 + 1/16 + … ≈ 4/3 du niveau 0. */
const MIPMAP_FACTOR = 4 / 3;

/**
 * Mémoire texture estimée, en octets : chaque texture distincte compte `largeur × hauteur × 4`
 * (RGBA8 décompressé, ce que produit le décodage d'un PNG/JPEG glTF), majoré des mipmaps.
 * Une texture apparaissant sur plusieurs canaux ou plusieurs matériaux n'est comptée qu'une
 * fois — c'est la même ressource GPU.
 */
export function estimateTextureBytes(
  textures: readonly Pick<TextureInfo, 'width' | 'height' | 'name'>[],
  withMipmaps = true,
): number {
  const seen = new Set<string>();
  let bytes = 0;
  for (const tex of textures) {
    const w = Number.isFinite(tex.width) ? Math.max(0, tex.width) : 0;
    const h = Number.isFinite(tex.height) ? Math.max(0, tex.height) : 0;
    if (w === 0 || h === 0) continue;
    const key = `${tex.name}:${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bytes += w * h * 4;
  }
  return Math.round(withMipmaps ? bytes * MIPMAP_FACTOR : bytes);
}

/** Mégaoctets arrondis au dixième — unité d'affichage des mémoires du panneau. */
export function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** Millions de triangles arrondis au dixième — unité de l'avertissement de budget. */
export function megaTriangles(triangles: number): number {
  return Math.round((triangles / 1_000_000) * 10) / 10;
}

/** Vrai au-delà du budget de triangles : le panneau affiche alors un avertissement. */
export function overTriangleBudget(triangles: number, budget = TRIANGLE_BUDGET): boolean {
  return triangles > budget;
}
