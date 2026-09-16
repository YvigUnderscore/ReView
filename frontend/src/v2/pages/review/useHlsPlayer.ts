// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getToken } from '../../../lib/apiClient';
import { getSocket } from '../../../lib/socket';
import { applyHlsAuth, isExpiredMediaUrlError, MAX_HLS_REFRESHES } from './hlsSource';
import { canUseHlsJs, loadHls, type HlsInstance } from './hlsRuntime';

export interface HlsLevel {
  height: number;
  bitrate: number;
}

/**
 * Lecture HLS (Phase 23) via hls.js (MSE). Les **manifestes** sont servis par l'API
 * authentifiée `/api/media/:id/hls/*` (le JWT est injecté par `xhrSetup`) ; depuis la
 * vague 2, les **segments** y sont référencés par URL MinIO présignées et ne passent plus
 * par le backend — d'où deux règles portées par `hlsSource` : le jeton de session ne suit
 * que les URL d'API, et une signature périmée se répare en rechargeant le manifeste.
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
 *
 * La bibliothèque elle-même est chargée **à la demande** (`hlsRuntime`) : elle ne pèse
 * plus sur les reviews d'image, de 3D ou de splat. La décision « HLS ou MP4 ? » reste
 * prise dès le premier rendu, sans elle, pour que l'écran ne change pas d'un iota.
 *
 * Échelle progressive (34.F) : `mediaId` fourni → à l'événement `hls:changed` (room de
 * review, nouvelles renditions transcodées), le master est rechargé en préservant
 * position/lecture ; qualité re-verrouillée sur la plus haute, sauf choix manuel.
 */
export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsUrl: string | null,
  mediaId?: number,
) {
  const [levels, setLevels] = useState<HlsLevel[]>([]);
  const [level, setLevelState] = useState(0);
  const [switching, setSwitching] = useState(false);
  const hlsRef = useRef<HlsInstance | null>(null);
  const switchTimer = useRef<number | undefined>(undefined);
  // Source dont le chunk du lecteur n'a pas pu être téléchargé (réseau coupé au mauvais
  // moment) : on y repasse au repli MP4 plutôt que de laisser un élément vidéo sans
  // source. Mémoriser l'URL plutôt qu'un booléen évite de devoir la remettre à zéro — un
  // média suivant n'est pas celui qui a échoué.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const active = canUseHlsJs(hlsUrl) && failedUrl !== hlsUrl;
  // Rechargement du master (34.F) : génération bumpée par l'événement socket ; l'état de
  // lecture (position/pause) et le choix manuel de qualité survivent au re-attach.
  const [gen, setGen] = useState(0);
  const restoreRef = useRef<{ t: number; paused: boolean } | null>(null);
  const manualHeightRef = useRef<number | null>(null);
  // Rechargements déclenchés par une URL de segment périmée — bornés (cf. MAX_HLS_REFRESHES).
  const refreshesRef = useRef(0);

  /** Recharge le manifeste en préservant position et état de lecture. */
  const reloadSource = useCallback(() => {
    const video = videoRef.current;
    restoreRef.current = { t: video?.currentTime ?? 0, paused: video?.paused ?? true };
    setGen((g) => g + 1);
  }, [videoRef]);

  const markSwitching = useCallback(() => {
    setSwitching(true);
    window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => setSwitching(false), 4000);
  }, []);

  useEffect(() => {
    if (!videoRef.current || !hlsUrl || !canUseHlsJs(hlsUrl)) return;
    // Chargement paresseux (F2) : la bibliothèque n'est demandée qu'ici, donc uniquement
    // pour une vraie vidéo. `disposed` couvre le démontage survenu pendant le
    // téléchargement — sans lui, un lecteur s'attacherait à un élément déjà retiré.
    let disposed = false;
    let player: HlsInstance | null = null;
    void loadHls().then(
      (HlsCtor) => {
        const video = videoRef.current;
        if (disposed || !video) return;
        const hls = new HlsCtor({
          xhrSetup: (xhr, url) => applyHlsAuth(xhr, url, getToken()),
        });
        player = hls;
        hlsRef.current = hls;
        hls.attachMedia(video);
        hls.loadSource(hlsUrl);
        hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
          setLevels(hls.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
          // Verrouille la meilleure rendition avant le premier fragment (pas d'ABR) — sauf
          // qualité choisie manuellement, conservée à travers un rechargement 34.F.
          let target = 0;
          hls.levels.forEach((l, i) => {
            if (l.height > hls.levels[target].height) target = i;
          });
          const manual = manualHeightRef.current;
          if (manual != null) {
            const idx = hls.levels.findIndex((l) => l.height === manual);
            if (idx >= 0) target = idx;
          }
          setLevelState(target);
          hls.currentLevel = target;
          // Reprise après rechargement du master (34.F) : position et lecture restaurées.
          const restore = restoreRef.current;
          restoreRef.current = null;
          if (restore && video) {
            video.currentTime = restore.t;
            if (!restore.paused) void video.play().catch(() => undefined);
          }
        });
        hls.on(HlsCtor.Events.LEVEL_SWITCHED, () => {
          window.clearTimeout(switchTimer.current);
          setSwitching(false);
          // Après un flush en pause, le décodeur peut ne plus avoir d'image sous la tête de
          // lecture : micro-seek sur place pour recharger le segment et rafraîchir la frame.
          if (video.paused && video.readyState < 3)
            video.currentTime = Math.max(0, video.currentTime - 0.001);
        });
        // Segment refusé par le stockage : sa signature a expiré (séance plus longue que la
        // durée de validité). Le manifeste, lui, reste accessible — on le redemande, ce qui
        // rend un jeu d'URL fraîches, position et lecture préservées.
        hls.on(HlsCtor.Events.ERROR, (_evt, data) => {
          if (!isExpiredMediaUrlError(data) || refreshesRef.current >= MAX_HLS_REFRESHES) return;
          refreshesRef.current += 1;
          reloadSource();
        });
      },
      () => {
        // Repli MP4 : `active` retombe à faux, l'élément vidéo reçoit `src` au rendu suivant.
        if (!disposed) setFailedUrl(hlsUrl);
      },
    );
    return () => {
      disposed = true;
      player?.destroy();
      hlsRef.current = null;
      window.clearTimeout(switchTimer.current);
      setLevels([]);
      setSwitching(false);
    };
  }, [videoRef, hlsUrl, gen, reloadSource]);

  // Nouveau média : le compteur de rechargements repart à zéro.
  useEffect(() => {
    refreshesRef.current = 0;
  }, [hlsUrl]);

  // Échelle progressive (34.F) : de nouvelles renditions sont prêtes → recharge le master.
  useEffect(() => {
    if (!active || !mediaId) return;
    const socket = getSocket();
    const onChanged = (e: { mediaId: number; renditions: number }) => {
      if (e.mediaId !== mediaId || e.renditions <= levels.length) return;
      reloadSource();
    };
    socket.on('hls:changed', onChanged);
    return () => {
      socket.off('hls:changed', onChanged);
    };
  }, [active, mediaId, levels.length, reloadSource]);

  /** Change la qualité de lecture (index de rendition). */
  const setLevel = (idx: number) => {
    setLevelState(idx);
    // Choix manuel : conservé si le master est rechargé (nouvelles renditions 34.F).
    manualHeightRef.current = levels[idx]?.height ?? null;
    const hls = hlsRef.current;
    if (!hls || hls.currentLevel === idx) return;
    markSwitching();
    const video = videoRef.current;
    if (video && !video.paused) hls.nextLevel = idx;
    else hls.currentLevel = idx;
  };

  return { active, levels, level, setLevel, switching };
}
