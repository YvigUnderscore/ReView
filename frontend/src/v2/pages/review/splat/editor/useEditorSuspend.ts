// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type RefObject } from 'react';
import type { SplatTransform } from '../../reviewTypes';
import type { SplatViewer } from '../useSplat';
import { detachVolume, reattachVolume, type VolumeRuntime } from './volumes/cropVolume';

/**
 * **Suspension de l'éditeur pendant la lecture d'une proposition** (Phase 50, lot 14).
 *
 * Un gestionnaire est la seule personne capable de PRODUIRE une proposition d'édition de nuage.
 * C'est donc précisément à lui qu'il faut pouvoir en montrer une — et jusqu'au lot 14, le rejeu
 * se coupait dès que l'éditeur était monté : deux gestionnaires ne pouvaient pas se lire l'un
 * l'autre, le bandeau « scène proposée » s'allumait et le nuage ne bougeait pas.
 *
 * Le viewer n'a qu'un nuage : la réponse n'est pas de renoncer au rejeu, c'est de **rendre la
 * main**. Pendant la lecture, l'édition locale se retire de la scène ; à la sortie (Échap, ou
 * désélection du commentaire), elle revient telle qu'elle était.
 *
 * Ce qui se suspend, et ce qui ne se suspend pas :
 *  - la **transformation** du nuage et le **flip** d'orientation → rendus à la proposition, puis
 *    ré-appliqués à l'identique à la sortie ;
 *  - les **volumes de crop** locaux → détachés de la scène, jamais libérés (leur TRS reste
 *    lisible, l'enregistrement d'après la porte intacte), puis ré-attachés ;
 *  - les **splats supprimés localement** → ils RESTENT masqués. Un splat masqué a perdu son
 *    opacité d'origine dans les données paquées (`hideSplats` écrit 0) : la rendre exigerait un
 *    instantané que l'éditeur ne garde pas. La proposition lue masque donc ce qu'elle veut en
 *    plus, et c'est tout ce qu'on peut promettre honnêtement — ce que l'auteur a déjà supprimé
 *    ne réapparaît pas le temps d'une lecture.
 */
export function useEditorSuspend(opts: {
  /** L'éditeur est-il monté ? (hors éditeur, il n'y a rien à suspendre) */
  enabled: boolean;
  /** Une proposition de commentaire est-elle en cours de lecture ? */
  suspended: boolean;
  splat: SplatViewer;
  /** Volumes de crop vivants de l'éditeur, par identifiant. */
  runtimesRef: RefObject<Map<number, VolumeRuntime>>;
  /** TRS et flip locaux, à rendre à l'identique à la sortie. */
  transform: SplatTransform;
  baseFlip: boolean;
}): void {
  const { enabled, suspended, splat, runtimesRef, transform, baseFlip } = opts;
  const { ready, applyTransform, setBaseFlip, getSceneHandle } = splat;
  /**
   * L'état local le plus RÉCENT, lu au moment de rendre la main.
   *
   * Un ref, et non des dépendances d'effet : mettre `transform` en dépendance relancerait la
   * suspension à chaque cran d'édition, et le lire dans la fermeture de l'effet rendrait la
   * valeur d'il y a une lecture — celle d'avant, si l'auteur a reposé la main sur le gizmo
   * pendant qu'il lisait la proposition d'un autre.
   */
  const local = useRef({ transform, baseFlip });
  useEffect(() => {
    local.current = { transform, baseFlip };
  }, [transform, baseFlip]);

  useEffect(() => {
    if (!enabled || !suspended || !ready) return;
    const handle = getSceneHandle();
    const detached = [...runtimesRef.current.values()];
    detached.forEach(detachVolume);
    return () => {
      if (handle) detached.forEach((runtime) => reattachVolume(handle, runtime));
      // Le rejeu de la proposition a écrit la TRS et le flip dans la scène : on les réécrit
      // avec les valeurs locales, que l'état React n'a jamais perdues.
      applyTransform(local.current.transform);
      setBaseFlip(local.current.baseFlip);
    };
  }, [enabled, suspended, ready, getSceneHandle, runtimesRef, applyTransform, setBaseFlip]);
}
