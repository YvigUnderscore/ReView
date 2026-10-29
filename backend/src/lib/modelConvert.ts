// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { extname } from 'node:path';

/**
 * 3D → GLB conversion routing (Phase 39, 39.A). **Pure and testable** logic, extracted from the worker: choice of the
 * main model file of an archive, choice of the converter according to the source format, format label for the technical
 * sheet. The worker plugs the real binaries (assimp, native USD converter such as `guc`) into these decisions.
 *
 * USD (Phase 45): conversion goes through headless Blender, which embeds full OpenUSD (composition, materials,
 * animation). The native converter `guc` remains accepted as second choice and assimp as a last resort, each fallback
 * being automatic — zero regression.
 */

/** Uncompressed USD extensions (the `.usdz` container is treated as an archive). */
export const USD_EXTENSIONS = ['.usd', '.usdc', '.usda'] as const;

/**
 * Priority order for picking the main model file in an archive (`.zip`/`.usdz`).
 * Caution: this ranking is not enough when the winner is a USD file — a USD archive contains several layers and `.usdc`
 * would precede `.usda`, designating a payload rather than the root. The caller then chains on
 * `usdArchive.pickUsdRootLayer` (Phase 45, 45.A).
 */
export const MODEL_PRIORITY = ['.gltf', '.glb', '.fbx', '.obj', '.dae', '.stl', '.usdc', '.usda', '.usd'];

/** Converter selected to produce the GLB (recorded in `metadata.model.converter`). */
export type ModelConverter = 'copy' | 'gltf' | 'blender' | 'usd' | 'assimp';

/** True if the extension designates an uncompressed USD file (usd/usdc/usda). */
export function isUsdModel(ext: string): boolean {
  return (USD_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * Picks the highest-priority model file from a list (extracted archive contents).
 * Returns `null` if no recognised 3D format (textures/attachments ignored).
 */
export function pickModelFile(paths: string[]): string | null {
  let chosen: string | null = null;
  let bestRank = Infinity;
  for (const p of paths) {
    const rank = MODEL_PRIORITY.indexOf(extname(p).toLowerCase());
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      chosen = p;
    }
  }
  return chosen;
}

/**
 * Decides the converter of a file according to its extension and the available tooling.
 * `.glb` → direct copy; `.gltf` → JS packer; others (fbx/obj/dae/stl…) → assimp.
 *
 * For USD, the order of preference reflects the fidelity obtained (Phase 45):
 * **Blender** (full OpenUSD: composition, materials, animated UsdSkel) → native converter such as `guc` (faithful
 * materials but static geometry) → assimp (last resort, without USD support in the usual Debian packages: the
 * conversion will fail with an explicit message).
 */
export function chooseConverter(
  ext: string,
  opts: { usdConverter: boolean; blender?: boolean },
): ModelConverter {
  const e = ext.toLowerCase();
  if (e === '.glb') return 'copy';
  if (e === '.gltf') return 'gltf';
  if (isUsdModel(e)) {
    if (opts.blender) return 'blender';
    return opts.usdConverter ? 'usd' : 'assimp';
  }
  return 'assimp';
}

/** Source format label (technical sheet 39.C) derived from the original extension. */
export function sourceFormatLabel(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    glb: 'glTF (binaire)',
    gltf: 'glTF',
    fbx: 'FBX',
    obj: 'OBJ',
    dae: 'COLLADA',
    stl: 'STL',
    usd: 'USD',
    usdc: 'USD (binaire)',
    usda: 'USD (ASCII)',
    usdz: 'USDZ',
    zip: 'Archive 3D',
  };
  return map[e] ?? e.toUpperCase();
}
