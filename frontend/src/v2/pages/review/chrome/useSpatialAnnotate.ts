// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type { Annotations } from '../useAnnotations';
import type { ChromeState } from './chromeState';
import type { ToolId } from './tools';

/**
 * Bouton « Annoter » du composer ↔ mode « Annoter » du rail, pour les **viewers spatiaux**.
 *
 * Les médias plats ont ce pont depuis la Phase 50 (`useMediaChrome`) ; le modèle 3D et le splat,
 * non. Conséquence, constatée par l'utilisateur : cliquer « Annoter » sur une scène n'armait que
 * le calque de dessin 2D, avec son crayon et rien d'autre — le rail restait en exploration, et
 * les outils d'annotation de la scène (brosse de surface, gomme de trait, point d'intérêt) comme
 * leurs réglages n'apparaissaient nulle part.
 *
 * Trois règles, chacune sur un FRONT et non sur un état — deux effets qui réagissent à l'état se
 * contrediraient à chaque rendu, l'un rallumant ce que l'autre vient d'éteindre :
 *
 *  1. **Le bouton arme le mode** (front montant de `annotating`). Son front descendant, lui, ne
 *     change pas le mode : ranger le crayon n'est pas sortir de l'annotation, et c'est
 *     précisément ce que fait la règle 3.
 *  2. **Sortir du mode éteint le bouton** (front descendant de « mode Annoter ») : il ne reste
 *     pas allumé sur une annotation qu'on vient de quitter.
 *  3. **Un outil de la scène reprend le pointeur.** Le calque 2D couvre tout le cadre (`z-[6]`)
 *     et, armé, capte le pointeur : il avalait les clics destinés à la surface — c'est ce qui
 *     rendait le placement d'un point d'intérêt inerte dès qu'on avait cliqué « Annoter ». Armer
 *     la brosse, la gomme ou l'épingle range donc le crayon 2D, qui reste ce que l'outil de
 *     repos laisse à l'écran.
 */

/** Outils dont le geste vise la SCÈNE : ils ne peuvent pas partager le pointeur avec le calque 2D. */
const SCENE_POINTER_TOOLS = new Set<ToolId>(['paint', 'paint-erase', 'pin']);

export function useSpatialAnnotate({
  state,
  update,
  ann,
}: {
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  ann: Annotations;
}): void {
  const { annotating, setAnnotating } = ann;
  const annotateMode = state.mode === 'annotate';
  const tool = state.tool;

  const wasAnnotating = useRef(annotating);
  useEffect(() => {
    if (annotating === wasAnnotating.current) return;
    wasAnnotating.current = annotating;
    if (annotating) update({ mode: 'annotate' });
  }, [annotating, update]);

  const wasAnnotateMode = useRef(annotateMode);
  useEffect(() => {
    if (annotateMode === wasAnnotateMode.current) return;
    wasAnnotateMode.current = annotateMode;
    if (!annotateMode) setAnnotating(false);
  }, [annotateMode, setAnnotating]);

  useEffect(() => {
    if (annotating && SCENE_POINTER_TOOLS.has(tool)) setAnnotating(false);
  }, [annotating, tool, setAnnotating]);
}
