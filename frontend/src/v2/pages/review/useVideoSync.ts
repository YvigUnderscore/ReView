// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, type RefObject } from 'react';
import { useCompareOffset } from './compareOffset';

/** Au-delà de cet écart, la vidéo esclave a décroché du maître et on la recale. */
const DRIFT_TOLERANCE_SEC = 0.15;

/**
 * Synchronise une vidéo esclave sur un lecteur maître (14.C — extrait de VideoComparePane) :
 * play/pause/seek/vitesse + correction de dérive pendant la lecture. Réutilisé par les modes
 * côte-à-côte et wipe de la comparaison A/B.
 *
 * La consigne n'est plus « même temps » mais « même temps, décalé de tant » : le décalage de
 * comparaison (cf. `compareOffset.ts`) s'ajoute à la position du maître. À zéro — le cas
 * ordinaire — le comportement est exactement celui d'avant.
 */
export function useVideoSync(
  masterRef: RefObject<HTMLVideoElement | null>,
  slaveRef: RefObject<HTMLVideoElement | null>,
  ready: boolean,
) {
  // Décalage de conform réglable (retime, poignées, point d'entrée déplacé entre deux versions).
  const offsetSec = useCompareOffset((s) => s.seconds);

  useEffect(() => {
    const m = masterRef.current;
    const s = slaveRef.current;
    if (!m || !s || !ready) return;
    /** Position visée par l'esclave, bornée à la durée qu'il connaît. */
    const target = () => {
      const wanted = m.currentTime + offsetSec;
      const max = Number.isFinite(s.duration) && s.duration > 0 ? s.duration : Number.POSITIVE_INFINITY;
      return Math.max(0, Math.min(wanted, max));
    };
    const syncTime = () => {
      s.currentTime = target();
    };
    const onPlay = () => {
      syncTime();
      void s.play().catch(() => undefined);
    };
    const onPause = () => {
      s.pause();
      syncTime();
    };
    const onRate = () => {
      s.playbackRate = m.playbackRate;
    };
    // Correction de dérive : les deux lecteurs décodent indépendamment.
    const onTime = () => {
      if (!m.paused && Math.abs(s.currentTime - target()) > DRIFT_TOLERANCE_SEC) syncTime();
    };
    m.addEventListener('play', onPlay);
    m.addEventListener('pause', onPause);
    m.addEventListener('seeking', syncTime);
    m.addEventListener('ratechange', onRate);
    m.addEventListener('timeupdate', onTime);
    s.playbackRate = m.playbackRate;
    syncTime();
    if (!m.paused) void s.play().catch(() => undefined);
    return () => {
      m.removeEventListener('play', onPlay);
      m.removeEventListener('pause', onPause);
      m.removeEventListener('seeking', syncTime);
      m.removeEventListener('ratechange', onRate);
      m.removeEventListener('timeupdate', onTime);
    };
  }, [masterRef, slaveRef, ready, offsetSec]);
}
