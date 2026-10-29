// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isAutoKeySuspended } from './autoKeyGate';

/**
 * Auto-key (Phase 27): when enabled, any camera gesture on the canvas (orbit/pan drag beyond
 * 3 px, debounced wheel) sets a key from the current view at the playback time — DCC-style.
 *
 * Outside camera (layout mode), the `autoKeyGate` gate suspends it: canvas gestures there move
 * the **free** camera, not the plan's, and the `pointerup` of a gizmo drag overwrote the key the
 * gizmo had just written. The gate is consulted at the moment the key is set, never at
 * subscription time: the mode changes without unmounting the listener.
 */
export function useCameraAutoKey(
  autoKey: boolean,
  getDom: () => HTMLElement | null,
  insertKeyAtView: (t?: number) => void,
): void {
  useEffect(() => {
    if (!autoKey) return;
    const dom = getDom();
    if (!dom) return;
    let sx = 0;
    let sy = 0;
    let moved = false;
    let wheelTimer: number | undefined;
    const onDown = (e: PointerEvent) => {
      sx = e.clientX;
      sy = e.clientY;
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 3) moved = true;
    };
    const onUp = () => {
      if (moved && !isAutoKeySuspended()) insertKeyAtView();
    };
    const onWheel = () => {
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        if (!isAutoKeySuspended()) insertKeyAtView();
      }, 250);
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.clearTimeout(wheelTimer);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('wheel', onWheel);
    };
  }, [autoKey, getDom, insertKeyAtView]);
}
