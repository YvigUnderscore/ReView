// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { isEditable } from '../../../lib/shortcuts';
import { useViewShortcuts } from './useViewShortcuts';
import {
  isFit,
  panBy,
  wheelFactor,
  zoomBy as applyZoomBy,
  zoomStyle,
  zoomTo,
  ZOOM_FIT,
  PAN_CLICK_SLOP,
  type ZoomState,
} from './viewportZoom';

export interface ViewportZoom {
  state: ZoomState;
  /** Style to apply to the media layer — and to the comparison one, so it follows. */
  style: CSSProperties;
  /** Pointer handlers to attach to the container (the wheel is wired natively). */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
  };
  /** A drag has just happened: the release click must not start playback. */
  consumeClick: () => boolean;
  zoomBy: (factor: number) => void;
  /** Fit to screen (`F`, and the "Fit" button of the rail). */
  reset: () => void;
  /** Actual size 1:1 (`H`) — does nothing when no scale is known. */
  oneToOne: () => void;
  fit: boolean;
}

/**
 * Zoom and pan of the video player — same gesture as the image viewer: the wheel zooms under the
 * cursor, dragging pans, and the keyboard covers the rest (`+` / `-`, then `F` to fit and `H` for
 * 100%).
 *
 * `0` and `1` used to hold those last two roles and were removed (Phase 50): bare digits belong
 * to the chrome's mode toggle, and `1` did both at once. `F` and `H` are the keys the rail has
 * always announced (`action.fitMedia`, `action.resetMedia`) without anyone listening to them.
 *
 * The left button already drives play/pause and, in annotation mode, drawing: it therefore only
 * pans on the video itself and only once zoomed — the middle button always pans. The click that
 * ends a drag is consumed, otherwise every pan would pause playback.
 */
export function useViewportZoom({
  containerRef,
  oneToOneScale,
}: {
  containerRef: RefObject<HTMLElement | null>;
  /** Scale at which one media pixel equals one screen pixel, when known (100%). */
  oneToOneScale?: () => number | null;
}): ViewportZoom {
  const [state, setState] = useState<ZoomState>(ZOOM_FIT);
  const pan = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const clickBlocked = useRef(false);

  /** Offset of the point (clientX, clientY) from the container centre. */
  const offsetFromCenter = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return [0, 0];
      return [clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2)];
    },
    [containerRef],
  );

  // Wheel wired natively: React attaches `wheel` as a passive listener, where
  // `preventDefault` has no effect — the page would scroll behind the zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [dx, dy] = offsetFromCenter(e.clientX, e.clientY);
      setState((s) => applyZoomBy(s, wheelFactor(e.deltaY), dx, dy));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, offsetFromCenter]);

  // The 100% computation depends on the current box: kept mirrored, so as not to resubscribe
  // the keyboard on every player render.
  const oneToOneRef = useRef(oneToOneScale);
  useEffect(() => {
    oneToOneRef.current = oneToOneScale;
  });

  // Keyboard: zoom stays controllable without a mouse (and recoverable if the view is lost).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '+' || e.key === '=') setState((s) => applyZoomBy(s, 1.25));
      else if (e.key === '-') setState((s) => applyZoomBy(s, 1 / 1.25));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const reset = useCallback(() => setState(ZOOM_FIT), []);
  const oneToOne = useCallback(() => {
    const target = oneToOneRef.current?.();
    if (target && target > 0) setState((s) => zoomTo(s, target, 0, 0));
  }, []);
  // The rail's two view actions, on the keyboard: `F` fits, `H` returns to actual size.
  useViewShortcuts({ fit: reset, oneToOne });

  const onPointerDown = (e: React.PointerEvent) => {
    const onMedia = (e.target as Element | null)?.tagName === 'VIDEO';
    const middle = e.button === 1;
    if (!middle && !(e.button === 0 && onMedia && !isFit(state))) return;
    // Middle button: suppresses Windows' autoscroll.
    if (middle) e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    setState((s) => panBy(s, dx, dy));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    if (p.moved > PAN_CLICK_SLOP) clickBlocked.current = true;
    pan.current = null;
  };

  const consumeClick = useCallback(() => {
    const blocked = clickBlocked.current;
    clickBlocked.current = false;
    return blocked;
  }, []);

  return {
    state,
    style: zoomStyle(state),
    handlers: { onPointerDown, onPointerMove, onPointerUp },
    consumeClick,
    zoomBy: useCallback((factor: number) => setState((s) => applyZoomBy(s, factor)), []),
    reset,
    oneToOne,
    fit: isFit(state),
  };
}
