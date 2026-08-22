// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { isEditable } from '../../lib/shortcuts';
import { t } from '../../i18n';
import { cancelPendingPlay, safePlay, stepVideoFrame } from './reviewTypes';
import { useCompareOffset } from './compareOffset';

/**
 * Raccourcis clavier de la review vidéo (10.C2) :
 * - Espace : lecture/pause · K : pause
 * - ←/→ : ±1 frame · Maj+←/→ : ±10 frames
 * - J / L : lecture arrière / avant (appuis répétés : ×2, ×4, ×8)
 * - I / O : points d'entrée/sortie de boucle · Maj+I/O : efface la boucle
 * - M : pause + composer de commentaire (marqueur à la frame courante)
 * - [ / ] : décalage de la comparaison A/B, ∓1 frame (Maj : ∓10) · Maj+\ : recale à zéro
 * Inactifs dans les champs de saisie et quand un dialog est ouvert.
 * La lecture arrière n'existe pas en HTML5 : elle est simulée par un pas de
 * requestAnimationFrame qui décrémente currentTime à vitesse réelle.
 *
 * Les crochets sont repérés par leur **position** (`e.code`) et non par le caractère
 * produit : sur un clavier AZERTY, ce caractère demande AltGr, que ce gestionnaire écarte.
 */
export function useReviewShortcuts({
  videoRef,
  fps,
  onMarker,
  onLoopIn,
  onLoopOut,
  onClearLoop,
  onShuttle,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  fps: number;
  onMarker: () => void;
  /** I : marque le point d'entrée de boucle à la frame courante (14.B). */
  onLoopIn?: () => void;
  /** O : marque le point de sortie de boucle à la frame courante (14.B). */
  onLoopOut?: () => void;
  /** Maj+I ou Maj+O : efface la boucle. */
  onClearLoop?: () => void;
  /** Vitesse de la lecture arrière J (négative), null à l'arrêt — affichage 34.C. */
  onShuttle?: (speed: number | null) => void;
}) {
  const shuttle = useRef<{ speed: number; raf: number; last: number } | null>(null);

  useEffect(() => {
    const stopShuttle = () => {
      if (shuttle.current) {
        cancelAnimationFrame(shuttle.current.raf);
        shuttle.current = null;
        onShuttle?.(null);
      }
    };

    const shuttleBack = () => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      if (shuttle.current) {
        shuttle.current.speed = Math.min(shuttle.current.speed * 2, 8);
        onShuttle?.(-shuttle.current.speed);
        return;
      }
      const tick = (now: number) => {
        const s = shuttle.current,
          vv = videoRef.current;
        if (!s || !vv) return;
        const dt = (now - s.last) / 1000;
        s.last = now;
        vv.currentTime = Math.max(0, vv.currentTime - dt * s.speed);
        if (vv.currentTime <= 0) {
          stopShuttle();
          return;
        }
        s.raf = requestAnimationFrame(tick);
      };
      shuttle.current = { speed: 1, last: performance.now(), raf: requestAnimationFrame(tick) };
      onShuttle?.(-1);
    };

    const playForward = () => {
      const v = videoRef.current;
      if (!v) return;
      if (shuttle.current || v.paused) {
        stopShuttle();
        safePlay(v); // attend que l'image soit décodable (pas de son sur image figée)
        return;
      }
      v.playbackRate = Math.min(v.playbackRate * 2, 8);
    };

    /** Annonce le décalage courant : un toast qui se remplace, pas une pile de toasts. */
    const announceOffset = (frames: number) => {
      const message =
        frames === 0
          ? t('video.compareOffsetNone')
          : frames > 0
            ? t('video.compareOffsetAhead', { count: frames })
            : t('video.compareOffsetBehind', { count: -frames });
      toast.info(message, { id: 'compare-offset' });
    };

    const nudgeOffset = (delta: number) => {
      useCompareOffset.getState().nudge(delta, fps);
      announceOffset(useCompareOffset.getState().frames);
    };

    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const v = videoRef.current;
      if (!v) return;
      // Décalage de la comparaison A/B : repéré à la position de la touche (cf. en-tête).
      if (e.code === 'BracketLeft' || e.key === '[' || e.key === '{') {
        e.preventDefault();
        nudgeOffset(e.shiftKey ? -10 : -1);
        return;
      }
      if (e.code === 'BracketRight' || e.key === ']' || e.key === '}') {
        e.preventDefault();
        nudgeOffset(e.shiftKey ? 10 : 1);
        return;
      }
      if (e.code === 'Backslash' && e.shiftKey) {
        e.preventDefault();
        useCompareOffset.getState().reset();
        announceOffset(0);
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'i':
          e.preventDefault();
          if (e.shiftKey) onClearLoop?.();
          else onLoopIn?.();
          break;
        case 'o':
          e.preventDefault();
          if (e.shiftKey) onClearLoop?.();
          else onLoopOut?.();
          break;
        case ' ':
          e.preventDefault();
          stopShuttle();
          if (v.paused) safePlay(v);
          else {
            cancelPendingPlay(v);
            v.pause();
          }
          break;
        case 'arrowleft':
          e.preventDefault();
          stopShuttle();
          stepVideoFrame(v, fps, e.shiftKey ? -10 : -1);
          break;
        case 'arrowright':
          e.preventDefault();
          stopShuttle();
          stepVideoFrame(v, fps, e.shiftKey ? 10 : 1);
          break;
        case 'j':
          e.preventDefault();
          shuttleBack();
          break;
        case 'k':
          e.preventDefault();
          stopShuttle();
          cancelPendingPlay(v);
          v.pause();
          v.playbackRate = 1;
          break;
        case 'l':
          e.preventDefault();
          playForward();
          break;
        case 'm':
          // ARBITRAGE — sur une vidéo, M appartient au transport, pas au rail d'outils.
          //
          // Deux gestes se disputaient la lettre : « pause + commentaire à la frame
          // courante » ici, et l'outil `shape-move` du mode Annoter (chrome/tools.ts). Une
          // frappe faisait les deux : le composer s'ouvrait *et* tout l'écran basculait en
          // mode Annoter, canvas de tracé par-dessus l'image, clic-pour-lire perdu.
          //
          // M reste au transport, parce que c'est ce que la liste des raccourcis promet à
          // l'utilisateur (components/ShortcutsHelp) et que noter un retour à la frame
          // exacte est le geste central d'une review. `stopPropagation` suffit à trancher :
          // ce gestionnaire est posé sur `document`, celui du rail sur `window`, et la phase
          // de remontée traverse le premier avant le second. L'outil de déplacement de forme
          // reste accessible au rail, d'un clic.
          e.preventDefault();
          e.stopPropagation();
          stopShuttle();
          cancelPendingPlay(v);
          v.pause();
          onMarker();
          break;
      }
    };

    // Lecture lancée via les contrôles natifs → stoppe la lecture arrière en cours.
    const v = videoRef.current;
    const onPlay = () => stopShuttle();
    v?.addEventListener('play', onPlay);
    document.addEventListener('keydown', down);
    return () => {
      document.removeEventListener('keydown', down);
      v?.removeEventListener('play', onPlay);
      stopShuttle();
      // Le décalage de comparaison appartient à la séance en cours : il ne suit pas
      // l'utilisateur sur le média suivant, où le conform n'a aucune raison d'être le même.
      useCompareOffset.getState().reset();
    };
  }, [videoRef, fps, onMarker, onLoopIn, onLoopOut, onClearLoop, onShuttle]);
}
