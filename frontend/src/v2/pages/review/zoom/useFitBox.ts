// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import {
  commonZone,
  containBox,
  useCompareFitPublish,
  useCompareFitZone,
  type Size,
} from '../compare/compareFit';

/** Boîte d'affichage du média (pixels) — l'overlay d'annotation partage exactement la même. */
export type FitBox = Size;

/**
 * Ajustement « contain » calculé à la main : le média remplit tout l'espace disponible,
 * même en basse résolution, et l'overlay d'annotation peut se caler sur la même boîte.
 *
 * `remeasureKey` force une nouvelle mesure quand la taille du conteneur change sans que
 * le conteneur lui-même change (entrée/sortie du plein écran) : sans elle, la vidéo
 * gardait sa taille d'avant, minuscule au centre de l'écran noir.
 *
 * Dans une comparaison (`CompareFitProvider`), la zone mesurée est **inscrite** et le média
 * s'ajuste dans la zone commune à tous les panes : deux médias de résolutions différentes
 * s'affichent alors à la même taille, alors que le pane maître (timeline + transport sous
 * l'image) et les panes B (en-tête) n'ont jamais la même hauteur disponible.
 *
 * `grouped` faux sort le pane de ce partage : un pane passé seul en plein écran n'a plus à
 * tenir dans la zone des autres, restés à leur taille de mise en page derrière lui.
 */
export function useFitBox(
  containerRef: RefObject<HTMLElement | null>,
  remeasureKey?: unknown,
  grouped = true,
): { box: FitBox | null; aspect: number | null; setAspect: (aspect: number) => void } {
  const [aspect, setAspect] = useState<number | null>(null);
  const [zone, setZone] = useState<Size | null>(null);
  const publish = useCompareFitPublish();
  const groupZone = useCompareFitZone();
  const paneId = useId();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // Même mesure : on rend l'objet d'origine, sinon chaque impulsion de l'observateur
      // provoquerait un rendu du lecteur pour rien.
      setZone((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, remeasureKey]);

  // Inscription au groupe de comparaison — retirée au démontage du pane, sinon la zone d'un
  // pane fermé continuerait de rapetisser celle des autres.
  useEffect(() => {
    if (!publish || !zone || !grouped) return;
    publish(paneId, zone);
    return () => publish(paneId, null);
  }, [publish, paneId, zone, grouped]);

  const box = useMemo(() => {
    // La zone commune compte l'inscription de ce pane, mais pas encore au premier rendu :
    // on la recroise avec la mesure locale pour ne jamais déborder de sa propre zone.
    const z = commonZone([zone, grouped ? groupZone : null].filter((s): s is Size => s != null));
    if (!z || !aspect) return null;
    return containBox(z, aspect);
  }, [zone, groupZone, grouped, aspect]);

  return { box, aspect, setAspect };
}
