// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type * as THREE from 'three';
import { clonePath, emptyOverride, isHidden, type PrimTransform, type SceneOverride } from './sceneOverride';
import {
  applyPlan,
  planOverride,
  variantActive,
  type IndexedObject,
  type VariantSelection,
} from './sceneOverrideApply';

/**
 * External mini-store: the clone index is produced by the reconciliation effect (which creates the
 * `Object3D`s — a system external to React) and read via `useSyncExternalStore`, the pattern
 * recommended by the `set-state-in-effect` rule to reflect a state born outside React.
 */
interface CloneIndexStore {
  index: IndexedObject<THREE.Object3D>[];
  listeners: Set<() => void>;
}

/**
 * Staging clones (C1): reconciliation of object copies in the Three scene.
 * A clone = the displayed objects of the source prim duplicated (`Object3D.clone` — geometry and
 * materials shared) under the same parent, indexed under the pseudo-path `/prim#id` with the
 * **source's base**: its delta then applies exactly like a prim override (`planOverride`). Objects
 * are only recreated when the set of clones changes; a change of delta alone merely replans.
 * Extracted from `useUsdScene` (line budget).
 */
export function useSceneClones(
  override: SceneOverride,
  indexed: IndexedObject<THREE.Object3D>[],
  variantDefaults: VariantSelection,
): IndexedObject<THREE.Object3D>[] {
  const cloneObjectsRef = useRef(new Map<string, THREE.Object3D[]>());
  // The store lives in a ref, not in state: its content is written outside React (reconciliation
  // effect), and React state must not be mutated in place.
  const storeRef = useRef<CloneIndexStore>({ index: [], listeners: new Set() });
  const subscribe = useCallback((onChange: () => void) => {
    const store = storeRef.current;
    store.listeners.add(onChange);
    return () => store.listeners.delete(onChange);
  }, []);
  const getIndex = useCallback(() => storeRef.current.index, []);
  const cloneIndex = useSyncExternalStore(subscribe, getIndex);

  useEffect(() => {
    const known = cloneObjectsRef.current;
    // Desired set: one pseudo-path per clone of a prim whose objects are indexed.
    const desired = new Map<string, { srcPath: string; transform: PrimTransform }>();
    for (const [path, edit] of Object.entries(override.prims))
      for (const clone of edit.clones ?? [])
        desired.set(clonePath(path, clone.id), { srcPath: path, transform: clone.transform });

    let membershipChanged = false;
    // Removes the vanished clones.
    for (const [pseudo, objects] of known) {
      if (desired.has(pseudo)) continue;
      for (const object of objects) object.parent?.remove(object);
      known.delete(pseudo);
      membershipChanged = true;
    }
    // Creates the missing clones.
    const nextIndex: IndexedObject<THREE.Object3D>[] = [];
    for (const [pseudo, { srcPath }] of desired) {
      let objects = known.get(pseudo);
      if (!objects) {
        objects = [];
        for (const entry of indexed) {
          if (entry.primPath !== srcPath || !variantActive(entry, override, variantDefaults)) continue;
          const copy = entry.object.clone(true);
          copy.userData = { ...copy.userData, reviewClone: pseudo };
          entry.object.parent?.add(copy);
          objects.push(copy);
        }
        if (!objects.length) continue;
        known.set(pseudo, objects);
        membershipChanged = true;
      }
      const bases = indexed.filter(
        (entry) => entry.primPath === srcPath && variantActive(entry, override, variantDefaults),
      );
      objects.forEach((object, i) => {
        const base = bases[i]?.base ?? bases[0]?.base;
        if (base) nextIndex.push({ object, primPath: pseudo, base });
      });
    }
    // Applies the clones' deltas (and the source prim's inherited visibility).
    const cloneOverride = emptyOverride();
    for (const [pseudo, { srcPath, transform }] of desired)
      cloneOverride.prims[pseudo] = {
        transform,
        ...(isHidden(override, srcPath) ? { visible: false } : {}),
      };
    applyPlan(planOverride(nextIndex, cloneOverride, {}));
    if (membershipChanged) {
      const store = storeRef.current;
      store.index = nextIndex;
      store.listeners.forEach((notify) => notify());
    }
  }, [override, variantDefaults, indexed]);

  // Teardown: the copies do not survive the viewer.
  useEffect(
    () => () => {
      for (const objects of cloneObjectsRef.current.values())
        for (const object of objects) object.parent?.remove(object);
      cloneObjectsRef.current.clear();
    },
    [],
  );

  return cloneIndex;
}
