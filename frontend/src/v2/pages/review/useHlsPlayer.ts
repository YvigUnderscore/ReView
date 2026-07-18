import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Hls from 'hls.js';
import { getToken } from '../../../lib/apiClient';

export interface HlsLevel {
  height: number;
  bitrate: number;
}

/**
 * Lecture HLS adaptative (Phase 23) via hls.js (MSE). Le manifeste et les segments sont servis
 * par le proxy authentifié `/api/media/:id/hls/*` → le token JWT est injecté par `xhrSetup`.
 * `mode` = niveau courant : -1 = **Auto** (défaut, hls.js choisit la max qualité soutenable).
 * Sans support MSE (`active=false`), l'appelant retombe sur le proxy MP4.
 *
 * En plus : `switching` (changement de qualité en cours — feedback UI), et le **mode scrub**
 * (`beginScrub`/`endScrub`) qui force temporairement la rendition la plus basse pendant le
 * glissement de la timeline (seek réactif), puis restaure la qualité choisie.
 */
export function useHlsPlayer(videoRef: RefObject<HTMLVideoElement | null>, hlsUrl: string | null) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [mode, setMode] = useState(-1); // -1 = auto
  const [switching, setSwitching] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  // Mode qualité choisi par l'utilisateur, restauré en fin de scrub.
  const userModeRef = useRef(-1);
  const scrubbing = useRef(false);
  const active = !!hlsUrl && Hls.isSupported();

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
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, () => setSwitching(false));
    return () => {
      hls.destroy();
      hlsRef.current = null;
      setLevels([]);
      setSwitching(false);
    };
  }, [videoRef, hlsUrl]);

  const setLevel = (idx: number) => {
    setMode(idx);
    userModeRef.current = idx;
    const hls = hlsRef.current;
    if (hls && !scrubbing.current) {
      setSwitching(true);
      hls.currentLevel = idx; // -1 = auto
    }
  };

  // Index de la rendition la plus basse (les niveaux hls.js sont triés par bande passante).
  const lowestLevel = useCallback(() => {
    const hls = hlsRef.current;
    if (!hls || hls.levels.length === 0) return -1;
    let best = 0;
    hls.levels.forEach((l, i) => {
      if (l.height < hls.levels[best]!.height) best = i;
    });
    return best;
  }, []);

  /** Début de scrub timeline : bascule immédiate sur la rendition la plus basse. */
  const beginScrub = useCallback(() => {
    const hls = hlsRef.current;
    if (!hls || scrubbing.current) return;
    scrubbing.current = true;
    const low = lowestLevel();
    if (low >= 0 && hls.currentLevel !== low) hls.currentLevel = low;
  }, [lowestLevel]);

  /** Fin de scrub : restaure la qualité choisie (ou Auto). */
  const endScrub = useCallback(() => {
    const hls = hlsRef.current;
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (hls) {
      setSwitching(true);
      hls.currentLevel = userModeRef.current;
    }
  }, []);

  return { active, levels, mode, setLevel, switching, beginScrub, endScrub };
}
