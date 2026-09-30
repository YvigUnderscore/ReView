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

/** Frames d'attente avant d'abandonner l'indexation (GLB converti sans `usdPath`). */
const MAX_INDEX_FRAMES = 60;

/**
 * Rejeu **en lecture seule** de la mise en scène USD persistée (46.D) chez l'invité :
 * variantes retenues, prims masqués, poses déplacées, clones de mise en scène. C'est le même
 * calcul que la review interne (`planOverride` + `useSceneClones`), amputé de tout ce qui
 * édite : ni sélection, ni gizmo, ni isolement, ni écriture.
 *
 * Sans `usdPrimPaths` dans le payload de partage, l'index reste vide et la scène s'affiche
 * telle que le GLB a été cuit — un repli correct, pas la mise en scène du superviseur.
 */
export function useClientSceneOverride(
  ready: boolean,
  getSceneHandle: () => ViewerSceneHandle | null,
  source: ClientMediaSource | undefined,
): void {
  const [indexed, setIndexed] = useState<IndexedObject<THREE.Object3D>[]>([]);
  const override = useMemo(() => normalizeOverride(source?.usdOverride), [source?.usdOverride]);
  const variantDefaults = useMemo(() => clientVariantDefaults(source?.usdVariantSets), [source]);

  // Clé stable : la requête renvoie un tableau neuf à chaque rafraîchissement, et réindexer
  // relèverait comme « état d'origine » des poses déjà déplacées par l'override.
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

  // Clones de mise en scène : réconciliation et application par le hook interne.
  useSceneClones(override, indexed, variantDefaults);
}
