// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { normalizeOverride } from '../review/three/sceneOverride';
import {
  applyPlan,
  indexPrimObjects,
  planOverride,
  type IndexedObject,
} from '../review/three/sceneOverrideApply';
import { useSceneClones } from '../review/three/useSceneClones';
import type { ViewerSceneHandle } from '../review/viewer/sceneHandle';
import { clientVariantDefaults } from './clientViewerModel';
import type { ClientMediaSource } from './clientTypes';

/** Frames to wait before giving up on indexing (converted GLB without `usdPath`). */
const MAX_INDEX_FRAMES = 60;

/**
 * Read-only replay of the persisted USD staging (46.D) for the guest: retained variants,
 * hidden prims, moved poses, staging clones. It is the same computation as the internal review
 * (`planOverride` + `useSceneClones`), stripped of everything that edits: no selection, gizmo,
 * isolation or write.
 *
 * Without `usdPrimPaths` in the share payload, the index stays empty and the scene displays as
 * the GLB was baked. This is a correct fallback, not the supervisor's staging.
 */
export function useClientSceneOverride(
  ready: boolean,
  getSceneHandle: () => ViewerSceneHandle | null,
  source: ClientMediaSource | undefined,
): void {
  const [indexed, setIndexed] = useState<IndexedObject<THREE.Object3D>[]>([]);
  const override = useMemo(() => normalizeOverride(source?.usdOverride), [source?.usdOverride]);
  const variantDefaults = useMemo(() => clientVariantDefaults(source?.usdVariantSets), [source]);

  // Stable key: the query returns a new array on each refetch, and re-indexing would treat
  // poses already moved by the override as the "original state".
  const primPathsKey = useMemo(() => (source?.usdPrimPaths ?? []).join('|'), [source]);

  useEffect(() => {
    if (!ready || !primPathsKey) return;
    let frame = 0;
    let attempts = 0;
    const paths = primPathsKey.split('|');
    const tryIndex = () => {
      const root = getSceneHandle()?.modelObject;
      const next = root ? indexPrimObjects(root, paths) : [];
      if (next.length > 0) {
        setIndexed(next);
        return;
      }
      if ((attempts += 1) > MAX_INDEX_FRAMES) return;
      frame = requestAnimationFrame(tryIndex);
    };
    tryIndex();
    return () => cancelAnimationFrame(frame);
  }, [ready, getSceneHandle, primPathsKey]);

  useEffect(() => {
    if (indexed.length === 0) return;
    applyPlan(planOverride(indexed, override, variantDefaults));
  }, [indexed, override, variantDefaults]);

  // Staging clones: reconciliation and application by the internal hook.
  useSceneClones(override, indexed, variantDefaults);
}
