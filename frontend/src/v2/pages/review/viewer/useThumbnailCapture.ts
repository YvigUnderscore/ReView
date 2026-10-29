// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef } from 'react';
import { CAPTURE_WINDOW_MS } from './renderScheduler';
import { toThumbnail } from './thumbnail';

/**
 * Thumbnail capture of a WebGL render (Phase 20): `capture()` returns a promise resolved at the
 * next frame with the JPEG (data URL). `onFrame(canvas)` must be called in the render loop
 * **right after `renderer.render`** (the drawing buffer is still intact then — no need for
 * `preserveDrawingBuffer`). Shared by the 3D and splat viewers.
 *
 * A viewer that renders **on demand** (F14) passes its render gate: each request then opens a
 * render window, otherwise the promise would never have a frame to follow. The full export
 * capture does not go through here: it takes its own render (see `viewCapture`).
 */
export function useThumbnailCapture(gate?: { invalidate: (ms?: number) => void }) {
  const req = useRef<((url: string | null) => void) | null>(null);

  const onFrame = useCallback((canvas: HTMLCanvasElement | null) => {
    const cb = req.current;
    if (!cb) return;
    req.current = null;
    cb(canvas ? toThumbnail(canvas) : null);
  }, []);

  const capture = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        gate?.invalidate(CAPTURE_WINDOW_MS);
        req.current = resolve;
      }),
    [gate],
  );

  return { onFrame, capture };
}
