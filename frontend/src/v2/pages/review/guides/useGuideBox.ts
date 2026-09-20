// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useState, type RefObject } from 'react';

/** Boîte de dessin des repères : taille de mise en page (px CSS) et échelle à l'écran. */
export interface GuideBox {
  w: number;
  h: number;
  /** Facteur d'échelle cumulé des ancêtres transformés (zoom du lecteur) — 1 = ajusté. */
  scale: number;
}

/**
 * Boîte de repli quand rien n'est mesurable (rendu hors navigateur, conteneur de taille
 * nulle) : l'aspect importe peu puisque rien n'est visible, mais le SVG reste cohérent.
 */
export const FALLBACK_GUIDE_BOX: GuideBox = { w: 1920, h: 1080, scale: 1 };

/** Sous ce seuil, une variation d'échelle ne change pas un trait d'un pixel : on l'ignore. */
const SCALE_STEP = 1000;

/**
 * Mesure la boîte de l'overlay **et l'échelle du calque zoomé qui le porte**.
 *
 * L'overlay des repères vit dans le calque transformé du lecteur (`translate(...) scale(...)`
 * du zoom vidéo, comme du viewer image) : tout ce qu'il dessine y est multiplié par l'échelle,
 * traits compris — les repères s'épaississaient donc en zoomant. `vector-effect:
 * non-scaling-stroke` n'y peut rien : il neutralise la transformation **interne** du SVG
 * (viewBox → viewport), pas une transformation CSS posée sur un ancêtre HTML.
 *
 * L'échelle est relevée en comparant le rectangle écran (`getBoundingClientRect`, qui inclut
 * les transformations) à la taille de mise en page (`offsetWidth`, qui les ignore). Aucun
 * événement ne signale un changement de transformation, et dans le viewer image le zoom ne
 * provoque même pas de rendu de l'overlay (élément épinglé, identité stable) : on relève donc
 * à chaque trame — uniquement tant qu'un repère est affiché, ce qui n'est pas le cas par défaut.
 */
export function useGuideBox(ref: RefObject<HTMLElement | null>, enabled: boolean): GuideBox {
  const [box, setBox] = useState<GuideBox>(FALLBACK_GUIDE_BOX);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const tick = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        const rect = el.getBoundingClientRect();
        const measured = rect.width > 0 ? rect.width / w : 1;
        const scale = Math.round(measured * SCALE_STEP) / SCALE_STEP || 1;
        setBox((prev) => (prev.w === w && prev.h === h && prev.scale === scale ? prev : { w, h, scale }));
      }
      raf = requestAnimationFrame(tick);
    };
    // Premier relevé synchrone, avant peinture : les repères naissent déjà à la bonne taille.
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ref, enabled]);

  return box;
}
