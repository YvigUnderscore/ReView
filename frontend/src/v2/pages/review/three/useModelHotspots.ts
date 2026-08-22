// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, type RefObject } from 'react';
import type { Hotspot3D } from '../reviewTypes';
import { raycastModelCenter, raycastModelPoint, toMarkerPoint, type MarkerPoint } from './objectHotspot';
import { toNdc } from './usdPicking';
import type { SceneRuntime } from './useModel3DThree';

/**
 * Hotspots de surface du viewer 3D : pose au clic (là où l'on désigne le défaut), pose au
 * centre (repli sans pointeur : palette, raccourci) et affichage des pastilles.
 *
 * `hotspotRef` est lu par la boucle de rendu à chaque frame — une ref, jamais un état : le
 * marqueur se reprojette sans provoquer de rendu React.
 */
export function useModelHotspots(params: {
  runtimeRef: RefObject<SceneRuntime | null>;
  threeRef: RefObject<typeof import('three') | null>;
}) {
  const { runtimeRef, threeRef } = params;
  const hotspotRef = useRef<MarkerPoint[] | null>(null);

  const hotspotAtCenter = useCallback((): Hotspot3D | null => {
    const rt = runtimeRef.current;
    const THREE = threeRef.current;
    return rt && THREE ? raycastModelCenter(THREE, rt.scene.camera, rt.scene.root) : null;
  }, [runtimeRef, threeRef]);

  /** Hotspot posé sous le pointeur (coordonnées client) — placement au clic dans le viewer. */
  const hotspotAtPointer = useCallback(
    (clientX: number, clientY: number): Hotspot3D | null => {
      const rt = runtimeRef.current;
      const THREE = threeRef.current;
      if (!rt || !THREE) return null;
      const rect = rt.scene.renderer.domElement.getBoundingClientRect();
      return raycastModelPoint(THREE, rt.scene.camera, rt.scene.root, toNdc(clientX, clientY, rect));
    },
    [runtimeRef, threeRef],
  );

  /** Affiche un hotspot, ou plusieurs (pastilles numérotées dans l'ordre reçu). */
  const showHotspot = useCallback(
    (hs: Hotspot3D | Hotspot3D[] | null) => {
      const THREE = threeRef.current;
      const list = hs == null ? [] : Array.isArray(hs) ? hs : [hs];
      if (!THREE || list.length === 0) {
        hotspotRef.current = null;
        return;
      }
      const points = list.map((h) => toMarkerPoint(THREE, h)).filter((p): p is MarkerPoint => p !== null);
      hotspotRef.current = points.length ? points : null;
    },
    [threeRef],
  );

  return { hotspotRef, hotspotAtCenter, hotspotAtPointer, showHotspot };
}
