// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, type RefObject } from 'react';
import { canSendPointer, clearPointers, sendPointer } from './pointerBus';

/**
 * Position dans le cadre, en fraction 0..1 — `null` hors du cadre (bandes latérales,
 * barres de l'interface) : montrer le vide n'a pas de sens, et un curseur hors bornes
 * s'afficherait de travers chez les spectateurs.
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
 * Capte le geste du driver sur le cadre du média et le diffuse comme curseur partagé.
 * Ne coûte rien hors session : sans émetteur branché, le calcul n'a même pas lieu.
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

  // Changement de média (le lecteur est remonté) : les curseurs du plan précédent
  // n'ont plus de sens sur le suivant.
  useEffect(() => clearPointers, []);

  return { onPointerMove, onPointerLeave };
}
