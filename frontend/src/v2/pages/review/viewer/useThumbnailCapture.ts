// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef } from 'react';
import { toThumbnail } from './thumbnail';

/**
 * Capture de miniature d'un rendu WebGL (Phase 20) : `capture()` renvoie une promesse résolue à
 * la prochaine frame avec le JPEG (data URL). `onFrame(canvas)` doit être appelé dans la boucle
 * de rendu **juste après `renderer.render`** (le drawing buffer est alors intact — pas besoin de
 * `preserveDrawingBuffer`). Partagé par les viewers 3D et splat.
 */
export function useThumbnailCapture() {
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
        req.current = resolve;
      }),
    [],
  );

  return { onFrame, capture };
}
