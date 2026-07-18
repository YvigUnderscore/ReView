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
 *
 * **Pas de mode Auto** : l'ABR retombait en basse qualité sans que le sélecteur le reflète.
 * La lecture démarre verrouillée sur la **rendition la plus haute** dès le manifeste ; la
 * qualité affichée est toujours la qualité servie. `switching` = changement de qualité en
 * cours (feedback UI, avec garde-fou anti-blocage). Le **mode scrub** (`beginScrub`/
 * `endScrub`) force temporairement la rendition la plus basse pendant le glissement de la
 * timeline (seek réactif), puis restaure la qualité choisie **immédiatement** au lâcher.
 * Sans support MSE (`active=false`), l'appelant retombe sur le proxy MP4.
 */
export function useHlsPlayer(videoRef: RefObject<HTMLVideoElement | null>, hlsUrl: string | null) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [mode, setMode] = useState(0); // index du niveau choisi (défaut : max, calé au manifeste)
  const [switching, setSwitching] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  // Niveau choisi par l'utilisateur, restauré en fin de scrub.
  const userModeRef = useRef(0);
  const scrubbing = useRef(false);
  const switchTimer = useRef<number | undefined>(undefined);
  const active = !!hlsUrl && Hls.isSupported();

  // Garde-fou : si LEVEL_SWITCHED n'arrive jamais (niveau déjà servi, segment en erreur…),
  // on ne reste pas coincé sur « Changement de qualité… » — le spinner tombe tout seul.
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
      userModeRef.current = hi;
      setMode(hi);
      hls.currentLevel = hi;
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, () => {
      window.clearTimeout(switchTimer.current);
      setSwitching(false);
      // En pause, le flush du switch peut laisser un trou vidéo à la position courante
      // (image figée au prochain play alors que l'audio est chargé) : micro-seek sur
      // place pour que hls.js recharge le segment et resynchronise le décodeur.
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

  const setLevel = (idx: number) => {
    setMode(idx);
    userModeRef.current = idx;
    const hls = hlsRef.current;
    if (!hls || scrubbing.current) return; // appliqué en fin de scrub
    // Spinner seulement si un vrai switch va se produire (sinon LEVEL_SWITCHED ne vient pas).
    if (hls.currentLevel !== idx) markSwitching();
    hls.currentLevel = idx;
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

  /** Fin de scrub : retour **immédiat** à la qualité choisie (flush du buffer basse déf). */
  const endScrub = useCallback(() => {
    const hls = hlsRef.current;
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (!hls) return;
    if (hls.currentLevel !== userModeRef.current) markSwitching();
    hls.currentLevel = userModeRef.current;
  }, [markSwitching]);

  return { active, levels, mode, setLevel, switching, beginScrub, endScrub };
}
