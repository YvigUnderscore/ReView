// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdModelInfo } from '@/v2/types/api';
import { clonePath, clonesOf, type SceneOverride } from '../three/sceneOverride';
import type { PrimNode } from '../three/usdScenegraph';

/**
 * Flattening of the USD scenegraph into **rows**: pure arithmetic of the virtualised panel.
 *
 * Virtualising a tree is not virtualising a list: the virtualizer can only count rows. The tree is
 * therefore flattened **as it is expanded** (the children of a collapsed node do not exist as a row),
 * once per change of tree or expansion, instead of letting JSX recursion mount thousands of components
 * of which twenty are visible.
 *
 * Isolated here so that it can be verified without a browser, and to keep the panel within its line budget.
 */

/** Estimated row height before real measurement (`text-xs` + `py-0.5`). */
export const ROW_ESTIMATE = 20;

/** Rows mounted on each side of the window: scrolling does not show any gap. */
export const ROW_OVERSCAN = 8;

/** Row of a scene prim. */
export interface PrimRowItem {
  kind: 'prim';
  path: string;
  node: PrimNode;
  depth: number;
  /** Node expanded **and** carrying children: this is what the chevron draws. */
  open: boolean;
}

/** Row of a staging clone (C1), child of the source prim's row. */
export interface CloneRowItem {
  kind: 'clone';
  /** Pseudo-path `/prim#id`: the clone's identity for selection. */
  path: string;
  name: string;
  depth: number;
}

export type ScenegraphRowItem = PrimRowItem | CloneRowItem;

/** Nothing to force-expand: shared instance, so as not to invalidate memoization. */
const NONE: ReadonlySet<string> = new Set<string>();

/**
 * Visible rows, in display order: the prim, its clones, then its children if it is expanded. `forceOpen`
 * covers the search: these are the nodes of the path leading to a match (`searchPrimTree`), and them only.
 * The former total expansion of the filtered tree unrolled the whole descendance of a result, which nobody
 * had asked for.
 */
export function buildRows(
  tree: readonly PrimNode[],
  expanded: ReadonlySet<string>,
  override: SceneOverride,
  forceOpen: ReadonlySet<string> = NONE,
): ScenegraphRowItem[] {
  const rows: ScenegraphRowItem[] = [];
  const walk = (nodes: readonly PrimNode[], depth: number) => {
    for (const node of nodes) {
      const open = (expanded.has(node.path) || forceOpen.has(node.path)) && node.children.length > 0;
      rows.push({ kind: 'prim', path: node.path, node, depth, open });
      for (const clone of clonesOf(override, node.path))
        rows.push({
          kind: 'clone',
          path: clonePath(node.path, clone.id),
          name: node.name,
          depth: depth + 1,
        });
      if (open) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

/**
 * Position of a path among the rows, `-1` if it has none (collapsed branch, filtered out).
 *
 * This is the counterpart of virtualisation: scrolling to a prim selected in the viewer requires an
 * **index**, not a DOM node: the row may not exist.
 */
export function rowIndexOf(rows: readonly ScenegraphRowItem[], path: string | null): number {
  if (!path) return -1;
  return rows.findIndex((row) => row.path === path);
}

/**
 * Label of a prim's variant sets, indexed once per scene.
 *
 * The former `variantSetsOf` re-filtered the complete list of variantSets for **each** row (F18): on a
 * scene carrying hundreds of them, the tree cost a product of two sizes.
 */
export function variantTitleIndex(usd: UsdModelInfo | null): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const set of usd?.variantSets ?? []) {
    const current = index.get(set.prim);
    index.set(set.prim, current ? `${current}, ${set.name}` : set.name);
  }
  return index;
}

/**
 * Prim targeted by a right-click, from the event's target.
 *
 * The panel now mounts only **one** context menu (instead of one per row): it is therefore up to it to
 * find the targeted row at the moment of the click, by climbing the DOM. Clone rows carry none: they
 * never had a menu in the tree.
 */
export function aimedPrimPath(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-prim-path]')?.getAttribute('data-prim-path') ?? null;
}
