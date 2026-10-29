// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { isEditable } from '../../../lib/shortcuts';
import { snapToFrame } from './timeline/viewTransform';
import type { CameraAnimState } from './useCameraAnim';
import { useT } from '../../../i18n';

/**
 * Camera transport shortcuts (long promised by the transport labels): **Space** play/pause,
 * **K** set a key, **←/→** previous/next key, **Home/End** playback bounds. When the layout
 * workshop is active (`undoActive`), **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** drive the animation's
 * history — in the capture phase, to run before the splat editor's undo, which listens to the
 * same keys.
 *
 * It also signals the **takeover**: when playback stops because the user moved the camera
 * (`autoPaused`), a toast explains how to resume — a silent stop looked like a bug.
 */
export function useCameraShortcuts(opts: {
  anim: CameraAnimState;
  /** Camera track visible (spatial media, not the clips track). */
  active: boolean;
  /** Right to write keys (K). */
  editable: boolean;
  /** Ctrl+Z routed to the animation's history (Layout mode). */
  undoActive: boolean;
  /** Pipeline frame rate (Home/End snap). */
  fps: number;
}): void {
  const { anim, active, editable, undoActive, fps } = opts;
  const t = useT();
  // Ref synced in an effect (never during render): only read in the keyboard handlers.
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

  // Animation undo/redo in the capture phase: the layout workshop takes over from the editor.
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

  // Takeover: the auto-pause becomes visible (it used to look like broken playback).
  const wasAutoPaused = useRef(false);
  useEffect(() => {
    if (anim.autoPaused && !wasAutoPaused.current) toast.info(t('camera.autoPaused'));
    wasAutoPaused.current = anim.autoPaused;
  }, [anim.autoPaused, t]);
}
