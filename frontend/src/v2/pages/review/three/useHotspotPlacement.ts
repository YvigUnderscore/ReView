// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Hotspot3D } from '../reviewTypes';
import { isClickGesture } from './usdPicking';

/** Contrat minimal d'un viewer spatial capable de poser un hotspot (modèle 3D comme splat). */
export interface HotspotViewer {
  ready: boolean;
  getSceneHandle: () => { dom: HTMLElement } | null;
  hotspotAtPointer: (clientX: number, clientY: number) => Hotspot3D | null;
}

/**
 * Pose d'un hotspot **au clic**, dans le viewer 3D comme dans le viewer splat.
 *
 * Le bouton « poser un point » armait un rayon au centre de l'écran : pour désigner un défaut
 * il fallait recadrer la caméra dessus, alors que le picking au clic existait déjà juste à
 * côté. Ici, l'outil s'arme puis attend le clic ; un clic dans le vide ne pose rien (la scène
 * garde son point précédent), Échap désarme, et le curseur passe en réticule pour dire que le
 * viewer attend une désignation.
 */
export function useHotspotPlacement(viewer: HotspotViewer, onPlace: (hs: Hotspot3D) => void) {
  const { ready, getSceneHandle, hotspotAtPointer } = viewer;
  const [armed, setArmed] = useState(false);
  // Rappel rejoué par une ref : l'appelant en fournit un neuf à chaque rendu, et le
  // réinstaller ferait perdre le geste en cours.
  const onPlaceRef = useRef(onPlace);
  useEffect(() => {
    onPlaceRef.current = onPlace;
  });

  const arm = useCallback(() => setArmed((v) => !v), []);

  useEffect(() => {
    if (!armed || !ready) return;
    const dom = getSceneHandle()?.dom;
    if (!dom) return;
    const previousCursor = dom.style.cursor;
    dom.style.cursor = 'crosshair';
    let down: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      // Clic gauche immobile seulement : un glissement reste une orbite.
      if (e.button !== 0 || !start || !isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const hs = hotspotAtPointer(e.clientX, e.clientY);
      if (!hs) return;
      onPlaceRef.current(hs);
      setArmed(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setArmed(false);
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      dom.style.cursor = previousCursor;
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [armed, ready, getSceneHandle, hotspotAtPointer]);

  return { armed, arm };
}
