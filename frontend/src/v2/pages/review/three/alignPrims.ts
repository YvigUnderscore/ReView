// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Alignment and distribution of a selection of prims (C2): **pure and testable** geometry.
 * each prim is reduced to its world bounding box, the functions return the offset to add on the
 * requested axis. The conversion into an override delta (parent space) and the write live in
 * `useUsdScene`.
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
 * Offsets aligning all the prims on the same axis value: the min of the mins, the max of the maxes,
 * or the centre of the set.
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
 * Offsets spreading the centres at regular intervals along the axis: the two extremes do not
 * move, the others space themselves out (current order of the centres kept).
 */
export function distributeOffsets(
  items: readonly AlignItem[],
  axis: AlignAxis,
): Array<{ path: string; offset: number }> {
  if (items.length < 3) return [];
  const sorted = [...items].sort((a, b) => value(a, axis, 'center') - value(b, axis, 'center'));
  const first = value(sorted[0], axis, 'center');
  const last = value(sorted[sorted.length - 1], axis, 'center');
  const step = (last - first) / (sorted.length - 1);
  return sorted.map((item, i) => ({
    path: item.path,
    offset: first + step * i - value(item, axis, 'center'),
  }));
}
