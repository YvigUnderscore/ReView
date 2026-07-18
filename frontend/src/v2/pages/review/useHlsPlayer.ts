import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Hls from 'hls.js';
import { getToken } from '../../../lib/apiClient';

export interface HlsLevel {
  height: number;
  bitrate: number;
}

/**
 * Lecture HLS (Phase 23) via hls.js (MSE). Le manifeste et les segments sont servis par le
 * proxy authentifié `/api/media/:id/hls/*` → le token JWT est injecté par `xhrSetup`.
 * Sans support MSE (`active=false`), l'appelant retombe sur le proxy MP4.
 *
 * Système de qualité volontairement minimal (refonte 2026-07-18) :
 * - **pas d'ABR** : la lecture démarre verrouillée sur la rendition la plus haute, la
 *   qualité affichée est toujours la qualité servie ;
 * - changement **en lecture** → `nextLevel` : bascule au prochain fragment, sans flush à
 *   la position courante — aucun trou de buffer possible, donc jamais de son sur image
 *   figée ;
 * - changement **en pause** → `currentLevel` : flush pour rafraîchir la frame affichée,
 *   suivi d'un micro-seek de resynchro si le décodeur n'a plus d'image sous la tête ;
 * - **aucune bascule automatique** de qualité (le va-et-vient bas↔haut du scrub était la
 *   source des trous de buffer) ;
 * - `switching` = feedback UI du changement en cours, retombé par LEVEL_SWITCHED ou par
 *   un garde-fou (le spinner ne peut pas rester coincé).
 */
export function useHlsPlayer(videoRef: RefObject<HTMLVideoElement | null>, hlsUrl: string | null) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [level, setLevelState] = useState(0);
  const [switching, setSwitching] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const switchTimer = useRef<number | undefined>(undefined);
  const active = !!hlsUrl && Hls.isSupported();

  const markSwitching = useCallback(() => {
    setSwitching(true);
    window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => setSwitching(false), 4000);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl || !Hls.isSupported()) return;
    const hls = new Hls({
      xhrSetup: (xhr) => {
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      },
    });
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.loadSource(hlsUrl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      setLevels(hls.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
      // Verrouille la meilleure rendition avant le premier fragment (pas d'ABR).
      let hi = 0;
      hls.levels.forEach((l, i) => {
        if (l.height > hls.levels[hi]!.height) hi = i;
      });
      setLevelState(hi);
      hls.currentLevel = hi;
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, () => {
      window.clearTimeout(switchTimer.current);
      setSwitching(false);
      // Après un flush en pause, le décodeur peut ne plus avoir d'image sous la tête de
      // lecture : micro-seek sur place pour recharger le segment et rafraîchir la frame.
      if (video.paused && video.readyState < 3) video.currentTime = Math.max(0, video.currentTime - 0.001);
    });
    return () => {
      hls.destroy();
      hlsRef.current = null;
      window.clearTimeout(switchTimer.current);
      setLevels([]);
      setSwitching(false);
    };
  }, [videoRef, hlsUrl]);

  /** Change la qualité de lecture (index de rendition). */
  const setLevel = (idx: number) => {
    setLevelState(idx);
    const hls = hlsRef.current;
    if (!hls || hls.currentLevel === idx) return;
    markSwitching();
    const video = videoRef.current;
    if (video && !video.paused) hls.nextLevel = idx;
    else hls.currentLevel = idx;
  };

  return { active, levels, level, setLevel, switching };
}
