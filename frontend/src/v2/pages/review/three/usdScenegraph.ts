// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdPrim } from '@/v2/types/api';

/**
 * USD scenegraph of the review (Phase 46, 46.A) — **pure and testable** logic.
 *
 * Two trees coexist and do not always coincide:
 *  - the **USD tree** reported by the parser: the semantic truth (types, variants,
 *    purposes), including unrendered prims;
 *  - the **glTF tree** actually loaded in Three: what the viewer sees and manipulates.
 *
 * Blender's USD importer exposes no prim path; we rebuild it at export time from the object
 * hierarchy, which can **collapse or insert** a level (a reference whose root carries the same name
 * as the referencing prim, for example). Hence `matchPrimPath`, which pairs the two instead of
 * requiring strict equality.
 */

/** Tree node: a prim and its children. */
export interface PrimNode extends UsdPrim {
  children: PrimNode[];
}

/** Segments of a USD path (`/World/Asset` → `['World','Asset']`). */
export function primSegments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Path of the parent, or `null` for a top-level prim. */
export function parentPath(path: string): string | null {
  const segments = primSegments(path);
  return segments.length <= 1 ? null : `/${segments.slice(0, -1).join('/')}`;
}

/** Last segment of a path (the prim name). */
export function leafName(path: string): string {
  return primSegments(path).at(-1) ?? '';
}

/** True if `path` is `ancestor` itself or one of its descendants. */
export function isSelfOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Ancestors of a path, from the root to its parent (`/a/b/c` → `['/a','/a/b']`). */
export function ancestorPaths(path: string): string[] {
  const out: string[] = [];
  for (let parent = parentPath(path); parent; parent = parentPath(parent)) out.unshift(parent);
  return out;
}

/**
 * Default USD `kind` of the targeted model hierarchy: the "object" level of a production scene
 * (a chair, a saucepan), the level a set dresser reasons in.
 */
const COMPONENT_KIND = 'component';

/** `path → kind` table of a list of prims — input of `promoteToKind`. */
export function primKinds(prims: readonly UsdPrim[]): Map<string, string> {
  return new Map(prims.map((p) => [p.path, p.kind]));
}

export interface PromoteOptions {
  /** `kind` per prim path (`primKinds`) — the only source of promotion. */
  kinds: ReadonlyMap<string, string>;
  /**
   * Paths actually manipulable, i.e. indexed in the Three scene. An ancestor that is not there
   * carries **no object**: promoting to it would yield a selection without halo, framing or gizmo.
   * Absent ⇒ no filter (purely semantic use).
   */
  selectable?: ReadonlySet<string>;
  /** Target `kind` — `component` by default. */
  kind?: string;
}

/**
 * Climbs a prim path up to the enclosing **component**: the click in the viewer hits a leaf
 * (`.../Chair_1/Geom/Seat`), but the object the user designates is the chair.
 *
 * The fallback **never** loses the selection: without an eligible ancestor — truncated tree
 * (`MAX_PRIMS_REPORTED`), implicit levels with an empty `kind`, unindexed ancestor — the original
 * path is returned as is. A null path (no match) stays null.
 *
 * Pure and free of any Three dependency: it is the module's only promotion, and it only happens at
 * **click resolution** — never when writing an override, whose already recorded paths target leaves.
 */
export function promoteToKind(path: string | null, opts: PromoteOptions): string | null {
  if (!path) return null;
  const target = opts.kind ?? COMPONENT_KIND;
  for (let p: string | null = path; p; p = parentPath(p)) {
    if (opts.kinds.get(p) !== target) continue;
    if (opts.selectable && !opts.selectable.has(p)) continue;
    return p;
  }
  return path;
}

/** Synthetic prim for an intermediate level missing from the list (truncated tree). */
function implicitPrim(path: string): UsdPrim {
  return {
    path,
    name: leafName(path),
    type: '',
    kind: '',
    purpose: '',
    variantSets: [],
    active: true,
    instanceable: false,
  };
}

/**
 * Rebuilds the hierarchy from the flat list: the paths carry all of it. Missing intermediate levels
 * (truncated list, filtered prim) are created implicitly so that no branch is left orphaned at the root.
 */
export function buildPrimTree(prims: UsdPrim[]): PrimNode[] {
  const nodes = new Map<string, PrimNode>();
  const ensure = (prim: UsdPrim): PrimNode => {
    const existing = nodes.get(prim.path);
    if (existing) {
      // A real prim replaces the implicit node created to serve as its parent.
      if (!existing.type && prim.type) Object.assign(existing, prim, { children: existing.children });
      return existing;
    }
    const node: PrimNode = { ...prim, children: [] };
    nodes.set(prim.path, node);
    return node;
  };

  // First pass: each prim **and its whole ancestry** exist as nodes, so that the attachment of
  // the second pass never meets a missing parent.
  for (const prim of prims) {
    ensure(prim);
    for (let parent = parentPath(prim.path); parent; parent = parentPath(parent))
      ensure(implicitPrim(parent));
  }

  const roots: PrimNode[] = [];
  for (const node of nodes.values()) {
    const parent = parentPath(node.path);
    if (parent === null) roots.push(node);
    else nodes.get(parent)!.children.push(node);
  }

  const sort = (list: PrimNode[]): PrimNode[] => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of list) sort(child.children);
    return list;
  };
  return sort(roots);
}

