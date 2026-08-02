// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isUsdModel } from './modelConvert';

/**
 * Choix de la **couche racine** d'une scène USD livrée en archive (Phase 45, 45.A). Logique **pure
 * et testable** : le worker fournit la liste des fichiers extraits et, si l'analyseur `pxr` est
 * disponible, le graphe des dépendances entre couches ; cette fonction désigne la couche à ouvrir.
 *
 * Pourquoi ce n'est pas trivial : une livraison USD réaliste contient plusieurs fichiers `.usd*` —
 * une couche racine ASCII (`scene.usda`) qui référence des payloads binaires (`payload/body.usdc`),
 * eux-mêmes référençant des matériaux. Le classement par extension de `pickModelFile` place `.usdc`
 * avant `.usda` : sans ce module, on ouvrait un **payload** au lieu de la racine, et la review
 * n'affichait qu'un morceau de la scène.
 *
 * Critère principal : la racine est la couche **qu'aucune autre couche de l'archive ne référence**.
 * À défaut de graphe (analyseur absent) ou en cas d'égalité, on départage par heuristiques stables.
 */

/** Dépendances USD d'une couche, telles que rapportées par l'analyseur (`analyze_usd.py`). */
export interface UsdLayerDep {
  /** Couche source (chemin dans l'archive, absolu ou relatif). */
  layer: string;
  /** Couches USD qu'elle référence : sublayers, references, payloads, clips. */
  deps: string[];
}

/** Noms de fichier conventionnels pour une couche racine, du plus au moins probable. */
export const USD_ROOT_HINTS = ['scene', 'root', 'main', 'asset', 'world', 'shot', 'stage'];

/** Chemin en séparateurs POSIX (les archives mélangent `/` et `\`). */
const toPosix = (p: string): string => p.replace(/\\/g, '/');

/** Nom de fichier sans extension, en minuscules. */
function stemOf(path: string): string {
  const base = toPosix(path).split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
}

/** Extension (avec le point) en minuscules. */
function extOf(path: string): string {
  const base = toPosix(path).split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

/**
 * Retrouve, parmi les candidats, celui que désigne un chemin de dépendance. L'analyseur peut
 * rapporter des chemins relatifs à la couche référençante alors que les candidats sont absolus :
 * on accepte l'égalité exacte ou la correspondance en **suffixe de segments**.
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
 * Désigne la couche racine parmi les fichiers USD d'une archive, ou `null` si l'archive n'en
 * contient aucun. `deps` (optionnel) est le graphe rapporté par l'analyseur ; `archiveName` est le
 * nom du fichier uploadé, souvent identique à celui de la couche racine.
 */
export function pickUsdRootLayer(
  files: string[],
  opts: { deps?: UsdLayerDep[]; archiveName?: string } = {},
): string | null {
  const candidates = files.filter((f) => isUsdModel(extOf(f)));
  if (candidates.length <= 1) return candidates[0] ?? null;

  // Couches référencées par une AUTRE couche de l'archive : ce ne sont pas des racines.
  const referenced = new Set<string>();
  for (const { layer, deps } of opts.deps ?? []) {
    const from = resolveDep(layer, candidates);
    for (const dep of deps) {
      const target = resolveDep(dep, candidates);
      // Une couche qui se référence elle-même (cycle) ne se disqualifie pas comme racine.
      if (target && target !== from) referenced.add(target);
    }
  }

  // Toutes référencées (cycle de composition) → aucun candidat n'est éliminé.
  const roots = candidates.filter((c) => !referenced.has(c));
  const pool = roots.length > 0 ? roots : candidates;

  const archiveStem = opts.archiveName ? stemOf(opts.archiveName) : null;
  const rank = (path: string): [number, number, number, string] => [
    toPosix(path).split('/').length, // profondeur : une racine vit au plus haut de l'arborescence
    archiveStem && stemOf(path) === archiveStem ? 0 : 1,
    USD_ROOT_HINTS.indexOf(stemOf(path)) === -1
      ? USD_ROOT_HINTS.length
      : USD_ROOT_HINTS.indexOf(stemOf(path)),
    toPosix(path), // départage alphabétique : choix déterministe d'une exécution à l'autre
  ];

  const sorted = [...pool].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < 3; i++) {
      const diff = (ra[i] as number) - (rb[i] as number);
      if (diff !== 0) return diff;
    }
    return (ra[3] as string).localeCompare(rb[3] as string);
  });
  return sorted[0] ?? null;
}
