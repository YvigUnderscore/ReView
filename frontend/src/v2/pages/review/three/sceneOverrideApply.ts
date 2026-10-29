// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type * as THREE from 'three';
import { matchPrimPath } from './usdScenegraph';
import { IDENTITY_TRANSFORM, type PrimTransform, type SceneOverride } from './sceneOverride';

/**
 * Applies the "ReView override" to the Three scene (Phase 46, 46.B).
 *
 * Split in two: `planOverride` **computes** what each object must become (pure, testable without
 * Three), `applyPlan` merely writes. Application is **idempotent**: each object is first brought
 * back to its original state, recorded at load time, then the delta is laid on top. Without this
 * reset, deselecting a comment would leave its proposal applied, and chaining two proposals would
 * compound their moves.
 */

/** Original state of an object, recorded when the GLB is loaded. */
export interface BaseState {
  position: [number, number, number];
  /** Original rotation in Euler XYZ (radians) — the delta is added to it. */
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
}

/** Membership of an object in the variant options baked into the GLB (46.G, multi-set 46.R). */
export interface VariantMembership {
  /** Prim carrying the variant sets. */
  prim: string;
  /**
   * Option required per set — the object is only visible if **all** of them match. A prim can carry
   * several sets (plates: modelingVariant AND shadingVariant): each baked subtree is composed with
   * the other sets at their default value, and must disappear as soon as one of them changes.
   */
  selections: Record<string, string>;
}

/** Indexed object: its resolved prim path and its original state. */
export interface IndexedObject<T> {
  object: T;
  /** USD prim path, or the raw glTF path if no prim matches. */
  primPath: string;
  base: BaseState;
  /** Set if the object belongs to a variant option — otherwise it is always visible. */
  variant?: VariantMembership;
}

/** Active option per variant set: `{ '/World/Asset': { modelingVariant: 'hero' } }`. */
export type VariantSelection = Record<string, Record<string, string>>;

/**
 * Option kept for a variant set: the one from the override if the user chose one, otherwise the
 * one the scene had at conversion time.
 */
export function effectiveVariant(
  override: SceneOverride | null,
  defaults: VariantSelection,
  prim: string,
  set: string,
): string | undefined {
  return override?.prims[prim]?.variants?.[set] ?? defaults[prim]?.[set];
}

/**
 * True if the object belongs to the **kept** options of all its variant sets (or carries none).
 * This is the single variant-visibility predicate: the application plan, the greying of the tree
 * and the framing targets all refer to it.
 */
export function variantActive<T>(
  entry: IndexedObject<T>,
  override: SceneOverride | null,
  defaults: VariantSelection,
): boolean {
  const membership = entry.variant;
  if (!membership) return true;
  return Object.entries(membership.selections).every(
    ([set, option]) => effectiveVariant(override, defaults, membership.prim, set) === option,
  );
}

/**
 * True if keeping `option` for the prim's set `set` would actually display geometry, given the
 * options kept on the **other** sets of the same prim.
 *
 * Baking imports each option composed with the other sets at their default (46.G/46.R): a
 * combination of two non-default options only exists in the GLB if it was composed as such —
 * choosing it when it is not makes everything vanish ("PlateA then dirty → the plate disappears").
 * The menu uses this to grey out such combinations (46.U). If no indexed object carries this set
 * (GLB predating the tagging), we cannot know: do not block.
 */
export function variantOptionRenderable<T>(
  indexed: readonly IndexedObject<T>[],
  override: SceneOverride | null,
  defaults: VariantSelection,
  prim: string,
  set: string,
  option: string,
): boolean {
  let known = false;
  for (const entry of indexed) {
    const membership = entry.variant;
    if (!membership || membership.prim !== prim) continue;
    const required = membership.selections[set];
    if (required === undefined) continue;
    known = true;
    if (required !== option) continue;
    const othersMatch = Object.entries(membership.selections).every(
      ([s, o]) => s === set || effectiveVariant(override, defaults, prim, s) === o,
    );
    if (othersMatch) return true;
  }
  return !known;
}

/** What must be written on an object to reflect the override. */
export interface ObjectPlan<T> {
  object: T;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  visible: boolean;
}

/**
 * Computes the target state of each indexed object. The override's delta is **added** to the
 * original state: translation and rotation by addition, scale by multiplication.
 */
export function planOverride<T>(
  indexed: readonly IndexedObject<T>[],
  override: SceneOverride | null,
  /** Active variant options at conversion time — the base the override applies to. */
  variantDefaults: VariantSelection = {},
): ObjectPlan<T>[] {
  return indexed.map((entry) => {
    const { object, primPath, base } = entry;
    const edit = override?.prims[primPath];
    const delta: PrimTransform = edit?.transform ?? IDENTITY_TRANSFORM;
    // Baked variant (46.G): the object only exists in the GLB for given options, so it is only
    // visible if they are all kept. This is what makes switching instantaneous.
    const variantVisible = variantActive(entry, override, variantDefaults);
    return {
      object,
      position: [base.position[0] + delta.t[0], base.position[1] + delta.t[1], base.position[2] + delta.t[2]],
      rotation: [base.rotation[0] + delta.r[0], base.rotation[1] + delta.r[1], base.rotation[2] + delta.r[2]],
      scale: [base.scale[0] * delta.s[0], base.scale[1] * delta.s[1], base.scale[2] * delta.s[2]],
      // `visible: false` on an object hides its whole subtree: inheritance is free.
      // A kept-out variant option overrides any visibility request.
      visible: variantVisible && (edit?.visible ?? base.visible),
    };
  });
}

