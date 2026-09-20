// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { useSpatialContextMenu } from '../viewer/useSpatialContextMenu';
import { useUsdPicking } from './useUsdPicking';

/** Ce que le hook attend du viewer 3D : sa scène et son canvas. */
interface PrimPointerViewer {
  getSceneHandle: () => ViewerSceneHandle | null;
  getDom: () => HTMLElement | null;
}

/**
 * Les deux gestes du pointeur dans le viewer 3D, montés ensemble parce qu'ils partagent la même
 * résolution de prim : **clic gauche immobile** = sélection (`useUsdPicking`), **clic droit bref**
 * = menu du prim visé. Le clic droit maintenu, lui, appartient au vol — c'est
 * `viewer/useSpatialContextMenu`, partagé avec le splat, qui départage les deux au relâchement.
 *
 * Ce qui est propre au modèle 3D tient en deux règles : dans le vide, **aucun menu** (toutes ses
 * entrées portent sur un prim), et le prim visé passe aussi en sélection — on agit sur ce qu'on
 * voit surligné. Le chemin est rendu comme état, et non comme rappel : le `ContextMenu` qui
 * enveloppe le pane doit peupler son contenu au rendu, avant que Radix ne l'ouvre.
 */
export function usePrimPointer(
  viewer: PrimPointerViewer,
  ready: boolean,
  select: (path: string | null, opts?: { additive?: boolean }) => void,
  /** Résolveur du viewer : promotion au component englobant, `exact` pour la feuille (Alt+clic). */
  resolvePick: (object: THREE.Object3D, opts?: { exact?: boolean }) => string | null,
): string | null {
  const [path, setPath] = useState<string | null>(null);
  const pickAt = useUsdPicking(viewer.getSceneHandle, ready, select, resolvePick);
  useSpatialContextMenu(viewer.getDom, ready, (tap) => {
    const hit = pickAt(tap.clientX, tap.clientY, tap.altKey);
    if (!hit) return false;
    select(hit);
    setPath(hit);
    return true;
  });
  return path;
}
