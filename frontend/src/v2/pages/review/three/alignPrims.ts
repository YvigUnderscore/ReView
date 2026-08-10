// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Alignement et répartition d'une sélection de prims (C2) — géométrie **pure et testable** :
 * chaque prim est réduit à sa boîte englobante monde, les fonctions renvoient l'offset à
 * ajouter sur l'axe demandé. La conversion en delta d'override (espace parent) et l'écriture
 * vivent dans `useUsdScene`.
 */

export type AlignAxis = 0 | 1 | 2;
export type AlignMode = 'min' | 'center' | 'max';

export interface AlignItem {
  path: string;
  min: [number, number, number];
  max: [number, number, number];
}

const value = (item: AlignItem, axis: AlignAxis, mode: AlignMode): number =>
  mode === 'min' ? item.min[axis] : mode === 'max' ? item.max[axis] : (item.min[axis] + item.max[axis]) / 2;

/**
 * Offsets alignant tous les prims sur la même valeur d'axe : le min des mins, le max des maxes,
 * ou le centre de l'ensemble.
 */
export function alignOffsets(
  items: readonly AlignItem[],
  axis: AlignAxis,
  mode: AlignMode,
): Array<{ path: string; offset: number }> {
  if (items.length < 2) return [];
  let target: number;
  if (mode === 'min') target = Math.min(...items.map((i) => i.min[axis]));
  else if (mode === 'max') target = Math.max(...items.map((i) => i.max[axis]));
  else {
    const lo = Math.min(...items.map((i) => i.min[axis]));
    const hi = Math.max(...items.map((i) => i.max[axis]));
    target = (lo + hi) / 2;
  }
  return items.map((item) => ({ path: item.path, offset: target - value(item, axis, mode) }));
}

/**
 * Offsets répartissant les centres à intervalles réguliers sur l'axe : les deux extrêmes ne
 * bougent pas, les autres s'espacent entre eux (ordre actuel des centres conservé).
 */
export function distributeOffsets(
  items: readonly AlignItem[],
  axis: AlignAxis,
): Array<{ path: string; offset: number }> {
  if (items.length < 3) return [];
  const sorted = [...items].sort((a, b) => value(a, axis, 'center') - value(b, axis, 'center'));
  const first = value(sorted[0]!, axis, 'center');
  const last = value(sorted[sorted.length - 1]!, axis, 'center');
  const step = (last - first) / (sorted.length - 1);
  return sorted.map((item, i) => ({
    path: item.path,
    offset: first + step * i - value(item, axis, 'center'),
  }));
}