/**
 * Full tree of the scene **as actually loaded**: the parser's prims, plus implicit prims for the
 * rendered paths it does not know. The parser composes the scene with **a single** option per
 * variant set — the geometry of the other options, baked into the GLB (46.G), does not exist in its
 * tree. Without these implicit prims, selecting or isolating them was impossible: isolation fell
 * back to the nearest known parent.
 * Blender export artifacts (`_materials`) are kept out of the tree.
 */
export function buildRenderedPrimTree(prims: UsdPrim[], renderedPaths: Iterable<string>): PrimNode[] {
  const known = new Set(prims.map((p) => p.path));
  const ghosts: UsdPrim[] = [];
  for (const path of renderedPaths) {
    if (known.has(path) || leafName(path) === '_materials') continue;
    known.add(path);
    ghosts.push(implicitPrim(path));
  }
  return buildPrimTree([...prims, ...ghosts]);
}

/**
 * Matches a path rebuilt on the glTF side to the corresponding USD prim. Strict equality first;
 * otherwise, among prims with the **same leaf name**, the one sharing the longest prefix — which
 * absorbs a collapsed or inserted level. Returns `null` if nothing matches or if the best score is
 * ambiguous (two equally plausible prims).
 */
export function matchPrimPath(candidate: string, usdPaths: string[]): string | null {
  if (usdPaths.includes(candidate)) return candidate;

  const leaf = leafName(candidate);
  const candidateSegments = primSegments(candidate);
  let best: { path: string; score: number; length: number } | null = null;
  let ambiguous = false;

  for (const path of usdPaths) {
    if (leafName(path) !== leaf) continue;
    const segments = primSegments(path);
    let common = 0;
    while (
      common < segments.length - 1 &&
      common < candidateSegments.length - 1 &&
      segments[common] === candidateSegments[common]
    )
      common += 1;

    if (!best || common > best.score || (common === best.score && segments.length < best.length)) {
      ambiguous = best !== null && common === best.score && segments.length === best.length;
      best = { path, score: common, length: segments.length };
    } else if (common === best.score && segments.length === best.length) {
      ambiguous = true;
    }
  }

  return best && !ambiguous ? best.path : null;
}

/** Paths of the tree in display order (pre-order) — the Shift+click range of the scenegraph (B1). */
export function flattenTree(tree: PrimNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: PrimNode[]) => {
    for (const node of nodes) {
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** First two levels: default expansion of the scenegraph, enough to place the scene. */
export function initialExpansion(tree: readonly PrimNode[]): Set<string> {
  return new Set(tree.flatMap((n) => [n.path, ...n.children.map((c) => c.path)]));
}

/** Result of a tree search: what stays visible, and what must be expanded. */
export interface PrimSearch {
  /** Filtered tree: the matches and their ancestors, nothing else. */
  tree: PrimNode[];
  /**
   * Nodes to force open — **only** the path leading to a match. These are the internal nodes of the
   * filtered tree: a match with no kept descendant stays closed, and typing "table" no longer
   * unrolls the entire table.
   */
  expand: ReadonlySet<string>;
}

/** No forced expansion: shared instance so that row memoization holds. */
const NO_EXPANSION: ReadonlySet<string> = new Set<string>();

/**
 * Search in the tree (case-insensitive): a node stays if it or one of its descendants matches — the
 * ancestors of a result stay visible to place the prim.
 *
 * Matching is on the **name**, not the path: comparing the full path made everything under a found
 * node match ("table" kept `/…/table/…/vis_037`), and the tree unfolded entirely. A query containing
 * a slash, on the other hand, is an explicit path intent and is compared against the path.
 */
export function searchPrimTree(tree: PrimNode[], query: string): PrimSearch {
  const q = query.trim().toLowerCase();
  if (!q) return { tree, expand: NO_EXPANSION };
  const byPath = q.includes('/');
  const expand = new Set<string>();
  const keep = (node: PrimNode): PrimNode | null => {
    const children = node.children.map(keep).filter((n): n is PrimNode => n !== null);
    const self = (byPath ? node.path : node.name).toLowerCase().includes(q);
    if (!self && children.length === 0) return null;
    if (children.length > 0) expand.add(node.path);
    return { ...node, children };
  };
  return { tree: tree.map(keep).filter((n): n is PrimNode => n !== null), expand };
}
