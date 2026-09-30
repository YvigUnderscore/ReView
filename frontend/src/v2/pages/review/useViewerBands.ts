// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { MEDIA_CANVAS, NO_BANDS, fitBands, type RefCanvas, type ViewerBands } from './referenceBox';

/** Valeur d'`overflow` qui rogne. Vide = propriété non calculée : on la tient pour `visible`. */
const clips = (value: string) => value !== '' && value !== 'visible';

/** Premier ancêtre qui rogne ce qui dépasse : c'est lui qui décide de ce qu'on voit. */
function clipAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (clips(style.overflow) || clips(style.overflowX) || clips(style.overflowY)) return p;
  }
  return null;
}

/**
 * Zone que le viewer montre, **en fractions du média** et au zoom courant : de quoi borner un
 * déplacement de référence au canevas visible sans le borner au cadre de l'image. Mesurée à
 * chaque geste (le zoom et le pan ne déclenchent aucun observateur : ils ne changent qu'une
 * transformation). Rien de mesurable ⇒ le cadre du média, prudemment.
 */
export function viewerCanvas(layer: HTMLElement): RefCanvas {
  const media = layer.getBoundingClientRect();
  const clip = (clipAncestor(layer) ?? layer).getBoundingClientRect();
  if (!(media.width > 0) || !(media.height > 0)) return MEDIA_CANVAS;
  const zone = {
    left: (clip.left - media.left) / media.width,
    top: (clip.top - media.top) / media.height,
    right: (clip.right - media.left) / media.width,
    bottom: (clip.bottom - media.top) / media.height,
  };
  return Object.values(zone).every((v) => Number.isFinite(v)) ? zone : MEDIA_CANVAS;
}

const same = (a: ViewerBands, b: ViewerBands) =>
  a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/**
 * Bandes libres autour du média dans le viewer, mesurées sur les **aspects** du média et de
 * la zone qui le rogne. Passer par les aspects plutôt que par les deux boîtes rend la mesure
 * indépendante du zoom : le rattrapage des positions héritées ne se ferait pas au premier cran
 * de molette (le média zoomé déborde alors le viewer, et toute bande mesurée en pixels serait
 * nulle). Ces bandes ne bornent aucun geste : une référence se pose où on la lâche.
 *
 * `mediaRef` désigne un calque qui épouse le média (`absolute inset-0` de son plan). Rien de
 * mesurable (conteneur sans hauteur, aucun ancêtre rogneur) ⇒ aucune bande, donc le cadre du
 * média pour seule zone : c'est le comportement prudent.
 */
export function useViewerBands(mediaRef: RefObject<HTMLElement | null>): ViewerBands {
  const [bands, setBands] = useState<ViewerBands>(NO_BANDS);

  useEffect(() => {
    const el = mediaRef.current;
    const viewport = el && clipAncestor(el);
    if (!el || !viewport) return;
    const measure = () => {
      const media = el.getBoundingClientRect();
      const clip = viewport.getBoundingClientRect();
      const next = fitBands(media.width / media.height, clip.width / clip.height);
      // Même objet si rien n'a bougé : sinon chaque impulsion de l'observateur rendrait le
      // calque des références pour rien.
      setBands((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [mediaRef]);

  return bands;
}
