// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef } from 'react';
import { CAPTURE_WINDOW_MS } from './renderScheduler';
import { toThumbnail } from './thumbnail';

/**
 * Capture de miniature d'un rendu WebGL (Phase 20) : `capture()` renvoie une promesse résolue à
 * la prochaine frame avec le JPEG (data URL). `onFrame(canvas)` doit être appelé dans la boucle
 * de rendu **juste après `renderer.render`** (le drawing buffer est alors intact — pas besoin de
 * `preserveDrawingBuffer`). Partagé par les viewers 3D et splat.
 *
 * Un viewer qui rend **à la demande** (F14) passe sa porte de rendu : chaque demande ouvre alors
 * une fenêtre de rendu, sans quoi la promesse n'aurait jamais de frame à suivre. La grosse capture
 * d'export, elle, ne passe pas ici : elle prend son propre rendu (cf. `viewCapture`).
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
