// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';
import { safePlay } from './reviewTypes';
import type { MontageContext } from './MontageTrack';

/**
 * Ce qui relie la review au montage qui l'englobe (Phase 46) : entrer dans un plan, puis
 * enchaîner sur le suivant.
 *
 * Sans cela, un montage ne serait qu'une liste de liens : il faudrait cliquer « lire » à
 * chaque plan et retrouver soi-même l'endroit où l'on en était.
 */
export function useMontageWiring({
  montage,
  videoRef,
  programmaticSeekRef,
  ready,
}: {
  montage?: MontageContext;
  videoRef: RefObject<HTMLVideoElement | null>;
  programmaticSeekRef: { current: boolean };
  /** Le média est chargé : avant, l'élément vidéo n'a ni source ni durée. */
  ready: boolean;
}): void {
  const startAt = montage?.startAt ?? 0;
  const autoPlay = montage?.autoPlay ?? false;
  const enabled = !!montage;

  // Entrée dans le plan : on reprend le film là où la bande l'annonçait, et il repart seul
  // s'il était en lecture — sinon chaque changement de plan demanderait un clic.
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;
    const apply = () => {
      if (startAt > 0) {
        programmaticSeekRef.current = true;
        video.currentTime = startAt;
      }
      if (autoPlay) safePlay(video);
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener('loadedmetadata', apply, { once: true });
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [enabled, startAt, autoPlay, ready, videoRef, programmaticSeekRef]);

  // Fin du plan : le montage passe au suivant. `ready` est indispensable en dépendance :
  // tant que le média n'est pas chargé, le viewer n'affiche qu'un squelette et l'élément
  // vidéo n'existe pas — l'écouteur posé au montage du composant ne s'attacherait à rien,
  // et le film s'arrêterait au premier plan.
  const onEnded = montage?.onEnded;
  useEffect(() => {
    const video = videoRef.current;
    if (!onEnded || !video) return;
    video.addEventListener('ended', onEnded);
    return () => video.removeEventListener('ended', onEnded);
  }, [onEnded, ready, videoRef]);
}
