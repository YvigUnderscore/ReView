// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { isEditable } from '../../../lib/shortcuts';
import { snapToFrame } from './timeline/viewTransform';
import type { CameraAnimState } from './useCameraAnim';
import { useT } from '../../../i18n';

/**
 * Raccourcis du transport caméra (promis de longue date par les libellés du transport) :
 * **Espace** lecture/pause, **K** poser une clé, **←/→** clé précédente/suivante, **Début/Fin**
 * bornes de la lecture. Quand l'atelier layout est actif (`undoActive`), **Ctrl+Z / Ctrl+Maj+Z /
 * Ctrl+Y** pilotent l'historique de l'animation — en phase capture, pour passer avant l'undo de
 * l'éditeur splat qui écoute les mêmes touches.
 *
 * Signale aussi la **reprise en main** : quand la lecture s'interrompt parce que l'utilisateur a
 * bougé la caméra (`autoPaused`), un toast explique comment reprendre — l'arrêt silencieux
 * passait pour un bug.
 */
export function useCameraShortcuts(opts: {
  anim: CameraAnimState;
  /** Piste caméra visible (média spatial, pas la piste clips). */
  active: boolean;
  /** Droit d'écrire des clés (K). */
  editable: boolean;
  /** Ctrl+Z routé vers l'historique de l'animation (mode Layout). */
  undoActive: boolean;
  /** Framerate du pipeline (snap Début/Fin). */
  fps: number;
}): void {
  const { anim, active, editable, undoActive, fps } = opts;
  const t = useT();
  // Réf synchronisée en effet (jamais pendant le rendu) : lue seulement dans les handlers clavier.
  const animRef = useRef(anim);
  useEffect(() => {
    animRef.current = anim;
  }, [anim]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const a = animRef.current;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        if (!a.keyTimes.length) return;
        e.preventDefault();
        if (a.playing) a.pause();
        else a.play();
        return;
      }
      if ((e.key === 'k' || e.key === 'K') && editable && !e.shiftKey) {
        e.preventDefault();
        a.insertKeyAtView(snapToFrame(a.timeMs, fps));
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const times = a.keyTimes;
        if (!times.length) return;
        const next =
          e.key === 'ArrowRight'
            ? times.find((kt) => kt > a.timeMs + 1)
            : [...times].reverse().find((kt) => kt < a.timeMs - 1);
        if (next !== undefined) {
          e.preventDefault();
          a.scrub(next);
        }
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        a.scrub(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        a.scrub(Math.max(a.playDuration, a.keyTimes[a.keyTimes.length - 1] ?? 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, editable, fps]);

  // Undo/redo de l'animation en phase capture : l'atelier layout prend la main sur l'éditeur.
  useEffect(() => {
    if (!active || !undoActive || !editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        animRef.current.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        animRef.current.redo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, undoActive, editable]);

  // Reprise en main : l'auto-pause devient visible (elle passait pour une lecture cassée).
  const wasAutoPaused = useRef(false);
  useEffect(() => {
    if (anim.autoPaused && !wasAutoPaused.current) toast.info(t('camera.autoPaused'));
    wasAutoPaused.current = anim.autoPaused;
  }, [anim.autoPaused, t]);
}
