// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isUsdModel } from './modelConvert';

/**
 * Choice of the **root layer** of a USD scene delivered as an archive (Phase 45, 45.A). Pure and
 * testable logic: the worker provides the list of extracted files and, if the `pxr` analyzer is
 * available, the dependency graph between layers; this function designates the layer to open.
 *
 * Why it is not trivial: a realistic USD delivery contains several `.usd*` files: an ASCII root
 * layer (`scene.usda`) that references binary payloads (`payload/body.usdc`), themselves
 * referencing materials. The extension-based ranking of `pickModelFile` places `.usdc` before
 * `.usda`: without this module, we opened a **payload** instead of the root, and the review only
 * displayed a piece of the scene.
 *
 * Main criterion: the root is the layer **that no other layer of the archive references**.
 * Without a graph (analyzer absent) or in case of a tie, we break ties with stable heuristics.
 */

/** USD dependencies of a layer, as reported by the analyzer (`analyze_usd.py`). */
export interface UsdLayerDep {
  /** Source layer (path in the archive, absolute or relative). */
  layer: string;
  /** USD layers it references: sublayers, references, payloads, clips. */
  deps: string[];
}

/** Conventional file names for a root layer, from most to least likely. */
export const USD_ROOT_HINTS = ['scene', 'root', 'main', 'asset', 'world', 'shot', 'stage'];

/** POSIX-separated path (archives mix `/` and `\`). */
const toPosix = (p: string): string => p.replace(/\\/g, '/');

/** File name without extension, in lowercase. */
function stemOf(path: string): string {
  const base = toPosix(path).split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

/** Extension (with the dot), in lowercase. */
function extOf(path: string): string {
  const base = toPosix(path).split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

/**
 * Finds, among the candidates, the one designated by a dependency path. The analyzer may report
 * paths relative to the referencing layer while the candidates are absolute: we accept an exact
 * match or a match on **trailing segments**.
 */
function resolveDep(dep: string, candidates: string[]): string | null {
  const needle = toPosix(dep).replace(/^\.\//, '');
  for (const candidate of candidates) {
    const posix = toPosix(candidate);
    if (posix === needle || posix.endsWith(`/${needle}`)) return candidate;
  }
  return null;
}

/**
 * Designates the root layer among the USD files of an archive, or `null` if the archive contains
 * none. `deps` (optional) is the graph reported by the analyzer; `archiveName` is the name of the
 * uploaded file, often identical to that of the root layer.
 */
export function pickUsdRootLayer(
  files: string[],
  opts: { deps?: UsdLayerDep[]; archiveName?: string } = {},
): string | null {
  const candidates = files.filter((f) => isUsdModel(extOf(f)));
  if (candidates.length <= 1) return candidates[0] ?? null;

  // Layers referenced by ANOTHER layer of the archive: these are not roots.
  const referenced = new Set<string>();
  for (const { layer, deps } of opts.deps ?? []) {
    const from = resolveDep(layer, candidates);
    for (const dep of deps) {
      const target = resolveDep(dep, candidates);
      // A layer that references itself (cycle) is not disqualified as a root.
      if (target && target !== from) referenced.add(target);
    }
  }

  // All referenced (composition cycle): no candidate is eliminated.
  const roots = candidates.filter((c) => !referenced.has(c));
  const pool = roots.length > 0 ? roots : candidates;

  const archiveStem = opts.archiveName ? stemOf(opts.archiveName) : null;
  const rank = (path: string): [number, number, number, string] => [
    toPosix(path).split('/').length, // depth: a root sits at the top of the tree
    archiveStem && stemOf(path) === archiveStem ? 0 : 1,
    USD_ROOT_HINTS.indexOf(stemOf(path)) === -1
      ? USD_ROOT_HINTS.length
      : USD_ROOT_HINTS.indexOf(stemOf(path)),
    toPosix(path), // alphabetical tie-break: deterministic choice from one run to the next
  ];

  const sorted = [...pool].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < 3; i++) {
      const diff = (ra[i] as number) - (rb[i] as number);
      if (diff !== 0) return diff;
    }
    return ra[3].localeCompare(rb[3]);
  });
  return sorted[0] ?? null;
}
