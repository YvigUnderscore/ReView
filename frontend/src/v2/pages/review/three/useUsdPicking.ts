// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef } from 'react';
import type * as THREE from 'three';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { isClickGesture, pickPrim, toNdc } from './usdPicking';

/**
 * Résout le prim visé par un point écran. `exact` (Alt+clic) court-circuite la promotion au
 * component englobant et descend à la feuille touchée.
 */
export type UsdPickAt = (clientX: number, clientY: number, exact?: boolean) => string | null;

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
 *
 * Le **clic droit** n'est plus traité ici. Il porte deux gestes contradictoires (vol maintenu,
 * menu contextuel bref) et les départager est l'affaire d'un seul module, partagé avec le splat :
 * `viewer/useSpatialContextMenu`. Ce hook lui prête seulement sa résolution de prim, rendue par
 * `pickAt` — sans quoi le menu s'ouvrirait aussi au milieu d'un vol, où le pointeur a bougé.
 */
export function useUsdPicking(
  getSceneHandle: () => ViewerSceneHandle | null,
  ready: boolean,
  onSelect: (path: string | null, opts?: { additive?: boolean }) => void,
  /**
   * Traduit l'objet touché en prim — l'index de la scène, seule table faisant autorité.
   *
   * Le viewer y branche `resolvePick`, qui **promeut** la feuille touchée au `component` USD
   * englobant : on clique une chaise, on sélectionne la chaise. `exact` court-circuite cette
   * promotion pour descendre à la pièce précise ; c'est **Alt+clic** qui le demande — Ctrl/⌘
   * sert déjà à la multi-sélection, et Maj à la plage dans l'arbre.
   */
  resolve: (object: THREE.Object3D, opts?: { exact?: boolean }) => string | null,
): UsdPickAt {
  const down = useRef<{ x: number; y: number } | null>(null);
  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);

  /**
   * Prim visé par un point écran. Construit au niveau du hook, et non dans la portée de l'effet :
   * le menu contextuel spatial s'en sert au relâchement du bouton droit, hors de cet effet.
   */
  const pickAt = useCallback<UsdPickAt>(
    (clientX, clientY, exact = false) => {
      const handle = getSceneHandle();
      const dom = handle?.dom;
      const root = handle?.modelObject;
      if (!handle || !dom || !root) return null;
      const rect = dom.getBoundingClientRect();
      return pickPrim(handle.THREE, handle.camera, root, toNdc(clientX, clientY, rect), (object) =>
        resolveRef.current(object, { exact }),
      );
    },
    [getSceneHandle],
  );

  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    const dom = handle?.dom;
    const root = handle?.modelObject;
    if (!handle || !dom || !root) return;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (e.button !== 0 || !start) return;
      if (!isClickGesture(e.clientX - start.x, e.clientY - start.y)) return;
      // Ctrl/⌘+clic : ajoute ou retire le prim de la sélection (multi-sélection B1).
      onSelect(pickAt(e.clientX, e.clientY, e.altKey), { additive: e.ctrlKey || e.metaKey });
    };

    // PHASE DE CAPTURE pour les événements de pointeur.
    //
    // Les contrôles de caméra sont posés sur le même élément et traitent le bouton GAUCHE
    // (orbite) : leur `pointerdown` arrêtait la propagation avant que celui-ci n'enregistre
    // l'origine du geste. `down.current` restait donc nul, `onUp` sortait aussitôt, et un
    // clic gauche ne sélectionnait jamais rien — alors que le clic DROIT, que ces contrôles
    // traitent autrement (vol libre), atteignait bien ce module : le menu du prim s'ouvrait
    // et « Cadrer » visait le bon objet. C'est cette asymétrie qui a mis sur la piste.
    //
    // La capture descend avant toute écoute en bulle : on note l'origine du geste sans rien
    // empêcher — ces deux écouteurs n'appellent ni `preventDefault` ni `stopPropagation`,
    // l'orbite continue de fonctionner exactement comme avant.
    dom.addEventListener('pointerdown', onDown, true);
    dom.addEventListener('pointerup', onUp, true);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      dom.removeEventListener('pointerup', onUp, true);
    };
  }, [getSceneHandle, ready, onSelect, pickAt]);

  return pickAt;
}
