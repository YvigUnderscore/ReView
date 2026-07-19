import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Hooks du pane vidéo (extraits de VideoPane, budget 300) : buffering du lecteur et
 * vitesse de lecture affichée (34.C).
 */

/**
 * Rebouclage I/O (retours 34) : on ne repart au point I **qu'en lecture** — en navigation
 * manuelle (pause, scrub, flèches) on doit pouvoir dépasser librement le point O — et
 * seulement si la boucle est activée (le toggle ne supprime pas les points I/O).
 */
export function shouldLoopBack(
  loopIn: number | null,
  loopOut: number | null,
  enabled: boolean,
  paused: boolean,
  currentTime: number,
): boolean {
  return (
    enabled && !paused && loopIn != null && loopOut != null && loopOut > loopIn && currentTime >= loopOut
  );
}

/**
 * Points de boucle I/O du lecteur : marquage à la frame courante (raccourcis I/O),
 * effacement (Maj+I/O ou ×), et activation débrayable — désactiver la boucle **conserve**
 * les points (retours 34). Poser un point réactive la boucle.
 */
export function useLoopPoints(videoRef: RefObject<HTMLVideoElement | null>) {
  const [loopIn, setLoopIn] = useState<number | null>(null);
  const [loopOut, setLoopOut] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const markIn = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setLoopIn(v.currentTime);
    setEnabled(true);
  }, [videoRef]);
  const markOut = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setLoopOut(v.currentTime);
    setEnabled(true);
  }, [videoRef]);
  const clear = useCallback(() => {
    setLoopIn(null);
    setLoopOut(null);
  }, []);
  const toggleEnabled = useCallback(() => setEnabled((e) => !e), []);
  return { loopIn, loopOut, enabled, markIn, markOut, clear, toggleEnabled };
}

/**
 * Buffering du lecteur : vrai quand la vidéo attend des données (seek/switch qualité),
 * avec un léger délai anti-scintillement — pilote le spinner discret sur le viewer.
 */
export function useVideoBuffering(videoRef: RefObject<HTMLVideoElement | null>, src: string) {
  const [buffering, setBuffering] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let timer: number | undefined;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setBuffering(true), 180);
    };
    const stop = () => {
      window.clearTimeout(timer);
      setBuffering(false);
    };
    const startEvents = ['waiting', 'seeking', 'stalled'] as const;
    const stopEvents = ['playing', 'canplay', 'seeked'] as const;
    startEvents.forEach((e) => v.addEventListener(e, start));
    stopEvents.forEach((e) => v.addEventListener(e, stop));
    return () => {
      window.clearTimeout(timer);
      startEvents.forEach((e) => v.removeEventListener(e, start));
      stopEvents.forEach((e) => v.removeEventListener(e, stop));
    };
  }, [videoRef, src]);
  return buffering;
}

/**
 * Vitesse de lecture affichée (34.C) : la lecture arrière J (shuttle rAF, vitesse
 * négative) est prioritaire sur `playbackRate` (L cumulés). `visible` dès qu'on n'est
 * pas en lecture normale ×1.
 */
export function usePlaybackSpeed(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string,
  playing: boolean,
) {
  const [shuttleSpeed, setShuttleSpeed] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onRate = () => setRate(v.playbackRate);
    v.addEventListener('ratechange', onRate);
    return () => v.removeEventListener('ratechange', onRate);
  }, [videoRef, src]);
  const speed = shuttleSpeed ?? rate;
  return {
    speed,
    visible: (shuttleSpeed != null || (playing && rate !== 1)) && speed !== 1,
    onShuttle: setShuttleSpeed,
  };
}
