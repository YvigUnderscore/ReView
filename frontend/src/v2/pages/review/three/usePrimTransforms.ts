// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import {
  addClone,
  clonePath,
  clonesOf,
  IDENTITY_TRANSFORM,
  newCloneId,
  parseClonePath,
  removeClone,
  setCloneTransform,
  setPrimEdit,
  type PrimTransform,
  type SceneOverride,
} from './sceneOverride';
import { transformDeltaFrom, type IndexedObject } from './sceneOverrideApply';

/** Delta d'un prim avant/après un drag du gizmo — matière de l'undo (46.N). */
export interface PrimTransformCommit {
  path: string;
  before: PrimTransform | null;
  after: PrimTransform;
}

/**
 * Écriture des poses de prims et de clones (46.N, C1) : commit du gizmo de groupe, duplication,
 * suppression de clone. Tout passe par `editLocal` — un seul lot par geste, donc une seule
 * publication du delta. Extrait de `useUsdScene` (budget lignes).
 */
export function usePrimTransforms(opts: {
  getSceneHandle: () => ViewerSceneHandle | null;
  /** Objets du GLB **et** copies des clones — c'est là qu'on retrouve l'état d'origine. */
  allIndexed: IndexedObject<THREE.Object3D>[];
  /** Override effectif (base + proposition + exploration locale). */
  override: SceneOverride;
  /** Exploration locale seule — l'état « avant » d'un prim non cloné. */
  local: SceneOverride;
  objectsOf: (path: string) => THREE.Object3D[];
  editLocal: (next: (o: SceneOverride) => SceneOverride) => void;
  setSelected: Dispatch<SetStateAction<string[]>>;
}): {
  writeTransform: (o: SceneOverride, path: string, transform: PrimTransform | null) => SceneOverride;
  applyPrimTransform: (path: string, transform: PrimTransform | null) => void;
  commitPrimTransforms: (objects: readonly THREE.Object3D[]) => PrimTransformCommit[];
  duplicatePrim: (path: string) => string | null;
  deleteClone: (pseudo: string) => void;
} {
  const { getSceneHandle, allIndexed, override, local, objectsOf, editLocal, setSelected } = opts;

  /** Écrit un delta sur un prim ou un clone (un seul chemin d'écriture pour l'undo du gizmo). */
  const writeTransform = useCallback(
    (o: SceneOverride, path: string, transform: PrimTransform | null): SceneOverride => {
      const clone = parseClonePath(path);
      if (clone) return setCloneTransform(o, clone.path, clone.id, transform ?? IDENTITY_TRANSFORM);
      return setPrimEdit(o, path, { transform: transform ?? IDENTITY_TRANSFORM });
    },
    [],
  );

  const applyPrimTransform = useCallback(
    (path: string, transform: PrimTransform | null) => editLocal((o) => writeTransform(o, path, transform)),
    [editLocal, writeTransform],
  );

  /**
   * Fin de drag du gizmo de groupe (46.N, généralisé B1) : la pose de chaque représentant,
   * comparée à son état d'origine, devient le delta d'override de son prim — le tout en **un
   * seul lot** (`editLocal` unique → une seule publication du delta), que `applyPlan`
   * répercute ensuite sur tous les objets de chaque prim.
   */
  const commitPrimTransforms = useCallback(
    (objects: readonly THREE.Object3D[]) => {
      const commits: PrimTransformCommit[] = [];
      for (const object of objects) {
        const entry = allIndexed.find((e) => e.object === object);
        if (!entry) continue;
        const clone = parseClonePath(entry.primPath);
        const before = clone
          ? (clonesOf(override, clone.path).find((c) => c.id === clone.id)?.transform ?? null)
          : (local.prims[entry.primPath]?.transform ?? null);
        commits.push({ path: entry.primPath, before, after: transformDeltaFrom(entry.base, object) });
      }
      if (commits.length)
        editLocal((o) => commits.reduce((acc, c) => writeTransform(acc, c.path, c.after), o));
      return commits;
    },
    [allIndexed, override, local, editLocal, writeTransform],
  );

  /** Duplique un prim (ou un clone) : nouveau clone décalé d'un dixième de son rayon, sélectionné. */
  const duplicatePrim = useCallback(
    (path: string): string | null => {
      const clone = parseClonePath(path);
      const srcPath = clone?.path ?? path;
      if (clonesOf(override, srcPath).length >= 50) return null;
      // Delta de départ : celui de l'original (clone dupliqué → son delta ; prim → son override).
      const from = clone
        ? clonesOf(override, srcPath).find((c) => c.id === clone.id)?.transform
        : override.prims[srcPath]?.transform;
      const start = from ?? IDENTITY_TRANSFORM;
      // Décalage visible d'emblée : un dixième de l'encombrement de la géométrie source.
      const handle = getSceneHandle();
      let offset = 0.5;
      if (handle) {
        const box = new handle.THREE.Box3();
        for (const object of objectsOf(srcPath)) box.expandByObject(object);
        if (!box.isEmpty()) offset = Math.max((box.max.x - box.min.x) * 1.1, 0.1);
      }
      const id = newCloneId();
      editLocal((o) =>
        addClone(o, srcPath, {
          id,
          transform: { t: [start.t[0] + offset, start.t[1], start.t[2]], r: [...start.r], s: [...start.s] },
        }),
      );
      const pseudo = clonePath(srcPath, id);
      setSelected([pseudo]);
      return pseudo;
    },
    [override, getSceneHandle, objectsOf, editLocal, setSelected],
  );

  const deleteClone = useCallback(
    (pseudo: string) => {
      const clone = parseClonePath(pseudo);
      if (!clone) return;
      editLocal((o) => removeClone(o, clone.path, clone.id));
      setSelected((prev) => prev.filter((p) => p !== pseudo));
    },
    [editLocal, setSelected],
  );

  return { writeTransform, applyPrimTransform, commitPrimTransforms, duplicatePrim, deleteClone };
}
