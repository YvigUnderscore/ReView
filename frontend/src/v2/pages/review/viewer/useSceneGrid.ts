// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';
import type * as THREE from 'three';
import type { SceneViewer, ViewerSceneHandle } from './sceneHandle';
import { EXCLUDE_FROM_CAPTURE } from './viewCapture';

const STORAGE_KEY = 'review-grid-visible';

/**
 * Ordre de rendu de la grille : **première de la passe transparente**, donc dessinée avant le
 * nuage de gaussiennes (lot 15).
 *
 * POURQUOI. Le quadrillage se voyait AU TRAVERS des splats. Spark ne dessine pas les `SplatMesh`
 * un par un — ce sont des `Object3D` sans matériau : tout le nuage (comparaison A/B comprise) sort
 * d'un seul `SparkRenderer`, un `THREE.Mesh` `transparent: true` / `depthTest: true` /
 * `depthWrite: false`, d'ordre de rendu 0. La grille est elle aussi transparente et n'écrit pas la
 * profondeur : rien ne les sépare que le tri de la passe transparente
 * (`reversePainterSortStable`), qui compare l'ordre de rendu, puis la distance, puis l'`id` de
 * l'objet. Les deux géométries sont centrées sur l'origine — leur distance de tri est donc
 * EXACTEMENT la même — et la grille naît après le renderer Spark : son `id` est plus grand, elle
 * passait donc en dernier, par-dessus le nuage. Rien de « selon l'angle » là-dedans : c'était faux
 * à chaque image, ce qui est bien ce que l'utilisateur constate.
 *
 * CE QUE ÇA COÛTE. La grille passe désormais sous TOUT ce qui est transparent, et il n'y a
 * toujours aucun test de profondeur entre elle et le nuage (qui n'en écrit pas) : un nuage très
 * translucide la laisse voir en filigrane, et une ligne de grille tendue DEVANT le nuage est
 * recouverte par lui. C'est le prix d'un nuage sans profondeur, et le seul levier à notre portée :
 * faire écrire la profondeur au nuage casserait son propre fondu arrière→avant, et les traits de
 * brosse s'appuient explicitement sur le contraire (`splat/paint/strokes.ts` : « au-dessus des
 * splats (qui n'écrivent pas la profondeur) »).
 *
 * Les autres repères restent au-dessus, et c'est voulu : traits de brosse (5), caméra du plan,
 * gizmo de mesure et overlay de squelette (999), gizmo de transformation (`Infinity`, posé par
 * `TransformControls`). Les pastilles de POI et le guide letterbox sont du DOM, hors de ce tri.
 * Le filaire des volumes de coupe est opaque : il est dessiné avant toute la passe transparente.
 */
export const GRID_RENDER_ORDER = -1;

/** Ce qu'il faut d'un viewer pour y poser la grille : les modules Three et la scène. */
export type SceneGridTarget = Pick<ViewerSceneHandle, 'THREE' | 'scene'>;

export interface MountedSceneGrid {
  grid: THREE.GridHelper;
  /** Retire la grille de la scène et libère sa géométrie/son matériau. */
  dispose: () => void;
}

/**
 * Pose la grille de sol dans une scène montée et rend son démontage. Séparé du hook : tout ce qui
 * décide de l'aspect et de l'ORDRE de dessin se teste ainsi sans React ni WebGL.
 */
export function createSceneGrid(target: SceneGridTarget): MountedSceneGrid {
  const grid = new target.THREE.GridHelper(20, 40, 0x8888aa, 0x444455);
  grid.userData[EXCLUDE_FROM_CAPTURE] = true; // repère d'écran : hors capture de vue
  const mat = grid.material;
  mat.transparent = true;
  mat.opacity = 0.25;
  mat.depthWrite = false;
  grid.renderOrder = GRID_RENDER_ORDER; // sous le nuage : cf. le commentaire ci-dessus
  target.scene.add(grid);
  return {
    grid,
    dispose: () => {
      target.scene.remove(grid);
      grid.dispose();
    },
  };
}

/**
 * Grille de sol des viewers 3D/splat : repère d'orientation de la scène (plan Y=0),
 * togglable depuis le HUD, préférence persistée en localStorage. Un seul code pour les
 * deux viewers via la poignée commune `SceneViewer` (Phase 17).
 *
 * C'est un repère d'ÉCRAN : la capture de vue la retire (cf. `viewCapture`), une image qui
 * repart dans une compo n'a que faire du quadrillage qui aide à s'orienter.
 */
export function useSceneGrid(viewer: SceneViewer): { visible: boolean; toggle: () => void } {
  const [visible, setVisible] = useState(() => localStorage.getItem(STORAGE_KEY) !== '0');
  const { ready, getSceneHandle } = viewer;

  useEffect(() => {
    const h = getSceneHandle();
    if (!ready || !h || !visible) return;
    const mounted = createSceneGrid(h);
    return mounted.dispose;
  }, [ready, getSceneHandle, visible]);

  const toggle = useCallback(() => {
    setVisible((v) => {
      localStorage.setItem(STORAGE_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  return { visible, toggle };
}
