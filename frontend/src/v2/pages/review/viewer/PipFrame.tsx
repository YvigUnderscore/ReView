// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { clampPipRect, defaultPipRect, type PipRect } from './pipWindow';
import { useT } from '@/v2/i18n';

/**
 * Floating PiP window (layout mode, Phase 27): a **draggable** DOM frame (drag on the frame)
 * and **resizable** (top-left handle, bottom-right corner anchored, aspect ratio locked to the
 * camera frame). The WebGL render is drawn underneath using a scissor: every rect change is
 * reported via `onRect` (CSS px, origin at the container's top-left; `null` on unmount).
 * Positioned imperatively (ref), so there is no re-render during a drag.
 *
 * The rect is **kept for the session** (module variable): reopening the PiP puts it back where
 * it was left. **Double-click** enlarges the camera view (about 3/4 of the viewport); a second
 * double-click restores its previous size.
 */

// Last rect used (session), shared across successive PiP mounts.
let sessionRect: PipRect | null = null;
export default function PipFrame({
  label,
  aspect,
  onRect,
}: {
  label: string;
  /** Aspect ratio of the camera frame (the window keeps it while resizing). */
  aspect: number;
  onRect: (rect: PipRect | null) => void;
}) {
  const t = useT();
  const frameRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<PipRect | null>(null);
  // Latest props read by the listeners (installed only once).
  const aspectRef = useRef(aspect);
  const onRectRef = useRef(onRect);
  useEffect(() => {
    aspectRef.current = aspect;
    onRectRef.current = onRect;
  }, [aspect, onRect]);

  useEffect(() => {
    const frame = frameRef.current;
    const parent = frame?.parentElement;
    if (!frame || !parent) return;

    const apply = (rect: PipRect) => {
      rectRef.current = rect;
      sessionRect = rect;
      frame.style.left = `${rect.x}px`;
      frame.style.top = `${rect.y}px`;
      frame.style.width = `${rect.w}px`;
      frame.style.height = `${rect.h}px`;
      onRectRef.current(rect);
    };
    apply(
      sessionRect
        ? clampPipRect(sessionRect, parent.clientWidth, parent.clientHeight, aspectRef.current)
        : defaultPipRect(parent.clientWidth, parent.clientHeight, aspectRef.current),
    );

    // The container changes size (window, fullscreen): keep the window within its edges.
    const ro = new ResizeObserver(() => {
      const r = rectRef.current;
      if (r) apply(clampPipRect(r, parent.clientWidth, parent.clientHeight, aspectRef.current));
    });
    ro.observe(parent);

    // Drag: move (frame) or resize (handle; bottom-right corner anchored).
    let drag: { mode: 'move' | 'resize'; startX: number; startY: number; start: PipRect } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !rectRef.current) return;
      const resize = (e.target as HTMLElement).dataset.pipResize != null;
      drag = {
        mode: resize ? 'resize' : 'move',
        startX: e.clientX,
        startY: e.clientY,
        start: rectRef.current,
      };
      frame.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return;
      const { start } = drag;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const next =
        drag.mode === 'move'
          ? { ...start, x: start.x + dx, y: start.y + dy }
          : // Top-left handle: width grows to the left/top, bottom-right corner fixed.
            (() => {
              const w = start.w + Math.max(-dx, -dy * aspectRef.current);
              const h = w / aspectRef.current;
              return { x: start.x + start.w - w, y: start.y + start.h - h, w, h };
            })();
      apply(clampPipRect(next, parent.clientWidth, parent.clientHeight, aspectRef.current));
    };
    const onPointerUp = (e: PointerEvent) => {
      drag = null;
      if (frame.hasPointerCapture(e.pointerId)) frame.releasePointerCapture(e.pointerId);
    };
    // Double-click: enlarge the camera view (about 3/4 of the viewport); again to restore.
    let beforeMax: PipRect | null = null;
    const onDoubleClick = (e: MouseEvent) => {
      const r = rectRef.current;
      if (!r) return;
      e.preventDefault();
      if (beforeMax) {
        apply(clampPipRect(beforeMax, parent.clientWidth, parent.clientHeight, aspectRef.current));
        beforeMax = null;
        return;
      }
      beforeMax = r;
      const w = parent.clientWidth * 0.75;
      apply(
        clampPipRect(
          { x: (parent.clientWidth - w) / 2, y: 0, w, h: w / aspectRef.current },
          parent.clientWidth,
          parent.clientHeight,
          aspectRef.current,
        ),
      );
    };
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('dblclick', onDoubleClick);

    return () => {
      ro.disconnect();
      frame.removeEventListener('pointerdown', onPointerDown);
      frame.removeEventListener('pointermove', onPointerMove);
      frame.removeEventListener('pointerup', onPointerUp);
      frame.removeEventListener('dblclick', onDoubleClick);
      rectRef.current = null;
      onRectRef.current(null);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      className="absolute cursor-move overflow-hidden rounded-md border border-primary/70 shadow-lg"
      title={t('review.pipFrame')}
    >
      <span className="pointer-events-none absolute right-1 top-1 rounded bg-primary/80 px-1 text-2xs font-medium text-primary-foreground">
        {label}
      </span>
      <span
        data-pip-resize
        className="absolute left-0 top-0 h-3 w-3 cursor-nwse-resize border-b border-r border-primary/70 bg-primary/40"
      />
    </div>
  );
}
