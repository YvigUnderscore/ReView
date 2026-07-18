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
 * glissement de la timeline (seek réactif), puis restaure la qualité choisie **immédiatement**
 * au lâcher (y compris en Auto, via `nextAutoLevel` calé sur le niveau d'avant-scrub).
 */
export function useHlsPlayer(videoRef: RefObject<HTMLVideoElement | null>, hlsUrl: string | null) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [mode, setMode] = useState(-1); // -1 = auto
  const [switching, setSwitching] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  // Mode qualité choisi par l'utilisateur, restauré en fin de scrub.
  const userModeRef = useRef(-1);
  const scrubbing = useRef(false);
  // Niveau effectif avant le scrub : cible du retour immédiat en mode Auto.
  const preScrubLevel = useRef(-1);
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
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, () => {
      window.clearTimeout(switchTimer.current);
      setSwitching(false);
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
    const willSwitch = idx === -1 ? !hls.autoLevelEnabled : hls.currentLevel !== idx;
    if (willSwitch) markSwitching();
    hls.currentLevel = idx; // -1 = auto
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
    preScrubLevel.current = hls.currentLevel;
    const low = lowestLevel();
    if (low >= 0 && hls.currentLevel !== low) hls.currentLevel = low;
  }, [lowestLevel]);

  /** Fin de scrub : retour **immédiat** à la qualité choisie (ou au niveau Auto d'avant). */
  const endScrub = useCallback(() => {
    const hls = hlsRef.current;
    if (!scrubbing.current) return;
    scrubbing.current = false;
    if (!hls) return;
    const target = userModeRef.current;
    if (target >= 0) {
      if (hls.currentLevel !== target) markSwitching();
      hls.currentLevel = target; // flush immédiat du buffer basse qualité
    } else {
      // Auto : réactive l'ABR, et force le prochain chargement au niveau d'avant-scrub
      // (sinon hls.js remonterait progressivement depuis la rendition basse).
      if (preScrubLevel.current >= 0 && hls.currentLevel !== preScrubLevel.current) {
        markSwitching();
        hls.nextAutoLevel = preScrubLevel.current;
      }
      hls.currentLevel = -1;
    }
  }, [markSwitching]);

  return { active, levels, mode, setLevel, switching, beginScrub, endScrub };
}
