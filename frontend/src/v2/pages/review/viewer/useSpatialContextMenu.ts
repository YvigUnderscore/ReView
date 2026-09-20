// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isContextTap } from './contextGesture';

/**
 * Clic droit des viewers spatiaux — **bref** ouvre le menu contextuel, **maintenu** vole
 * (Phase 50, lot 8). Un seul hook pour le splat et le modèle 3D : le geste est le même, seul le
 * contenu du menu diffère.
 *
 * Le verdict est rendu au **relâchement du bouton**, jamais à l'arrivée de l'événement
 * `contextmenu` : Chromium le déclenche sur le `mouseup` sous Windows et sur le `mousedown`
 * ailleurs. Mesurer le geste à ce moment-là rendait donc la distinction dépendante de la
 * plateforme — sur un système qui notifie à l'appui, tout vol aurait ouvert le menu avant même
 * d'avoir commencé. L'événement natif du canvas est simplement arrêté, dans tous les cas.
 *
 * Le menu lui-même est un `ContextMenu` Radix qui enveloppe le pane. On ne peut pas lui laisser
 * l'événement du canvas : `flyControls` l'a déjà consommé (suppression du menu natif), et Radix
 * ignore un événement `defaultPrevented`. On relance donc un événement **neuf** un cran au-dessus
 * du canvas — il remonte jusqu'au menu sans repasser par les écouteurs de vol ni par celui-ci.
 */
export function useSpatialContextMenu(
  /** Canvas du viewer (résolu à la demande : la scène est montée en asynchrone). */
  getDom: () => HTMLElement | null,
  ready: boolean,
  /**
   * Prépare le menu et dit s'il doit s'ouvrir. Le viewer 3D y résout le prim visé et refuse le
   * vide ; le splat accepte toujours — ses entrées portent sur la vue, pas sur un objet.
   */
  prepare: (tap: { clientX: number; clientY: number; altKey: boolean }) => boolean,
): void {
  const down = useRef<{ x: number; y: number; at: number } | null>(null);
  // Rappel rejoué par une ref : l'appelant en fournit un neuf à chaque rendu, et réinstaller les
  // écouteurs entre l'appui et le relâchement ferait perdre l'origine du geste.
  const prepareRef = useRef(prepare);
  useEffect(() => {
    prepareRef.current = prepare;
  }, [prepare]);

  useEffect(() => {
    if (!ready) return;
    const dom = getDom();
    if (!dom) return;

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) down.current = { x: e.clientX, y: e.clientY, at: e.timeStamp };
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (e.button !== 2 || !start) return;
      const tap = {
        dx: e.clientX - start.x,
        dy: e.clientY - start.y,
        heldMs: e.timeStamp - start.at,
      };
      if (!isContextTap(tap)) return; // glissé ou maintenu : c'était un vol
      if (!prepareRef.current({ clientX: e.clientX, clientY: e.clientY, altKey: e.altKey })) return;
      dom.parentElement?.dispatchEvent(
        new MouseEvent('contextmenu', {
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    // Le canvas ne sert jamais le menu natif : c'est le geste ci-dessus qui décide, et lui seul.
    const onCtx = (e: MouseEvent) => e.stopPropagation();

    // PHASE DE CAPTURE : les contrôles de caméra sont posés sur le même élément et coupent la
    // propagation pour les boutons qu'ils traitent (cf. `useUsdPicking`). La capture descend
    // avant toute écoute en bulle ; ces écouteurs n'empêchent rien d'autre.
    dom.addEventListener('pointerdown', onDown, true);
    dom.addEventListener('pointerup', onUp, true);
    dom.addEventListener('pointercancel', onUp, true);
    dom.addEventListener('contextmenu', onCtx);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      dom.removeEventListener('pointerup', onUp, true);
      dom.removeEventListener('pointercancel', onUp, true);
      dom.removeEventListener('contextmenu', onCtx);
    };
  }, [getDom, ready]);
}
