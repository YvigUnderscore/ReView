// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type RefObject } from 'react';
import { toast } from 'sonner';
import { isEditable } from '../../lib/shortcuts';
import { t } from '../../i18n';
import { cancelPendingPlay, safePlay, stepVideoFrame } from './reviewTypes';
import { useCompareOffset } from './compareOffset';

/**
 * Keyboard shortcuts of the video review (10.C2):
 * - Space: play/pause · K: pause
 * - ←/→: ±1 frame · Shift+←/→: ±10 frames
 * - J / L: reverse / forward playback (repeated presses: ×2, ×4, ×8)
 * - I / O: loop in/out points · Shift+I/O: clears the loop
 * - M: pause + comment composer (marker at the current frame)
 * - [ / ]: offset of the A/B comparison, ∓1 frame (Shift: ∓10) · Shift+\: resets to zero
 * Inactive in input fields and when a dialog is open.
 * Reverse playback does not exist in HTML5: it is simulated by a requestAnimationFrame step that
 * decrements currentTime at real speed.
 *
 * The brackets are identified by their **position** (`e.code`) and not by the character produced: on
 * an AZERTY keyboard, that character requires AltGr, which this handler ignores.
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
  /** I: marks the loop entry point at the current frame (14.B). */
  onLoopIn?: () => void;
  /** O: marks the loop exit point at the current frame (14.B). */
  onLoopOut?: () => void;
  /** Shift+I or Shift+O: clears the loop. */
  onClearLoop?: () => void;
  /** Speed of reverse playback J (negative), null when stopped — display 34.C. */
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
        safePlay(v); // waits until the image is decodable (no sound over a frozen image)
        return;
      }
      v.playbackRate = Math.min(v.playbackRate * 2, 8);
    };

    /** Announces the current offset: a toast that replaces itself, not a stack of toasts. */
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
      // Comparison offset: identified by the key's position (see header).
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
          // ARBITRATION — on a video, M belongs to the transport, not to the tool rail.
          //
          // Two gestures fought over the letter: "pause + comment at the current frame" here, and the
          // `shape-move` tool of Annotate mode (chrome/tools.ts). One keystroke did both: the composer
          // opened *and* the whole screen switched to Annotate mode, drawing canvas over the image,
          // click-to-play lost.
          //
          // M stays with the transport, because noting a return to the exact frame is the central
          // gesture of a review. The sharing was only half-settled: `stopPropagation` (this handler
          // lives on `document`, the rail on `window`, and bubbling reaches the first before the second)
          // did prevent the double effect, but the rail's button kept announcing `M` on a video, where
          // the letter never armed it. The tool therefore changed key in Phase 50 (`S`); the cut remains,
          // as a safeguard.
          e.preventDefault();
          e.stopPropagation();
          stopShuttle();
          cancelPendingPlay(v);
          v.pause();
          onMarker();
          break;
      }
    };

    // Playback started via the native controls → stops the ongoing reverse playback.
    const v = videoRef.current;
    const onPlay = () => stopShuttle();
    v?.addEventListener('play', onPlay);
    document.addEventListener('keydown', down);
    return () => {
      document.removeEventListener('keydown', down);
      v?.removeEventListener('play', onPlay);
      stopShuttle();
      // The comparison offset belongs to the current session: it does not follow the user to the next
      // media, where the conform has no reason to be the same.
      useCompareOffset.getState().reset();
    };
  }, [videoRef, fps, onMarker, onLoopIn, onLoopOut, onClearLoop, onShuttle]);
}
