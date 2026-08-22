// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type RefObject } from 'react';
import { frameAtTime } from './frameRate';

/**
 * Horloge de frame du lecteur.
 *
 * Le compteur ne suivait que `timeupdate`, événement spécifié à environ quatre émissions par
 * seconde : en lecture à 24 fps, le numéro affiché sautait de six en six, le curseur de la
 * timeline avançait par à-coups et les annotations de plage s'allumaient jusqu'à 250 ms trop
 * tard. Le pas-à-pas, lui, était juste — c'est bien la lecture continue qui retardait.
 *
 * `requestVideoFrameCallback` répond exactement à cela : le navigateur rappelle à **chaque
 * image présentée** et fournit `mediaTime`, l'horodatage de cette image précise — pas la
 * position approximative du lecteur. Là où il manque (Firefox), un pas de
 * `requestAnimationFrame` tient lieu de repli : il ne connaît que `currentTime`, mais il
 * rafraîchit à la cadence de l'écran plutôt que quatre fois par seconde.
 *
 * `timeupdate`, `seeked` et `loadedmetadata` restent branchés comme filet : ils couvrent la
 * pause, le scrub et le chargement, où aucune image nouvelle n'est présentée.
 */

/**
 * Les types du DOM annoncent `requestVideoFrameCallback` comme acquis ; Firefox ne
 * l'implémente pas. On le rend donc facultatif dans le type, faute de quoi le repli passe
 * pour du code inatteignable.
 */
type FrameCallbackApi = Partial<
  Pick<HTMLVideoElement, 'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>
>;
type VideoWithFrameCallback = Omit<
  HTMLVideoElement,
  'requestVideoFrameCallback' | 'cancelVideoFrameCallback'
> &
  FrameCallbackApi;

/** Seul champ des métadonnées d'image qui nous intéresse : l'horodatage de l'image montrée. */
interface VideoFrameMetadataLike {
  mediaTime: number;
}

/** Le lecteur sait-il annoncer ses images ? (faux sous Firefox et en test happy-dom) */
export function hasFrameCallback(video: HTMLVideoElement | null): boolean {
  return typeof (video as VideoWithFrameCallback | null)?.requestVideoFrameCallback === 'function';
}

/**
 * Numéro de frame courant, rafraîchi image par image. `fps` est la cadence **corrigée**
 * (cf. `frameRate.ts`) : le compteur ne peut pas être plus juste que la cadence dont il dérive.
 */
export function useVideoFrameClock(videoRef: RefObject<HTMLVideoElement | null>, fps: number): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const video = videoRef.current as VideoWithFrameCallback | null;
    if (!video) return;

    let stopped = false;
    // Un `setState` par image présentée ne coûte rien tant que la valeur ne change pas :
    // React abandonne le rendu quand l'état est identique. On ne filtre donc que le bruit.
    const publish = (time: number) => setFrame(frameAtTime(time, fps));
    const fromElement = () => publish(video.currentTime);

    let rafHandle = 0;
    let vfcHandle = 0;
    let detachFallback: (() => void) | undefined;
    const onPresented = (_now: number, metadata: VideoFrameMetadataLike) => {
      if (stopped) return;
      publish(metadata.mediaTime);
      vfcHandle = video.requestVideoFrameCallback!(onPresented);
    };
    const tick = () => {
      if (stopped) return;
      fromElement();
      rafHandle = requestAnimationFrame(tick);
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      // La boucle tourne en continu : à l'arrêt, le navigateur ne rappelle simplement pas.
      vfcHandle = video.requestVideoFrameCallback(onPresented);
    } else {
      // Repli : la boucle ne tourne que pendant la lecture, sinon elle réveillerait l'onglet
      // soixante fois par seconde pour recopier une valeur qui ne bouge pas.
      const start = () => {
        if (!rafHandle) rafHandle = requestAnimationFrame(tick);
      };
      const stop = () => {
        if (rafHandle) cancelAnimationFrame(rafHandle);
        rafHandle = 0;
        fromElement();
      };
      video.addEventListener('play', start);
      video.addEventListener('pause', stop);
      video.addEventListener('ended', stop);
      if (!video.paused) start();
      detachFallback = () => {
        video.removeEventListener('play', start);
        video.removeEventListener('pause', stop);
        video.removeEventListener('ended', stop);
      };
    }

    video.addEventListener('timeupdate', fromElement);
    video.addEventListener('seeked', fromElement);
    video.addEventListener('loadedmetadata', fromElement);
    fromElement();

    return () => {
      stopped = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      if (vfcHandle && typeof video.cancelVideoFrameCallback === 'function')
        video.cancelVideoFrameCallback(vfcHandle);
      video.removeEventListener('timeupdate', fromElement);
      video.removeEventListener('seeked', fromElement);
      video.removeEventListener('loadedmetadata', fromElement);
      detachFallback?.();
    };
  }, [videoRef, fps]);

  return frame;
}
