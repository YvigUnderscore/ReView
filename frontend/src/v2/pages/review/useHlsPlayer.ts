import { useEffect, useRef, useState, type RefObject } from 'react';
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
 */
export function useHlsPlayer(videoRef: RefObject<HTMLVideoElement | null>, hlsUrl: string | null) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [mode, setMode] = useState(-1); // -1 = auto
  const hlsRef = useRef<Hls | null>(null);
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
    return () => {
      hls.destroy();
      hlsRef.current = null;
      setLevels([]);
    };
  }, [videoRef, hlsUrl]);

  const setLevel = (idx: number) => {
    setMode(idx);
    if (hlsRef.current) hlsRef.current.currentLevel = idx; // -1 = auto
  };

  return { active, levels, mode, setLevel };
}
