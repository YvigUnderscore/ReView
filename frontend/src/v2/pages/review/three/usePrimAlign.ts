// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { clonesOf, IDENTITY_TRANSFORM, parseClonePath, type PrimTransform, type SceneOverride } from './sceneOverride';
import { alignOffsets, distributeOffsets, type AlignAxis, type AlignItem, type AlignMode } from './alignPrims';

/**
 * Alignement / répartition de la sélection de prims (C2) : boîtes englobantes monde → offsets
 * purs (`alignPrims.ts`) → deltas de translation convertis dans l'espace parent de chaque prim.
 * Extrait de `useUsdScene` (budget lignes) — l'écriture repasse par `editLocal`/`writeTransform`.
 */
export function usePrimAlign(opts: {
  getSceneHandle: () => ViewerSceneHandle | null;
  selected: string[];
  objectsOf: (path: string) => THREE.Object3D[];
  override: SceneOverride;
  editLocal: (next: (o: SceneOverride) => SceneOverride) => void;
  writeTransform: (o: SceneOverride, path: string, t: PrimTransform | null) => SceneOverride;
}): {
  alignSelected: (axis: AlignAxis, mode: AlignMode) => void;
  distributeSelected: (axis: AlignAxis) => void;
} {
  const { getSceneHandle, selected, objectsOf, override, editLocal, writeTransform } = opts;

  /** Delta effectif courant d'un prim ou d'un clone (base de l'ajustement d'axe). */
  const currentDelta = useCallback(
    (path: string): PrimTransform => {
      const clone = parseClonePath(path);
      if (clone)
        return (
          clonesOf(override, clone.path).find((c) => c.id === clone.id)?.transform ?? IDENTITY_TRANSFORM
        );
      return override.prims[path]?.transform ?? IDENTITY_TRANSFORM;
    },
    [override],
  );

  const collectAlignItems = useCallback((): AlignItem[] => {
    const handle = getSceneHandle();
    if (!handle) return [];
    const T = handle.THREE;
    const items: AlignItem[] = [];
    for (const path of selected) {
      const objects = objectsOf(path);
      if (!objects.length) continue;
      const box = new T.Box3();
      for (const object of objects) box.expandByObject(object);
      if (box.isEmpty()) continue;
      items.push({
        path,
        min: box.min.toArray() as AlignItem['min'],
        max: box.max.toArray() as AlignItem['max'],
      });
    }
    return items;
  }, [getSceneHandle, selected, objectsOf]);

  /** Applique des offsets d'axe monde en deltas de translation (espace parent de chaque prim). */
  const nudgeAxis = useCallback(
    (offsets: Array<{ path: string; offset: number }>, axis: AlignAxis) => {
      const handle = getSceneHandle();
      if (!handle || !offsets.length) return;
      const T = handle.THREE;
      const patches: Array<{ path: string; transform: PrimTransform }> = [];
      for (const { path, offset } of offsets) {
        if (Math.abs(offset) < 1e-9) continue;
        const rep = objectsOf(path)[0];
        const parent = rep?.parent;
        if (!parent) continue;
        parent.updateWorldMatrix(true, false);
        const pw = new T.Vector3();
        const qw = new T.Quaternion();
        const sw = new T.Vector3();
        parent.matrixWorld.decompose(pw, qw, sw);
        const v = new T.Vector3();
        v.setComponent(axis, offset);
        v.applyQuaternion(qw.invert()).divide(sw);
        const current = currentDelta(path);
        patches.push({
          path,
          transform: { ...current, t: [current.t[0] + v.x, current.t[1] + v.y, current.t[2] + v.z] },
        });
      }
      if (patches.length)
        editLocal((o) => patches.reduce((acc, p) => writeTransform(acc, p.path, p.transform), o));
    },
    [getSceneHandle, objectsOf, currentDelta, editLocal, writeTransform],
  );

  const alignSelected = useCallback(
    (axis: AlignAxis, mode: AlignMode) => nudgeAxis(alignOffsets(collectAlignItems(), axis, mode), axis),
    [collectAlignItems, nudgeAxis],
  );
  const distributeSelected = useCallback(
    (axis: AlignAxis) => nudgeAxis(distributeOffsets(collectAlignItems(), axis), axis),
    [collectAlignItems, nudgeAxis],
  );

  return { alignSelected, distributeSelected };
}