/** Records the original state of a Three object. */
export function captureBase(object: THREE.Object3D): BaseState {
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
    visible: object.visible,
  };
}

/**
 * Indexes the GLB's objects by USD prim path. The match comes from `usdPath`, written into the
 * glTF `extras` by the worker and surfaced by three.js in `userData`; it is paired with the real
 * USD tree (`matchPrimPath`), the two hierarchies possibly differing by one level. An object
 * without `usdPath` (GLB not derived from USD) is ignored.
 */
/**
 * Variant memberships of a glTF node. Two encodings coexist: `usdVariants`
 * (`set=option;set=option`, multi-set — 46.R) and the legacy `usdVariantSet`/`usdVariantOption`
 * pair (a single set) of media converted earlier.
 */
function parseMembership(data: {
  usdVariantPrim?: unknown;
  usdVariants?: unknown;
  usdVariantSet?: unknown;
  usdVariantOption?: unknown;
}): VariantMembership | undefined {
  const prim = data.usdVariantPrim;
  if (typeof prim !== 'string' || !prim) return undefined;
  if (typeof data.usdVariants === 'string' && data.usdVariants) {
    const selections: Record<string, string> = {};
    for (const part of data.usdVariants.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) selections[part.slice(0, eq)] = part.slice(eq + 1);
    }
    if (Object.keys(selections).length > 0) return { prim, selections };
  }
  if (typeof data.usdVariantSet === 'string' && typeof data.usdVariantOption === 'string')
    return { prim, selections: { [data.usdVariantSet]: data.usdVariantOption } };
  return undefined;
}

export function indexPrimObjects(
  root: THREE.Object3D,
  usdPaths: readonly string[],
): IndexedObject<THREE.Object3D>[] {
  const indexed: IndexedObject<THREE.Object3D>[] = [];
  const paths = [...usdPaths];
  root.traverse((object) => {
    const data = object.userData as Parameters<typeof parseMembership>[0] & { usdPath?: unknown };
    const raw = data?.usdPath;
    if (typeof raw !== 'string' || !raw.startsWith('/')) return;
    const variant = parseMembership(data);
    indexed.push({
      object,
      primPath: matchPrimPath(raw, paths) ?? raw,
      base: captureBase(object),
      ...(variant ? { variant } : {}),
    });
  });
  return indexed;
}

/** Writes the plan onto the scene. The only function that mutates — the rest is pure. */
export function applyPlan(plans: readonly ObjectPlan<THREE.Object3D>[]): void {
  for (const plan of plans) {
    plan.object.position.set(...plan.position);
    plan.object.rotation.set(...plan.rotation);
    plan.object.scale.set(...plan.scale);
    plan.object.visible = plan.visible;
  }
}

/**
 * True if the object is actually drawn. Three hides a whole subtree when an object is invisible
 * **without touching** the `visible` of the children: hiding a parent prim thus leaves its meshes
 * at `visible: true`. Everything that follows the display (the selection halo) must walk up the
 * hierarchy, otherwise it keeps showing around an object that became invisible.
 */
export function isDrawn(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/**
 * Override delta matching the **current** pose of an object relative to its original state (46.N —
 * per-prim TRS gizmo). Exact inverse of `planOverride`: translation and rotation by difference,
 * scale by ratio — re-applying the delta from the base gives back the pose manipulated by the gizmo.
 */
export function transformDeltaFrom(
  base: BaseState,
  object: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
  },
): PrimTransform {
  // A zero scale base is degenerate (flattened object): ratio 1, so as not to produce NaN.
  const ratio = (value: number, b: number) => (Math.abs(b) < 1e-12 ? 1 : value / b);
  return {
    t: [
      object.position.x - base.position[0],
      object.position.y - base.position[1],
      object.position.z - base.position[2],
    ],
    r: [
      object.rotation.x - base.rotation[0],
      object.rotation.y - base.rotation[1],
      object.rotation.z - base.rotation[2],
    ],
    s: [
      ratio(object.scale.x, base.scale[0]),
      ratio(object.scale.y, base.scale[1]),
      ratio(object.scale.z, base.scale[2]),
    ],
  };
}

/**
 * Resolves a hit object to its prim **via the index**, climbing the hierarchy.
 *
 * The index is the only authoritative table: it has already matched the raw glTF path to the USD
 * tree (`matchPrimPath`), which may collapse a level. Reading `usdPath` directly at selection time
 * would produce a path absent from the index — the selection would then designate no object, neither
 * for the halo nor for the tree.
 */
export function makePrimResolver(
  indexed: readonly IndexedObject<THREE.Object3D>[],
): (object: THREE.Object3D) => string | null {
  const byObject = new Map(indexed.map((entry) => [entry.object, entry.primPath]));
  return (object) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const path = byObject.get(node);
      if (path !== undefined) return path;
    }
    return null;
  };
}

/** All the paths of prims actually rendered — useful to isolate or list the selection. */
export function renderedPrimPaths(indexed: readonly IndexedObject<unknown>[]): string[] {
  return [...new Set(indexed.map((i) => i.primPath))];
}
