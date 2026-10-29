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

/** Delta of a prim before/after a gizmo drag — the material of undo (46.N). */
export interface PrimTransformCommit {
  path: string;
  before: PrimTransform | null;
  after: PrimTransform;
}

/**
 * Writes prim and clone poses (46.N, C1): group gizmo commit, duplication, clone deletion. Everything
 * goes through `editLocal` — one batch per gesture, hence a single publication of the delta.
 * Extracted from `useUsdScene` (line budget).
 */
export function usePrimTransforms(opts: {
  getSceneHandle: () => ViewerSceneHandle | null;
  /** GLB objects **and** clone copies — that is where the original state is found. */
  allIndexed: IndexedObject<THREE.Object3D>[];
  /** Effective override (base + proposal + local exploration). */
  override: SceneOverride;
  /** Local exploration alone — the "before" state of a non-cloned prim. */
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

  /** Writes a delta on a prim or a clone (a single write path for the gizmo's undo). */
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
   * End of a group-gizmo drag (46.N, generalized B1): the pose of each representative, compared with
   * its original state, becomes the override delta of its prim — all in **one batch** (a single
   * `editLocal` → a single publication of the delta), which `applyPlan` then propagates to all
   * objects of each prim.
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

  /** Duplicates a prim (or a clone): new clone offset by a tenth of its radius, selected. */
  const duplicatePrim = useCallback(
    (path: string): string | null => {
      const clone = parseClonePath(path);
      const srcPath = clone?.path ?? path;
      if (clonesOf(override, srcPath).length >= 50) return null;
      // Starting delta: that of the original (duplicated clone → its delta; prim → its override).
      const from = clone
        ? clonesOf(override, srcPath).find((c) => c.id === clone.id)?.transform
        : override.prims[srcPath]?.transform;
      const start = from ?? IDENTITY_TRANSFORM;
      // Visible offset right away: a tenth of the source geometry's footprint.
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
