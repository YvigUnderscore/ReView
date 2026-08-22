// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';

/** Boîte d'affichage du média (pixels) — l'overlay d'annotation partage exactement la même. */
export interface FitBox {
  w: number;
  h: number;
}

/**
 * Ajustement « contain » calculé à la main : le média remplit tout l'espace disponible,
 * même en basse résolution, et l'overlay d'annotation peut se caler sur la même boîte.
 *
 * `remeasureKey` force une nouvelle mesure quand la taille du conteneur change sans que
 * le conteneur lui-même change (entrée/sortie du plein écran) : sans elle, la vidéo
 * gardait sa taille d'avant, minuscule au centre de l'écran noir.
 */
export function useFitBox(
  containerRef: RefObject<HTMLElement | null>,
  remeasureKey?: unknown,
): { box: FitBox | null; aspect: number | null; setAspect: (aspect: number) => void } {
  const [aspect, setAspect] = useState<number | null>(null);
  const [box, setBox] = useState<FitBox | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !aspect) return;
    const fit = () => {
      const h = Math.min(el.clientHeight, el.clientWidth / aspect);
      const w = h * aspect;
      // Même boîte : on rend le même objet, sinon chaque impulsion de l'observateur
      // provoquerait un rendu du lecteur pour rien.
      setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, aspect, remeasureKey]);

  return { box, aspect, setAspect };
}
