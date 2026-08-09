// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { clonePath, emptyOverride, isHidden, type PrimTransform, type SceneOverride } from './sceneOverride';
import { applyPlan, planOverride, variantActive, type IndexedObject, type VariantSelection } from './sceneOverrideApply';

/**
 * Clones de mise en scène (C1) : réconciliation des copies d'objets dans la scène Three.
 * Un clone = les objets affichés du prim source dupliqués (`Object3D.clone` — géométrie et
 * matériaux partagés) dans le même parent, indexés sous le pseudo-chemin `/prim#id` avec la
 * **base du source** : son delta s'applique alors exactement comme un override de prim
 * (`planOverride`). Les objets ne sont recréés que si l'ensemble des clones change ; un
 * changement de delta seul ne fait que replanifier. Extrait de `useUsdScene` (budget lignes).
 */
export function useSceneClones(
  override: SceneOverride,
  indexed: IndexedObject<THREE.Object3D>[],
  variantDefaults: VariantSelection,
): IndexedObject<THREE.Object3D>[] {
  const cloneObjectsRef = useRef(new Map<string, THREE.Object3D[]>());
  const [cloneIndex, setCloneIndex] = useState<IndexedObject<THREE.Object3D>[]>([]);

  useEffect(() => {
    const known = cloneObjectsRef.current;
    // Ensemble voulu : un pseudo-chemin par clone d'un prim dont des objets sont indexés.
    const desired = new Map<string, { srcPath: string; transform: PrimTransform }>();
    for (const [path, edit] of Object.entries(override.prims))
      for (const clone of edit.clones ?? [])
        desired.set(clonePath(path, clone.id), { srcPath: path, transform: clone.transform });

    let membershipChanged = false;
    // Retire les clones disparus.
    for (const [pseudo, objects] of known) {
      if (desired.has(pseudo)) continue;
      for (const object of objects) object.parent?.remove(object);
      known.delete(pseudo);
      membershipChanged = true;
    }
    // Crée les clones manquants.
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
    // Applique les deltas des clones (et la visibilité héritée du prim source).
    const cloneOverride = emptyOverride();
    for (const [pseudo, { srcPath, transform }] of desired)
      cloneOverride.prims[pseudo] = {
        transform,
        ...(isHidden(override, srcPath) ? { visible: false } : {}),
      };
    applyPlan(planOverride(nextIndex, cloneOverride, {}));
    if (membershipChanged) setCloneIndex(nextIndex);
  }, [override, variantDefaults, indexed]);

  // Démontage : les copies ne survivent pas au viewer.
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
