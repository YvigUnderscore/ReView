// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { isClickGesture, pickPrim, toNdc } from './usdPicking';

/**
 * Sélection d'un prim au clic dans le viewer 3D (Phase 46, 46.C).
 *
 * Le clic gauche pilote aussi l'orbite : on n'interprète le geste comme une sélection que si
 * le pointeur n'a pas bougé entre l'appui et le relâchement. Un clic dans le vide désélectionne,
 * comme dans un DCC.
 *
 * La position d'appui vit dans une **ref** et non dans la portée de l'effet : le hook du viewer
 * renvoie un objet neuf à chaque rendu, donc un rendu survenant entre l'appui et le relâchement
 * réinstallerait les écouteurs et ferait perdre l'origine du geste — tout clic passerait alors
 * pour un glissement. Pour la même raison, l'effet ne dépend que de `getSceneHandle`, stable.
 *
 * `ready` doit être celui du viewer Three (`useModel3DThree.ready`) : l'effet ne s'exécute qu'une
 * fois, et branché sur un « média affichable » il tombait sur une scène encore vide et
 * n'installait jamais les écouteurs — aucun clic ne sélectionnait quoi que ce soit.
 *
 * `resolve` passe lui aussi par une ref : il est reconstruit quand l'index de la scène arrive,
 * **après** l'installation des écouteurs. Capturé dans la portée de l'effet, il resterait celui
 * d'un index vide et tout clic résoudrait `null`.
 */
export function useUsdPicking(
  getSceneHandle: () => ViewerSceneHandle | null,
  ready: boolean,
  onSelect: (path: string | null, opts?: { additive?: boolean }) => void,
  /** Traduit l'objet touché en prim — l'index de la scène, seule table faisant autorité. */
  resolve: (object: THREE.Object3D) => string | null,
  /**
   * Clic droit **immobile** sur un prim (46.M) : le prim est sélectionné puis ce rappel est
   * invoqué, et l'événement remonte jusqu'au `ContextMenu` qui enveloppe le viewer. Un clic
   * droit glissé reste un vol ; dans le vide, rien ne s'ouvre — l'événement est arrêté.
   */
  onContext?: (path: string) => void,
): void {
  const down = useRef<{ x: number; y: number } | null>(null);
  const downRight = useRef<{ x: number; y: number } | null>(null);
  const resolveRef = useRef(resolve);
  const onContextRef = useRef(onContext);
  useEffect(() => {
    resolveRef.current = resolve;
    onContextRef.current = onContext;
  }, [resolve, onContext]);

  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;

    const pickAt = (clientX: number, clientY: number) => {
      const rect = dom.getBoundingClientRect();
      return pickPrim(handle.THREE, handle.camera, root, toNdc(clientX, clientY, rect), resolveRef.current);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) downRight.current = { x: e.clientX, y: e.clientY };
      else down.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (e.button !== 0 || !start) return;
      if (!isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      // Ctrl/⌘+clic : ajoute ou retire le prim de la sélection (multi-sélection B1).
      onSelect(pickAt(e.clientX, e.clientY), { additive: e.ctrlKey || e.metaKey });
    };
    const onCtx = (e: MouseEvent) => {
      const start = downRight.current;
      downRight.current = null;
      e.stopPropagation();
      // Glissement = vol ; vide = rien : le menu ne s'ouvre jamais sans objet visé.
      if (!start || !isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      const path = pickAt(e.clientX, e.clientY);
      if (!path) return;
      onSelect(path);
      onContextRef.current?.(path);
      // `flyControls` a déjà `preventDefault()` l'événement sur le canvas (menu natif), et le
      // ContextMenu enveloppant ignore un événement déjà consommé. On relance donc un événement
      // **neuf** un cran au-dessus du canvas : il remonte jusqu'au menu sans repasser par les
      // écouteurs de vol ni par celui-ci.
      dom.parentElement?.dispatchEvent(
        new MouseEvent('contextmenu', {
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('contextmenu', onCtx);
    return () => {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('contextmenu', onCtx);
    };
  }, [getSceneHandle, ready, onSelect]);
}
