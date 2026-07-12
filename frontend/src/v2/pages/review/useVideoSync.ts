import { useEffect, type RefObject } from 'react';

/**
 * Synchronise une vidéo esclave sur un lecteur maître (14.C — extrait de VideoComparePane) :
 * play/pause/seek/vitesse + correction de dérive pendant la lecture. Réutilisé par les modes
 * côte-à-côte et wipe de la comparaison A/B.
 */
export function useVideoSync(
  masterRef: RefObject<HTMLVideoElement | null>,
  slaveRef: RefObject<HTMLVideoElement | null>,
  ready: boolean,
) {
  useEffect(() => {
    const m = masterRef.current;
    const s = slaveRef.current;
    if (!m || !s || !ready) return;
    const syncTime = () => {
      s.currentTime = m.currentTime;
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
      if (!m.paused && Math.abs(s.currentTime - m.currentTime) > 0.15) syncTime();
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
  }, [masterRef, slaveRef, ready]);
}
