// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isContextTap } from './contextGesture';

/**
 * Right click on spatial viewers — a **short** press opens the context menu, a **held** one flies
 * (Phase 50, lot 8). One hook for the splat and the 3D model: the gesture is the same, only the
 * menu content differs.
 *
 * The verdict is taken on **button release**, never on arrival of the `contextmenu` event:
 * Chromium fires it on `mouseup` under Windows and on `mousedown` elsewhere. Measuring the gesture
 * at that moment made the distinction platform-dependent — on a system that notifies on press,
 * every flight would have opened the menu before it even started. The canvas's native event is
 * simply stopped in all cases.
 *
 * The menu itself is a Radix `ContextMenu` wrapping the pane. We cannot let it receive the canvas
 * event: `flyControls` has already consumed it (suppressing the native menu), and Radix ignores a
 * `defaultPrevented` event. So a **new** event is re-dispatched one level above the canvas — it
 * bubbles up to the menu without going through the flight listeners or this hook's.
 *
 * Args:
 *     getDom: Viewer canvas, resolved on demand (the scene is mounted asynchronously).
 *     ready: Whether the scene is ready.
 *     prepare: Prepares the menu and says whether it should open. The 3D viewer resolves the
 *         targeted prim there and refuses empty space; the splat always accepts — its entries
 *         concern the view, not an object.
 */
export function useSpatialContextMenu(
  getDom: () => HTMLElement | null,
  ready: boolean,
  prepare: (tap: { clientX: number; clientY: number; altKey: boolean }) => boolean,
): void {
  const down = useRef<{ x: number; y: number; at: number } | null>(null);
  // Callback replayed through a ref: the caller provides a new one on each render, and
  // reinstalling the listeners between press and release would lose the origin of the gesture.
  const prepareRef = useRef(prepare);
  useEffect(() => {
    prepareRef.current = prepare;
  }, [prepare]);

  useEffect(() => {
    if (!ready) return;
    const dom = getDom();
    if (!dom) return;

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) down.current = { x: e.clientX, y: e.clientY, at: e.timeStamp };
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (e.button !== 2 || !start) return;
      const tap = {
        dx: e.clientX - start.x,
        dy: e.clientY - start.y,
        heldMs: e.timeStamp - start.at,
      };
      if (!isContextTap(tap)) return; // dragged or held: it was a flight
      if (!prepareRef.current({ clientX: e.clientX, clientY: e.clientY, altKey: e.altKey })) return;
      dom.parentElement?.dispatchEvent(
        new MouseEvent('contextmenu', {
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    // The canvas never serves the native menu: the gesture above decides, and it alone.
    const onCtx = (e: MouseEvent) => e.stopPropagation();

    // CAPTURE PHASE: the camera controls sit on the same element and stop propagation for the
    // buttons they handle (see `useUsdPicking`). Capture runs down before any bubbling listener;
    // these listeners prevent nothing else.
    dom.addEventListener('pointerdown', onDown, true);
    dom.addEventListener('pointerup', onUp, true);
    dom.addEventListener('pointercancel', onUp, true);
    dom.addEventListener('contextmenu', onCtx);
    return () => {
      dom.removeEventListener('pointerdown', onDown, true);
      dom.removeEventListener('pointerup', onUp, true);
      dom.removeEventListener('pointercancel', onUp, true);
      dom.removeEventListener('contextmenu', onCtx);
    };
  }, [getDom, ready]);
}
