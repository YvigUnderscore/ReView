// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, type RefObject } from 'react';
import { canSendPointer, clearPointers, sendPointer } from './pointerBus';

/**
 * Position within the frame, as a 0..1 fraction: `null` outside the frame (side bands, interface bars).
 * Showing empty space is meaningless, and an out-of-bounds cursor would be displayed askew for the viewers.
 */
export function normalizeInBox(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4 };
}

/**
 * Captures the driver's gesture on the media frame and broadcasts it as a shared cursor.
 * Costs nothing outside a session: without a plugged-in emitter, the computation does not even take place.
 */
export function useLivePointerCapture(boxRef: RefObject<HTMLElement | null>): {
  onPointerMove: (e: { clientX: number; clientY: number }) => void;
  onPointerLeave: () => void;
} {
  const onPointerMove = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (!canSendPointer()) return;
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect) return;
      sendPointer(normalizeInBox(rect, e.clientX, e.clientY));
    },
    [boxRef],
  );

  const onPointerLeave = useCallback(() => {
    if (canSendPointer()) sendPointer(null);
  }, []);

  // Media change (the player was remounted): the cursors of the previous shot have no meaning on the next.
  useEffect(() => clearPointers, []);

  return { onPointerMove, onPointerLeave };
}
