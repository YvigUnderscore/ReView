// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isAutoKeySuspended } from './autoKeyGate';

/**
 * Auto-key (Phase 27) : activé, tout geste caméra sur le canvas (drag orbite/pan au-delà de
 * 3 px, molette débouncée) pose une clé de la vue courante au temps de lecture — façon DCC.
 *
 * Hors caméra (mode layout), le portier `autoKeyGate` le suspend : les gestes du canvas y bougent
 * la caméra **libre**, pas celle du plan, et le `pointerup` d'un drag de gizmo écrasait la clé que
 * le gizmo venait d'écrire. Le portier est consulté au moment de poser la clé, jamais à
 * l'abonnement : le mode change sans démonter l'écoute.
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
